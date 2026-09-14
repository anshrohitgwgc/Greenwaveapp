import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { agingBucket, emptyBuckets } from '../common/aging';
import { addDays, daysBetween, isIsoDate, toBusinessDate } from '../common/dates';
import { decimalToMinor, normalizeCurrency } from '../common/money';
import { Customer } from '../customers/entities/customer.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { AccountType } from './chart-of-accounts';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalLine } from './entities/journal-line.entity';
import { LedgerAccount } from './entities/ledger-account.entity';

/** Entries that affect balances. A REVERSED original still counts; its reversal offsets it. */
const BALANCE_STATUSES = ['POSTED', 'REVERSED'];
const MAX_RANGE_DAYS = 3700;
const CASH_SUBTYPES = ['CASH', 'BANK', 'CLEARING'];

interface Totals {
  debit: number;
  credit: number;
}

export interface ReportAccountLine {
  accountId: string | null;
  code: string;
  name: string;
  type: AccountType | null;
  subtype: string | null;
  parentId: string | null;
  amountMinor: number;
  compareAmountMinor?: number;
  computed?: boolean;
}

const isIncomeType = (t: AccountType) => t === 'REVENUE' || t === 'OTHER_INCOME';

/**
 * Financial statements computed only from posted general-ledger entries.
 * Nothing here reads Stripe objects, bank imports, or invoices directly,
 * except AR aging, which is a subledger view reconciled back to the ledger.
 * All aggregation happens in SQL grouped by account; no per-row queries.
 */
@Injectable()
export class AccountingReportsService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly config: ConfigService,
  ) {}

  currencyOf(value?: string): string {
    try {
      return normalizeCurrency(value ?? 'CAD');
    } catch {
      throw new BadRequestException('Unsupported currency');
    }
  }

  private date(value: unknown, name: string): string {
    if (!isIsoDate(value)) throw new BadRequestException(`${name} must be a valid YYYY-MM-DD date`);
    return value;
  }

  private range(from: unknown, to: unknown): { from: string; to: string } {
    const f = this.date(from, 'from');
    const t = this.date(to, 'to');
    if (f > t) throw new BadRequestException('from must be on or before to');
    if (daysBetween(f, t) > MAX_RANGE_DAYS) throw new BadRequestException('Date range is too large');
    return { from: f, to: t };
  }

  accounts(): Promise<LedgerAccount[]> {
    return this.ds.getRepository(LedgerAccount).find({ order: { code: 'ASC' } });
  }

  async balances(p: { from?: string; to: string; currency: string; accountIds?: string[] }): Promise<Map<string, Totals>> {
    const qb = this.ds
      .getRepository(JournalLine)
      .createQueryBuilder('l')
      .innerJoin(JournalEntry, 'e', 'e.id = l.entryId')
      .select('l.accountId', 'accountId')
      .addSelect('COALESCE(SUM(l.debitMinor), 0)', 'debit')
      .addSelect('COALESCE(SUM(l.creditMinor), 0)', 'credit')
      .where('e.status IN (:...balanceStatuses)', { balanceStatuses: BALANCE_STATUSES })
      .andWhere('e.currency = :currency', { currency: p.currency })
      .andWhere('e.entryDate <= :to', { to: p.to })
      .groupBy('l.accountId');
    if (p.from) qb.andWhere('e.entryDate >= :from', { from: p.from });
    if (p.accountIds) {
      if (p.accountIds.length === 0) return new Map();
      qb.andWhere('l.accountId IN (:...accountIds)', { accountIds: p.accountIds });
    }
    const rows = await qb.getRawMany<{ accountId: string; debit: string | number; credit: string | number }>();
    return new Map(rows.map((r) => [r.accountId, { debit: Number(r.debit), credit: Number(r.credit) }]));
  }

  private plAmount(type: AccountType, t: Totals | undefined): number {
    if (!t) return 0;
    return isIncomeType(type) ? t.credit - t.debit : t.debit - t.credit;
  }

  private netIncome(accounts: LedgerAccount[], balances: Map<string, Totals>): number {
    let net = 0;
    for (const a of accounts) {
      const t = balances.get(a.id);
      if (!t) continue;
      if (isIncomeType(a.type)) net += t.credit - t.debit;
      else if (a.type === 'EXPENSE' || a.type === 'COST_OF_GOODS_SOLD' || a.type === 'OTHER_EXPENSE') net -= t.debit - t.credit;
    }
    return net;
  }

  private line(a: LedgerAccount, amountMinor: number): ReportAccountLine {
    return { accountId: a.id, code: a.code, name: a.name, type: a.type, subtype: a.subtype, parentId: a.parentId, amountMinor };
  }

  fiscalYearStart(asOf: string): string {
    const configured = Number(this.config.get<string>('ACCOUNTING_FISCAL_YEAR_START_MONTH'));
    const month = Number.isInteger(configured) && configured >= 1 && configured <= 12 ? configured : 1;
    const year = Number(asOf.slice(0, 4));
    const asOfMonth = Number(asOf.slice(5, 7));
    const startYear = asOfMonth >= month ? year : year - 1;
    return `${startYear}-${String(month).padStart(2, '0')}-01`;
  }

  async trialBalance(q: { asOf?: string; currency?: string }) {
    const asOf = q.asOf ? this.date(q.asOf, 'asOf') : toBusinessDate(new Date());
    const currency = this.currencyOf(q.currency);
    const [accounts, balances] = await Promise.all([this.accounts(), this.balances({ to: asOf, currency })]);
    let totalDebit = 0;
    let totalCredit = 0;
    const lines = accounts
      .filter((a) => balances.has(a.id))
      .map((a) => {
        const t = balances.get(a.id)!;
        const net = t.debit - t.credit;
        const debitBalanceMinor = net > 0 ? net : 0;
        const creditBalanceMinor = net < 0 ? -net : 0;
        totalDebit += debitBalanceMinor;
        totalCredit += creditBalanceMinor;
        return { accountId: a.id, code: a.code, name: a.name, type: a.type, debitBalanceMinor, creditBalanceMinor };
      })
      .filter((l) => l.debitBalanceMinor !== 0 || l.creditBalanceMinor !== 0);
    return { asOf, currency, lines, totalDebitMinor: totalDebit, totalCreditMinor: totalCredit, balanced: totalDebit === totalCredit };
  }

  async profitAndLoss(q: { from?: string; to?: string; currency?: string; compareFrom?: string; compareTo?: string }) {
    const { from, to } = this.range(q.from, q.to);
    const currency = this.currencyOf(q.currency);
    const compare = !!(q.compareFrom || q.compareTo);
    const cmpRange = compare ? this.range(q.compareFrom, q.compareTo) : null;

    const [accounts, cur, cmp] = await Promise.all([
      this.accounts(),
      this.balances({ from, to, currency }),
      cmpRange ? this.balances({ ...cmpRange, currency }) : Promise.resolve(null),
    ]);

    const section = (type: AccountType) => {
      const lines: ReportAccountLine[] = [];
      let total = 0;
      let compareTotal = 0;
      for (const a of accounts.filter((x) => x.type === type)) {
        const amount = this.plAmount(a.type, cur.get(a.id));
        const cAmount = cmp ? this.plAmount(a.type, cmp.get(a.id)) : 0;
        if (amount === 0 && cAmount === 0) continue;
        lines.push({ ...this.line(a, amount), ...(cmp ? { compareAmountMinor: cAmount } : {}) });
        total += amount;
        compareTotal += cAmount;
      }
      return { lines, totalMinor: total, ...(cmp ? { compareTotalMinor: compareTotal } : {}) };
    };

    const revenue = section('REVENUE');
    const cogs = section('COST_OF_GOODS_SOLD');
    const opex = section('EXPENSE');
    const otherIncome = section('OTHER_INCOME');
    const otherExpenses = section('OTHER_EXPENSE');

    const totals = (key: 'totalMinor' | 'compareTotalMinor') => {
      const v = (s: { totalMinor: number; compareTotalMinor?: number }) => (key === 'totalMinor' ? s.totalMinor : (s.compareTotalMinor ?? 0));
      const grossProfit = v(revenue) - v(cogs);
      const operatingIncome = grossProfit - v(opex);
      return {
        revenueMinor: v(revenue),
        costOfGoodsSoldMinor: v(cogs),
        grossProfitMinor: grossProfit,
        operatingExpensesMinor: v(opex),
        operatingIncomeMinor: operatingIncome,
        otherIncomeMinor: v(otherIncome),
        otherExpensesMinor: v(otherExpenses),
        netIncomeMinor: operatingIncome + v(otherIncome) - v(otherExpenses),
      };
    };

    return {
      currency,
      basis: 'accrual',
      source: 'posted general ledger entries',
      period: { from, to },
      comparePeriod: cmpRange,
      sections: { revenue, costOfGoodsSold: cogs, operatingExpenses: opex, otherIncome, otherExpenses },
      totals: totals('totalMinor'),
      compareTotals: cmp ? totals('compareTotalMinor') : null,
    };
  }

  async balanceSheet(q: { asOf?: string; currency?: string }) {
    const asOf = q.asOf ? this.date(q.asOf, 'asOf') : toBusinessDate(new Date());
    const currency = this.currencyOf(q.currency);
    const fyStart = this.fiscalYearStart(asOf);
    const [accounts, all, prior, current] = await Promise.all([
      this.accounts(),
      this.balances({ to: asOf, currency }),
      this.balances({ to: addDays(fyStart, -1), currency }),
      this.balances({ from: fyStart, to: asOf, currency }),
    ]);

    const collect = (type: AccountType, natural: (t: Totals) => number) => {
      const lines: ReportAccountLine[] = [];
      let total = 0;
      for (const a of accounts.filter((x) => x.type === type)) {
        const t = all.get(a.id);
        if (!t) continue;
        const amount = natural(t);
        if (amount === 0) continue;
        lines.push(this.line(a, amount));
        total += amount;
      }
      return { lines, total };
    };

    const assets = collect('ASSET', (t) => t.debit - t.credit);
    const liabilities = collect('LIABILITY', (t) => t.credit - t.debit);
    const equity = collect('EQUITY', (t) => t.credit - t.debit);
    const priorEarnings = this.netIncome(accounts, prior);
    const currentEarnings = this.netIncome(accounts, current);
    equity.lines.push(
      { accountId: null, code: '', name: 'Retained earnings from prior periods (computed from ledger)', type: null, subtype: null, parentId: null, amountMinor: priorEarnings, computed: true },
      { accountId: null, code: '', name: 'Current fiscal year earnings', type: null, subtype: null, parentId: null, amountMinor: currentEarnings, computed: true },
    );
    const totalEquity = equity.total + priorEarnings + currentEarnings;
    const difference = assets.total - (liabilities.total + totalEquity);

    return {
      asOf,
      currency,
      fiscalYearStart: fyStart,
      source: 'posted general ledger entries',
      assets: { lines: assets.lines, totalMinor: assets.total },
      liabilities: { lines: liabilities.lines, totalMinor: liabilities.total },
      equity: { lines: equity.lines, totalMinor: totalEquity },
      totalLiabilitiesAndEquityMinor: liabilities.total + totalEquity,
      balanced: difference === 0,
      differenceMinor: difference,
    };
  }

  /**
   * Direct-method cash flow: movements in cash and cash-equivalent accounts
   * (subtypes CASH, BANK, CLEARING) attributed to the counter-accounts of the
   * same entries. For any balanced entry, cash change = sum over non-cash
   * lines of (credit - debit), so attribution is exact, including multi-line
   * entries. Transfers between cash accounts net to zero.
   */
  async cashFlow(q: { from?: string; to?: string; currency?: string }) {
    const { from, to } = this.range(q.from, q.to);
    const currency = this.currencyOf(q.currency);
    const accounts = await this.accounts();
    const cashIds = accounts.filter((a) => a.subtype && CASH_SUBTYPES.includes(a.subtype)).map((a) => a.id);
    const byId = new Map(accounts.map((a) => [a.id, a]));

    const [opening, closing] = await Promise.all([
      this.balances({ to: addDays(from, -1), currency, accountIds: cashIds }),
      this.balances({ to, currency, accountIds: cashIds }),
    ]);
    const sum = (m: Map<string, Totals>) => [...m.values()].reduce((s, t) => s + t.debit - t.credit, 0);

    const rows = cashIds.length
      ? await this.ds
          .getRepository(JournalLine)
          .createQueryBuilder('l')
          .innerJoin(JournalEntry, 'e', 'e.id = l.entryId')
          .select('l.accountId', 'accountId')
          .addSelect('COALESCE(SUM(l.creditMinor - l.debitMinor), 0)', 'cash')
          .where('e.status IN (:...balanceStatuses)', { balanceStatuses: BALANCE_STATUSES })
          .andWhere('e.currency = :currency', { currency })
          .andWhere('e.entryDate >= :from', { from })
          .andWhere('e.entryDate <= :to', { to })
          .andWhere('l.accountId NOT IN (:...cashIds)', { cashIds })
          .andWhere('EXISTS (SELECT 1 FROM journal_lines cl WHERE cl.entry_id = l.entry_id AND cl.account_id IN (:...cashIds))')
          .groupBy('l.accountId')
          .getRawMany<{ accountId: string; cash: string | number }>()
      : [];

    type Activity = 'operating' | 'investing' | 'financing';
    const classify = (a: LedgerAccount): Activity => {
      if (a.subtype === 'FIXED_ASSET' || a.subtype === 'CONTRA_ASSET') return 'investing';
      if (a.type === 'EQUITY' || a.subtype === 'LOAN') return 'financing';
      return 'operating';
    };
    const sections: Record<Activity, { lines: ReportAccountLine[]; totalMinor: number }> = {
      operating: { lines: [], totalMinor: 0 },
      investing: { lines: [], totalMinor: 0 },
      financing: { lines: [], totalMinor: 0 },
    };
    for (const r of rows) {
      const a = byId.get(r.accountId);
      const amount = Number(r.cash);
      if (!a || amount === 0) continue;
      const s = sections[classify(a)];
      s.lines.push(this.line(a, amount));
      s.totalMinor += amount;
    }
    const openingCash = sum(opening);
    const closingCash = sum(closing);
    const net = sections.operating.totalMinor + sections.investing.totalMinor + sections.financing.totalMinor;
    return {
      currency,
      method: 'direct',
      period: { from, to },
      cashAccounts: cashIds.map((id) => ({ accountId: id, code: byId.get(id)!.code, name: byId.get(id)!.name })),
      openingCashMinor: openingCash,
      sections,
      netChangeMinor: net,
      closingCashMinor: closingCash,
      reconciles: openingCash + net === closingCash,
    };
  }

  async generalLedger(q: { accountId: string; from?: string; to?: string; currency?: string; page?: number; pageSize?: number }) {
    const { from, to } = this.range(q.from, q.to);
    const currency = this.currencyOf(q.currency);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 100;
    if ((page - 1) * pageSize > 50_000) throw new BadRequestException('Narrow the date range instead of paging this deep');
    const account = await this.ds.getRepository(LedgerAccount).findOne({ where: { id: q.accountId } });
    if (!account) throw new NotFoundException('Account not found');
    const natural = (d: number, c: number) => (account.normalBalance === 'DEBIT' ? d - c : c - d);

    const openingTotals = (await this.balances({ to: addDays(from, -1), currency, accountIds: [account.id] })).get(account.id);
    const opening = openingTotals ? natural(openingTotals.debit, openingTotals.credit) : 0;

    const base = () =>
      this.ds
        .getRepository(JournalLine)
        .createQueryBuilder('l')
        .innerJoin(JournalEntry, 'e', 'e.id = l.entryId')
        .where('l.accountId = :accountId', { accountId: account.id })
        .andWhere('e.status IN (:...balanceStatuses)', { balanceStatuses: BALANCE_STATUSES })
        .andWhere('e.currency = :currency', { currency })
        .andWhere('e.entryDate >= :from', { from })
        .andWhere('e.entryDate <= :to', { to })
        .orderBy('e.entryDate', 'ASC')
        .addOrderBy('e.createdAt', 'ASC')
        .addOrderBy('l.lineNo', 'ASC');

    const offset = (page - 1) * pageSize;
    const [total, prior, rows, periodTotals] = await Promise.all([
      base().getCount(),
      offset > 0
        ? base().select('l.debitMinor', 'd').addSelect('l.creditMinor', 'c').limit(offset).getRawMany<{ d: number; c: number }>()
        : Promise.resolve([] as Array<{ d: number; c: number }>),
      base()
        .select([
          'l.id AS "lineId"',
          'l.debitMinor AS "debitMinor"',
          'l.creditMinor AS "creditMinor"',
          'l.description AS "lineDescription"',
          'e.id AS "entryId"',
          'e.entryDate AS "entryDate"',
          'e.description AS description',
          'e.reference AS reference',
          'e.sourceType AS "sourceType"',
          'e.sourceId AS "sourceId"',
          'e.sourceEvent AS "sourceEvent"',
          'e.status AS status',
        ])
        .offset(offset)
        .limit(pageSize)
        .getRawMany<Record<string, unknown>>(),
      this.balances({ from, to, currency, accountIds: [account.id] }),
    ]);

    let running = opening + prior.reduce((s, r) => s + natural(Number(r.d), Number(r.c)), 0);
    const lines = rows.map((r) => {
      const d = Number(r.debitMinor);
      const c = Number(r.creditMinor);
      running += natural(d, c);
      return { ...r, debitMinor: d, creditMinor: c, runningBalanceMinor: running };
    });
    const pt = periodTotals.get(account.id) ?? { debit: 0, credit: 0 };
    return {
      account: { id: account.id, code: account.code, name: account.name, type: account.type, normalBalance: account.normalBalance },
      currency,
      period: { from, to },
      openingBalanceMinor: opening,
      periodDebitMinor: pt.debit,
      periodCreditMinor: pt.credit,
      closingBalanceMinor: opening + natural(pt.debit, pt.credit),
      page,
      pageSize,
      total,
      lines,
    };
  }

  /**
   * AR aging from issued, unpaid invoices, reconciled to the ledger AR account.
   * Uses current payment state for invoices issued on or before `asOf`.
   */
  async receivablesAging(q: { asOf?: string; currency?: string }) {
    const asOf = q.asOf ? this.date(q.asOf, 'asOf') : toBusinessDate(new Date());
    const currency = this.currencyOf(q.currency);
    const rows = await this.ds
      .getRepository(Invoice)
      .createQueryBuilder('inv')
      .leftJoin(Customer, 'c', 'c.id = inv.customerId')
      .select([
        'inv.id AS id',
        'inv.invoiceNumber AS "invoiceNumber"',
        'inv.invoiceDate AS "invoiceDate"',
        'inv.dueDate AS "dueDate"',
        'inv.total AS total',
        'inv.customerId AS "customerId"',
        'c.name AS "customerName"',
        'inv.billTo AS "billTo"',
        'inv.paymentStatus AS "paymentStatus"',
      ])
      .where('inv.currency = :currency', { currency })
      .andWhere("inv.status NOT IN ('draft', 'void', 'cancelled', 'canceled')")
      .andWhere("inv.paymentStatus NOT IN ('paid', 'refunded', 'partially_refunded', 'disputed')")
      .andWhere('inv.invoiceDate <= :asOf', { asOf })
      .orderBy('inv.dueDate', 'ASC')
      .getRawMany<Record<string, string | null>>();

    const ledgerStart = this.config.get<string>('ACCOUNTING_LEDGER_START_DATE');
    const totals = emptyBuckets();
    const customers = new Map<string, { customerId: string | null; customerName: string; buckets: ReturnType<typeof emptyBuckets>; totalMinor: number }>();
    let total = 0;
    let preLedger = 0;
    const invoices = rows.map((r) => {
      const amountMinor = decimalToMinor(String(r.total ?? '0'), currency);
      const due = String(r.dueDate || r.invoiceDate);
      const bucket = agingBucket(due, asOf);
      totals[bucket] += amountMinor;
      total += amountMinor;
      if (isIsoDate(ledgerStart) && String(r.invoiceDate) < ledgerStart) preLedger += amountMinor;
      const name = r.customerName || (r.billTo || '').split('\n')[0] || 'Unassigned customer';
      const key = r.customerId ?? `name:${name}`;
      const c = customers.get(key) ?? { customerId: r.customerId, customerName: name, buckets: emptyBuckets(), totalMinor: 0 };
      c.buckets[bucket] += amountMinor;
      c.totalMinor += amountMinor;
      customers.set(key, c);
      return {
        id: r.id,
        invoiceNumber: r.invoiceNumber,
        customerName: name,
        invoiceDate: r.invoiceDate,
        dueDate: r.dueDate,
        daysPastDue: Math.max(0, daysBetween(due, asOf)),
        bucket,
        amountMinor,
        paymentStatus: r.paymentStatus,
      };
    });

    const accounts = await this.accounts();
    const ar = accounts.find((a) => a.systemKey === 'AR');
    const arTotals = ar ? (await this.balances({ to: asOf, currency, accountIds: [ar.id] })).get(ar.id) : undefined;
    const ledgerAr = arTotals ? arTotals.debit - arTotals.credit : 0;

    return {
      asOf,
      currency,
      buckets: totals,
      totalMinor: total,
      customers: [...customers.values()].sort((a, b) => b.totalMinor - a.totalMinor),
      invoices,
      reconciliation: {
        ledgerArBalanceMinor: ledgerAr,
        agingTotalMinor: total,
        invoicesBeforeLedgerStartMinor: preLedger,
        differenceMinor: ledgerAr - (total - preLedger),
        ledgerStartDate: isIsoDate(ledgerStart) ? ledgerStart : null,
      },
    };
  }
}
