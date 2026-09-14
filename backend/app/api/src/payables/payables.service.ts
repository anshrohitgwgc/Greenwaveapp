import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';

import { AccountingReportsService } from '../accounting/accounting-reports.service';
import { LEDGER_SOURCE, PostingContext } from '../accounting/accounting-posting.service';
import { JournalEntry } from '../accounting/entities/journal-entry.entity';
import { LedgerAccount } from '../accounting/entities/ledger-account.entity';
import { LedgerService } from '../accounting/ledger.service';
import { AuditService } from '../audit/audit.service';
import { agingBucket, emptyBuckets } from '../common/aging';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { daysBetween, isIsoDate, toBusinessDate } from '../common/dates';
import { isUniqueViolation, rowLock } from '../common/db-types';
import { formatMinor, normalizeCurrency } from '../common/money';
import { CreateBillDto, CreateVendorDto, ListBillsQueryDto, PayablesAgingQueryDto, UpdateVendorDto } from './dto/payables.dto';
import { BillPayment } from './entities/bill-payment.entity';
import { Bill } from './entities/bill.entity';
import { Vendor } from './entities/vendor.entity';

const BILL_EXPENSE_TYPES = ['EXPENSE', 'COST_OF_GOODS_SOLD', 'OTHER_EXPENSE'];
const BILL_ASSET_SUBTYPES = ['INVENTORY', 'FIXED_ASSET', 'OTHER_ASSET', 'OTHER_CURRENT'];

/**
 * Accounts payable. Liabilities come from approved bills only:
 *   approve:  DR expense/asset (subtotal), DR sales tax recoverable (tax)   CR AP
 *   payment:  DR AP                                                         CR bank / card
 */
@Injectable()
export class PayablesService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(Bill) private readonly bills: Repository<Bill>,
    @InjectRepository(BillPayment) private readonly billPayments: Repository<BillPayment>,
    @InjectRepository(LedgerAccount) private readonly accounts: Repository<LedgerAccount>,
    private readonly ledger: LedgerService,
    private readonly reports: AccountingReportsService,
    private readonly audit: AuditService,
  ) {}

  listVendors(includeInactive: boolean) {
    return this.vendors.find({ where: includeInactive ? {} : { isActive: true }, order: { name: 'ASC' } });
  }

  private async assertExpenseAccount(id: string | undefined | null): Promise<LedgerAccount | null> {
    if (!id) return null;
    const a = await this.accounts.findOne({ where: { id } });
    if (!a || !a.isActive) throw new BadRequestException('Expense account not found or inactive');
    if (!BILL_EXPENSE_TYPES.includes(a.type) && !(a.type === 'ASSET' && a.subtype && BILL_ASSET_SUBTYPES.includes(a.subtype))) {
      throw new BadRequestException('A bill must be coded to an expense, cost of goods sold, or inventory/fixed asset account');
    }
    return a;
  }

  async createVendor(dto: CreateVendorDto, actor: AuthenticatedUser) {
    await this.assertExpenseAccount(dto.defaultExpenseAccountId);
    const vendor = await this.vendors.save(
      this.vendors.create({
        id: randomUUID(),
        name: dto.name.trim(),
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        defaultExpenseAccountId: dto.defaultExpenseAccountId ?? null,
        isActive: true,
        createdBy: actor.id,
      }),
    );
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: 'payables.vendor_created', entityType: 'vendor', entityId: vendor.id, summary: `${actor.email} added vendor ${vendor.name}` });
    return vendor;
  }

  async updateVendor(id: string, dto: UpdateVendorDto, actor: AuthenticatedUser) {
    const vendor = await this.vendors.findOne({ where: { id } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    await this.assertExpenseAccount(dto.defaultExpenseAccountId);
    const before = { name: vendor.name, isActive: vendor.isActive };
    Object.assign(vendor, {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.email !== undefined ? { email: dto.email } : {}),
      ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
      ...(dto.defaultExpenseAccountId !== undefined ? { defaultExpenseAccountId: dto.defaultExpenseAccountId } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    });
    const saved = await this.vendors.save(vendor);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: 'payables.vendor_updated', entityType: 'vendor', entityId: id, summary: `${actor.email} updated vendor ${saved.name}`, metadata: { before, after: { name: saved.name, isActive: saved.isActive } } });
    return saved;
  }

  async listBills(q: ListBillsQueryDto) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const qb = this.bills.createQueryBuilder('b').leftJoin(Vendor, 'v', 'v.id = b.vendorId');
    if (q.status) qb.andWhere('b.status = :status', { status: q.status });
    if (q.vendorId) qb.andWhere('b.vendorId = :vendorId', { vendorId: q.vendorId });
    const total = await qb.clone().getCount();
    const items = await qb
      .select([
        'b.id AS id',
        'b.billNumber AS "billNumber"',
        'b.billDate AS "billDate"',
        'b.dueDate AS "dueDate"',
        'b.currency AS currency',
        'b.totalMinor AS "totalMinor"',
        'b.paidMinor AS "paidMinor"',
        'b.status AS status',
        'b.purchaseOrderId AS "purchaseOrderId"',
        'b.vendorId AS "vendorId"',
        'v.name AS "vendorName"',
      ])
      .orderBy('b.billDate', 'DESC')
      .offset((page - 1) * pageSize)
      .limit(pageSize)
      .getRawMany<Record<string, unknown>>();
    return {
      page,
      pageSize,
      total,
      items: items.map((r) => ({ ...r, totalMinor: Number(r.totalMinor), paidMinor: Number(r.paidMinor), openMinor: Number(r.totalMinor) - Number(r.paidMinor) })),
    };
  }

  async getBill(id: string) {
    const bill = await this.bills.findOne({ where: { id } });
    if (!bill) throw new NotFoundException('Bill not found');
    const [vendor, payments] = await Promise.all([
      this.vendors.findOne({ where: { id: bill.vendorId } }),
      this.billPayments.find({ where: { billId: id }, order: { createdAt: 'ASC' } }),
    ]);
    return { ...bill, openMinor: bill.totalMinor - bill.paidMinor, vendor, payments };
  }

  async createBill(dto: CreateBillDto, actor: AuthenticatedUser) {
    const vendor = await this.vendors.findOne({ where: { id: dto.vendorId } });
    if (!vendor || !vendor.isActive) throw new BadRequestException('Vendor not found or inactive');
    await this.assertExpenseAccount(dto.expenseAccountId);
    const currency = normalizeCurrency(dto.currency);
    const tax = dto.taxMinor ?? 0;
    const total = dto.subtotalMinor + tax;
    if (total <= 0) throw new BadRequestException('A bill total must be greater than zero');
    if (dto.dueDate && dto.dueDate < dto.billDate) throw new BadRequestException('Due date cannot be before the bill date');
    if (!isIsoDate(dto.billDate)) throw new BadRequestException('Invalid bill date');
    if (dto.purchaseOrderId) {
      const po = await this.ds.createQueryBuilder().select('po.id', 'id').from('purchase_orders', 'po').where('po.id = :id', { id: dto.purchaseOrderId }).getRawOne();
      if (!po) throw new BadRequestException('Purchase order not found');
    }
    try {
      const bill = await this.bills.save(
        this.bills.create({
          id: randomUUID(),
          vendorId: vendor.id,
          billNumber: dto.billNumber.trim(),
          billDate: dto.billDate,
          dueDate: dto.dueDate ?? null,
          currency,
          expenseAccountId: dto.expenseAccountId,
          subtotalMinor: dto.subtotalMinor,
          taxMinor: tax,
          totalMinor: total,
          paidMinor: 0,
          status: 'DRAFT',
          purchaseOrderId: dto.purchaseOrderId ?? null,
          memo: dto.memo ?? null,
          createdBy: actor.id,
        }),
      );
      await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: 'payables.bill_created', entityType: 'bill', entityId: bill.id, summary: `${actor.email} entered bill ${bill.billNumber} from ${vendor.name} (${formatMinor(total, currency)})`, metadata: { purchaseOrderId: bill.purchaseOrderId } });
      return bill;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('This vendor already has a bill with that number');
      throw err;
    }
  }

  async approveBill(id: string, actor: AuthenticatedUser, requestId: string | null) {
    return this.ds.transaction(async (m) => {
      const bill = await m.getRepository(Bill).findOne({ where: { id }, lock: rowLock(m) });
      if (!bill) throw new NotFoundException('Bill not found');
      if (bill.status !== 'DRAFT') throw new ConflictException(`A ${bill.status} bill cannot be approved`);
      const vendor = await m.getRepository(Vendor).findOne({ where: { id: bill.vendorId } });
      const { entry } = await this.ledger.post(
        {
          entryDate: bill.billDate,
          description: `Bill ${bill.billNumber} from ${vendor?.name ?? 'vendor'}`,
          reference: bill.billNumber,
          currency: bill.currency,
          sourceType: LEDGER_SOURCE.BILL,
          sourceId: bill.id,
          sourceEvent: 'bill.approved',
          createdBy: actor.id,
          requestId,
          lines: [
            ...(bill.subtotalMinor > 0 ? [{ accountId: bill.expenseAccountId, debitMinor: bill.subtotalMinor }] : []),
            ...(bill.taxMinor > 0 ? [{ accountKey: 'SALES_TAX_RECOVERABLE' as const, debitMinor: bill.taxMinor }] : []),
            { accountKey: 'AP' as const, creditMinor: bill.totalMinor, vendorId: bill.vendorId },
          ],
        },
        m,
      );
      bill.status = 'OPEN';
      bill.approvedBy = actor.id;
      bill.approvedAt = new Date();
      await m.getRepository(Bill).save(bill);
      await this.audit.record(
        { actorUserId: actor.id, actorRole: actor.role, action: 'payables.bill_approved', entityType: 'bill', entityId: bill.id, summary: `${actor.email} approved bill ${bill.billNumber} (${formatMinor(bill.totalMinor, bill.currency)})`, metadata: { journalEntryId: entry.id, requestId } },
        m,
      );
      return bill;
    });
  }

  async voidBill(id: string, actor: AuthenticatedUser, requestId: string | null) {
    return this.ds.transaction(async (m) => {
      const bill = await m.getRepository(Bill).findOne({ where: { id }, lock: rowLock(m) });
      if (!bill) throw new NotFoundException('Bill not found');
      if (bill.status === 'VOID') return bill;
      if (bill.paidMinor > 0) throw new ConflictException('A bill with payments cannot be voided; reset the matched payments first');
      if (bill.status === 'OPEN') {
        const entry = await this.ledger.findBySource(LEDGER_SOURCE.BILL, bill.id, 'bill.approved', m);
        if (entry && entry.status === 'POSTED') {
          await this.ledger.reverse(entry.id, { entryDate: toBusinessDate(new Date()), reason: 'Bill voided', sourceEvent: 'bill.voided', createdBy: actor.id, requestId }, m);
        }
      }
      bill.status = 'VOID';
      await m.getRepository(Bill).save(bill);
      await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: 'payables.bill_voided', entityType: 'bill', entityId: bill.id, summary: `${actor.email} voided bill ${bill.billNumber}`, metadata: { requestId } }, m);
      return bill;
    });
  }

  /** Called inside the reconciliation transaction when a statement line pays a bill. */
  async applyPayment(
    m: EntityManager,
    p: { billId: string; amountMinor: number; paidDate: string; transactionId: string; creditAccountId: string; currency: string },
    ctx: PostingContext,
  ): Promise<JournalEntry> {
    const bill = await m.getRepository(Bill).findOne({ where: { id: p.billId }, lock: rowLock(m) });
    if (!bill) throw new NotFoundException('Bill not found');
    if (bill.status !== 'OPEN') throw new ConflictException(`A ${bill.status} bill cannot be paid`);
    if (bill.currency !== p.currency) throw new BadRequestException('Payment currency does not match the bill');
    const open = bill.totalMinor - bill.paidMinor;
    if (p.amountMinor > open) throw new BadRequestException(`Payment exceeds the bill's open balance (${formatMinor(open, bill.currency)})`);

    const { entry } = await this.ledger.post(
      {
        entryDate: p.paidDate,
        description: `Payment of bill ${bill.billNumber}`,
        reference: bill.billNumber,
        currency: bill.currency,
        sourceType: LEDGER_SOURCE.BANK_TRANSACTION,
        sourceId: p.transactionId,
        sourceEvent: `bill_payment:${bill.id}`,
        createdBy: ctx.actorId ?? null,
        requestId: ctx.requestId ?? null,
        lines: [
          { accountKey: 'AP', debitMinor: p.amountMinor, vendorId: bill.vendorId },
          { accountId: p.creditAccountId, creditMinor: p.amountMinor },
        ],
      },
      m,
    );
    await m.getRepository(BillPayment).save(
      m.getRepository(BillPayment).create({
        id: randomUUID(),
        billId: bill.id,
        financialTransactionId: p.transactionId,
        amountMinor: p.amountMinor,
        paidDate: p.paidDate,
        journalEntryId: entry.id,
        reversedAt: null,
        createdBy: ctx.actorId ?? null,
      }),
    );
    bill.paidMinor += p.amountMinor;
    if (bill.paidMinor === bill.totalMinor) bill.status = 'PAID';
    await m.getRepository(Bill).save(bill);
    return entry;
  }

  /** Undoes the bill payments created by one statement transaction. */
  async reversePayments(m: EntityManager, transactionId: string, ctx: PostingContext): Promise<number> {
    const payments = await m.getRepository(BillPayment).find({ where: { financialTransactionId: transactionId, reversedAt: IsNull() } });
    for (const bp of payments) {
      const bill = await m.getRepository(Bill).findOne({ where: { id: bp.billId }, lock: rowLock(m) });
      if (!bill) continue;
      await this.ledger.reverse(bp.journalEntryId, { entryDate: toBusinessDate(new Date()), reason: 'Bill payment match reset', sourceEvent: `bill_payment_reversal:${bp.id}`, createdBy: ctx.actorId, requestId: ctx.requestId }, m);
      bp.reversedAt = new Date();
      await m.getRepository(BillPayment).save(bp);
      bill.paidMinor -= bp.amountMinor;
      if (bill.status === 'PAID') bill.status = 'OPEN';
      await m.getRepository(Bill).save(bill);
    }
    return payments.length;
  }

  async aging(q: PayablesAgingQueryDto) {
    const asOf = q.asOf ?? toBusinessDate(new Date());
    const currency = normalizeCurrency(q.currency ?? 'CAD');
    const rows = await this.bills
      .createQueryBuilder('b')
      .leftJoin(Vendor, 'v', 'v.id = b.vendorId')
      .select(['b.id AS id', 'b.billNumber AS "billNumber"', 'b.billDate AS "billDate"', 'b.dueDate AS "dueDate"', 'b.totalMinor AS "totalMinor"', 'b.paidMinor AS "paidMinor"', 'b.vendorId AS "vendorId"', 'v.name AS "vendorName"'])
      .where("b.status = 'OPEN'")
      .andWhere('b.currency = :currency', { currency })
      .andWhere('b.billDate <= :asOf', { asOf })
      .getRawMany<Record<string, string | number | null>>();

    const buckets = emptyBuckets();
    const vendors = new Map<string, { vendorId: string; vendorName: string; buckets: ReturnType<typeof emptyBuckets>; totalMinor: number }>();
    let total = 0;
    const bills = rows.map((r) => {
      const open = Number(r.totalMinor) - Number(r.paidMinor);
      const due = String(r.dueDate || r.billDate);
      const bucket = agingBucket(due, asOf);
      buckets[bucket] += open;
      total += open;
      const v = vendors.get(String(r.vendorId)) ?? { vendorId: String(r.vendorId), vendorName: String(r.vendorName ?? ''), buckets: emptyBuckets(), totalMinor: 0 };
      v.buckets[bucket] += open;
      v.totalMinor += open;
      vendors.set(String(r.vendorId), v);
      return { id: r.id, billNumber: r.billNumber, vendorName: r.vendorName, dueDate: r.dueDate, daysPastDue: Math.max(0, daysBetween(due, asOf)), bucket, openMinor: open };
    });

    const ap = await this.accounts.findOne({ where: { systemKey: 'AP' } });
    const apTotals = ap ? (await this.reports.balances({ to: asOf, currency, accountIds: [ap.id] })).get(ap.id) : undefined;
    const ledgerAp = apTotals ? apTotals.credit - apTotals.debit : 0;
    return {
      asOf,
      currency,
      buckets,
      totalMinor: total,
      vendors: [...vendors.values()].sort((a, b) => b.totalMinor - a.totalMinor),
      bills,
      reconciliation: { ledgerApBalanceMinor: ledgerAp, agingTotalMinor: total, differenceMinor: ledgerAp - total },
    };
  }
}
