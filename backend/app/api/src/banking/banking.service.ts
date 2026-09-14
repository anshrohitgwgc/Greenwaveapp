import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { DataSource, In, Repository } from 'typeorm';

import { AccountingReportsService } from '../accounting/accounting-reports.service';
import { LedgerAccount } from '../accounting/entities/ledger-account.entity';
import { LedgerService } from '../accounting/ledger.service';
import { AuditService } from '../audit/audit.service';
import { toBusinessDate } from '../common/dates';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { decimalToMinor, formatMinor, normalizeCurrency } from '../common/money';
import { BillPayment } from '../payables/entities/bill-payment.entity';
import { Bill } from '../payables/entities/bill.entity';
import { StripePayout } from '../payments/entities/stripe-payout.entity';
import {
  CategorizeDto,
  CompleteReconciliationDto,
  CreateFinancialAccountDto,
  ExcludeDto,
  ListTransactionsQueryDto,
  MatchDto,
  StartReconciliationDto,
  StatementMappingDto,
  UpdateFinancialAccountDto,
} from './dto/banking.dto';
import { BankReconciliation } from './entities/bank-reconciliation.entity';
import { FinancialAccount } from './entities/financial-account.entity';
import { FinancialTransaction, TransactionStatus } from './entities/financial-transaction.entity';
import { ImportBatch } from './entities/import-batch.entity';
import { ImportBatchRow } from './entities/import-batch-row.entity';
import { TransactionSplit } from './entities/transaction-split.entity';
import { parseCsvStatement } from './statement-import';

@Injectable()
export class BankingService {
  constructor(
    @InjectRepository(FinancialAccount) private readonly accounts: Repository<FinancialAccount>,
    @InjectRepository(FinancialTransaction) private readonly transactions: Repository<FinancialTransaction>,
    @InjectRepository(ImportBatch) private readonly batches: Repository<ImportBatch>,
    @InjectRepository(ImportBatchRow) private readonly batchRows: Repository<ImportBatchRow>,
    @InjectRepository(BankReconciliation) private readonly reconciliations: Repository<BankReconciliation>,
    @InjectRepository(TransactionSplit) private readonly splits: Repository<TransactionSplit>,
    @InjectRepository(LedgerAccount) private readonly ledgerAccounts: Repository<LedgerAccount>,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly reports: AccountingReportsService,
    private readonly ledger: LedgerService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  // --------------------------------------------------------------------------
  // Financial Accounts (Bank & Credit Card)
  // --------------------------------------------------------------------------

  async listAccounts(includeInactive = false) {
    const where = includeInactive ? {} : { isActive: true };
    const items = await this.accounts.find({ where, order: { createdAt: 'ASC' } });

    const ledgerIds = items.map((a) => a.ledgerAccountId);
    const today = toBusinessDate(new Date());

    const cadBalances = await this.reports.balances({ to: today, currency: 'CAD', accountIds: ledgerIds });
    const usdBalances = await this.reports.balances({ to: today, currency: 'USD', accountIds: ledgerIds });

    return items.map((a) => {
      const bMap = a.currency === 'USD' ? usdBalances : cadBalances;
      const b = bMap.get(a.ledgerAccountId);
      // For ASSET (bank): DEBIT - CREDIT. For LIABILITY (credit card): CREDIT - DEBIT
      const bookBalanceMinor = b
        ? a.kind === 'BANK'
          ? b.debit - b.credit
          : b.credit - b.debit
        : 0;

      return {
        ...a,
        bookBalanceMinor,
      };
    });
  }

  async getAccount(id: string) {
    const account = await this.accounts.findOne({ where: { id } });
    if (!account) throw new NotFoundException('Financial account not found');

    const today = toBusinessDate(new Date());
    const balances = await this.reports.balances({
      to: today,
      currency: account.currency,
      accountIds: [account.ledgerAccountId],
    });
    const b = balances.get(account.ledgerAccountId);
    const bookBalanceMinor = b
      ? account.kind === 'BANK'
        ? b.debit - b.credit
        : b.credit - b.debit
      : 0;

    const unreviewedCount = await this.transactions.count({
      where: { accountId: id, status: 'UNREVIEWED' },
    });

    return {
      ...account,
      bookBalanceMinor,
      unreviewedCount,
    };
  }

  async createAccount(dto: CreateFinancialAccountDto, actor: AuthenticatedUser) {
    const currency = normalizeCurrency(dto.currency);
    let ledgerAccountId = dto.ledgerAccountId;

    if (!ledgerAccountId) {
      // Create corresponding LedgerAccount
      const codePrefix = dto.kind === 'BANK' ? '10' : '20';
      const existingAccounts = await this.ledgerAccounts.find({
        order: { code: 'DESC' },
      });
      const matching = existingAccounts.filter((a) => a.code.startsWith(codePrefix));
      const nextNum = matching.length > 0 ? parseInt(matching[0].code, 10) + 10 : parseInt(`${codePrefix}10`, 10);

      const created = await this.ledgerAccounts.save(
        this.ledgerAccounts.create({
          id: randomUUID(),
          code: String(nextNum),
          name: dto.name,
          type: dto.kind === 'BANK' ? 'ASSET' : 'LIABILITY',
          subtype: dto.kind === 'BANK' ? 'BANK' : 'CREDIT_CARD',
          normalBalance: dto.kind === 'BANK' ? 'DEBIT' : 'CREDIT',
          isActive: true,
          description: `${dto.kind === 'BANK' ? 'Bank' : 'Credit Card'} account for ${dto.name}`,
        }),
      );
      ledgerAccountId = created.id;
    } else {
      const existingLedger = await this.ledgerAccounts.findOne({ where: { id: ledgerAccountId } });
      if (!existingLedger) throw new NotFoundException('Specified ledger account not found');
    }

    const account = await this.accounts.save(
      this.accounts.create({
        id: randomUUID(),
        kind: dto.kind,
        name: dto.name.trim(),
        institution: dto.institution?.trim() ?? null,
        accountMask: dto.accountMask ?? null,
        accountType: dto.accountType,
        currency,
        ledgerAccountId,
        creditLimitMinor: dto.creditLimitMinor ?? null,
        statementDay: dto.statementDay ?? null,
        paymentDueDay: dto.paymentDueDay ?? null,
        connectionType: 'MANUAL_CSV',
        connectionStatus: 'NOT_CONNECTED',
        isActive: true,
        createdBy: actor.id,
      }),
    );

    await this.audit?.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'banking.account_created',
      entityType: 'financial_account',
      entityId: account.id,
      summary: `${actor.email} created ${account.kind} account "${account.name}"`,
      metadata: { kind: account.kind, currency: account.currency, ledgerAccountId },
    });

    return account;
  }

  async updateAccount(id: string, dto: UpdateFinancialAccountDto, actor: AuthenticatedUser) {
    const account = await this.accounts.findOne({ where: { id } });
    if (!account) throw new NotFoundException('Financial account not found');

    if (dto.name !== undefined) account.name = dto.name.trim();
    if (dto.institution !== undefined) account.institution = dto.institution ? dto.institution.trim() : null;
    if (dto.accountMask !== undefined) account.accountMask = dto.accountMask ?? null;
    if (dto.creditLimitMinor !== undefined) account.creditLimitMinor = dto.creditLimitMinor ?? null;
    if (dto.statementDay !== undefined) account.statementDay = dto.statementDay ?? null;
    if (dto.paymentDueDay !== undefined) account.paymentDueDay = dto.paymentDueDay ?? null;
    if (dto.isActive !== undefined) account.isActive = dto.isActive;

    const saved = await this.accounts.save(account);

    await this.audit?.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'banking.account_updated',
      entityType: 'financial_account',
      entityId: id,
      summary: `${actor.email} updated ${saved.kind} account "${saved.name}"`,
    });

    return saved;
  }

  // --------------------------------------------------------------------------
  // Transactions
  // --------------------------------------------------------------------------

  async listTransactions(q: ListTransactionsQueryDto) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;

    const qb = this.transactions.createQueryBuilder('t');

    if (q.accountId) qb.andWhere('t.accountId = :accountId', { accountId: q.accountId });
    if (q.status) qb.andWhere('t.status = :status', { status: q.status });
    if (q.direction) qb.andWhere('t.direction = :direction', { direction: q.direction });
    if (q.from) qb.andWhere('t.transactionDate >= :from', { from: q.from });
    if (q.to) qb.andWhere('t.transactionDate <= :to', { to: q.to });

    if (q.q?.trim()) {
      const search = `%${q.q.trim().toLowerCase()}%`;
      qb.andWhere('(LOWER(t.description) LIKE :s OR LOWER(t.merchant) LIKE :s OR LOWER(t.externalId) LIKE :s)', {
        s: search,
      });
    }

    const [items, total] = await qb
      .orderBy('t.transactionDate', 'DESC')
      .addOrderBy('t.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      items,
      total,
      page,
      pageSize,
      pageCount: Math.ceil(total / pageSize),
    };
  }

  async getTransaction(id: string) {
    const tx = await this.transactions.findOne({ where: { id } });
    if (!tx) throw new NotFoundException('Transaction not found');
    const splits = await this.splits.find({ where: { transactionId: id }, order: { lineNo: 'ASC' } });
    return { ...tx, splits };
  }

  // --------------------------------------------------------------------------
  // Statement Import Workflow
  // --------------------------------------------------------------------------

  async previewImport(
    accountId: string,
    fileBuffer: Buffer,
    filename: string,
    mapping: StatementMappingDto,
    actor: AuthenticatedUser,
  ) {
    const account = await this.accounts.findOne({ where: { id: accountId } });
    if (!account) throw new NotFoundException('Financial account not found');

    const fileSha256 = createHash('sha256').update(fileBuffer).digest('hex');
    const csvContent = fileBuffer.toString('utf-8');

    const parseResult = parseCsvStatement(csvContent, mapping, account.currency);
    const { validRows, errors, dateMin, dateMax } = parseResult;

    // Check for existing duplicates
    const dedupeHashes = validRows.map((r) => r.dedupeHash);
    const existing = dedupeHashes.length
      ? await this.transactions.find({
          where: { accountId, dedupeHash: In(dedupeHashes) },
          select: ['dedupeHash'],
        })
      : [];
    const duplicateSet = new Set(existing.map((e) => e.dedupeHash));

    let duplicateCount = 0;
    let validCount = 0;

    const batchId = randomUUID();
    const rowsToInsert: ImportBatchRow[] = [];

    for (const r of validRows) {
      const isDuplicate = duplicateSet.has(r.dedupeHash);
      if (isDuplicate) {
        duplicateCount++;
        rowsToInsert.push(
          this.batchRows.create({
            id: randomUUID(),
            batchId,
            rowNo: r.rowNo,
            status: 'DUPLICATE',
            parsed: r,
            error: 'Duplicate transaction already recorded',
          }),
        );
      } else {
        validCount++;
        rowsToInsert.push(
          this.batchRows.create({
            id: randomUUID(),
            batchId,
            rowNo: r.rowNo,
            status: 'VALID',
            parsed: r,
            error: null,
          }),
        );
      }
    }

    for (const e of errors) {
      rowsToInsert.push(
        this.batchRows.create({
          id: randomUUID(),
          batchId,
          rowNo: e.rowNo,
          status: 'ERROR',
          parsed: null,
          error: e.error,
        }),
      );
    }

    const batch = await this.batches.save(
      this.batches.create({
        id: batchId,
        accountId,
        filename,
        fileSha256,
        status: 'PREVIEWED',
        mapping: mapping as unknown as Record<string, unknown>,
        rowCount: validRows.length + errors.length,
        validCount,
        duplicateCount,
        errorCount: errors.length,
        importedCount: 0,
        errors: errors.map((e) => ({ rowNo: e.rowNo, message: e.error })),
        dateMin,
        dateMax,
        createdBy: actor.id,
      }),
    );

    await this.batchRows.save(rowsToInsert);

    return {
      batchId: batch.id,
      filename,
      rowCount: batch.rowCount,
      validCount,
      duplicateCount,
      errorCount: errors.length,
      dateMin,
      dateMax,
      sampleRows: rowsToInsert.slice(0, 50),
    };
  }

  async commitImport(batchId: string, actor: AuthenticatedUser) {
    const batch = await this.batches.findOne({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Import batch not found');
    if (batch.status !== 'PREVIEWED') {
      throw new ConflictException(`Batch status is ${batch.status}, cannot commit`);
    }

    const rows = await this.batchRows.find({
      where: { batchId, status: 'VALID' },
      order: { rowNo: 'ASC' },
    });

    if (rows.length === 0) {
      throw new BadRequestException('No valid rows to commit');
    }

    const account = await this.accounts.findOne({ where: { id: batch.accountId } });
    if (!account) throw new NotFoundException('Financial account not found');

    const txsToSave: FinancialTransaction[] = [];
    for (const r of rows) {
      if (!r.parsed) continue;
      const p = r.parsed;
      txsToSave.push(
        this.transactions.create({
          id: randomUUID(),
          accountId: batch.accountId,
          transactionDate: p.transactionDate,
          postedDate: p.postedDate,
          description: p.description,
          merchant: p.merchant,
          amountMinor: p.amountMinor,
          direction: p.direction,
          currency: p.currency,
          externalId: p.externalId,
          source: 'CSV_IMPORT',
          importBatchId: batch.id,
          dedupeHash: p.dedupeHash,
          status: 'UNREVIEWED',
        }),
      );
    }

    await this.transactions.save(txsToSave);

    batch.status = 'COMMITTED';
    batch.importedCount = txsToSave.length;
    batch.committedBy = actor.id;
    batch.committedAt = new Date();
    await this.batches.save(batch);

    account.lastImportedAt = new Date();
    await this.accounts.save(account);

    await this.audit?.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'banking.statement_imported',
      entityType: 'import_batch',
      entityId: batch.id,
      summary: `${actor.email} committed import of ${txsToSave.length} transactions from "${batch.filename}" into ${account.name}`,
      metadata: { importedCount: txsToSave.length, accountId: account.id },
    });

    return {
      batchId: batch.id,
      importedCount: txsToSave.length,
      accountName: account.name,
    };
  }

  async discardImport(batchId: string, actor: AuthenticatedUser) {
    const batch = await this.batches.findOne({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Import batch not found');
    if (batch.status !== 'PREVIEWED') {
      throw new ConflictException(`Batch status is ${batch.status}, cannot discard`);
    }

    await this.batchRows.delete({ batchId });
    batch.status = 'DISCARDED';
    await this.batches.save(batch);

    return { discarded: true };
  }

  // --------------------------------------------------------------------------
  // Categorize, Match & Exclude Transactions
  // --------------------------------------------------------------------------

  async categorize(id: string, dto: CategorizeDto, actor: AuthenticatedUser, requestId: string | null) {
    const tx = await this.transactions.findOne({ where: { id } });
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.status !== 'UNREVIEWED') {
      throw new ConflictException(`Transaction is already ${tx.status}`);
    }

    const totalSplit = dto.splits.reduce((sum, s) => sum + s.amountMinor, 0);
    if (totalSplit !== tx.amountMinor) {
      throw new BadRequestException(
        `Splits sum (${totalSplit}) does not match transaction amount (${tx.amountMinor})`,
      );
    }

    const account = await this.accounts.findOne({ where: { id: tx.accountId } });
    if (!account) throw new NotFoundException('Account not found');

    const lines: Array<{
      accountId: string;
      debitMinor: number;
      creditMinor: number;
      description: string | null;
    }> = [];

    if (account.kind === 'BANK') {
      if (tx.direction === 'DEBIT') {
        // Money out: DR expense accounts, CR Bank account
        for (const s of dto.splits) {
          lines.push({ accountId: s.accountId, debitMinor: s.amountMinor, creditMinor: 0, description: s.description ?? null });
        }
        lines.push({ accountId: account.ledgerAccountId, debitMinor: 0, creditMinor: tx.amountMinor, description: tx.description });
      } else {
        // Money in: DR Bank account, CR Income accounts
        lines.push({ accountId: account.ledgerAccountId, debitMinor: tx.amountMinor, creditMinor: 0, description: tx.description });
        for (const s of dto.splits) {
          lines.push({ accountId: s.accountId, debitMinor: 0, creditMinor: s.amountMinor, description: s.description ?? null });
        }
      }
    } else {
      // CREDIT_CARD
      if (tx.direction === 'DEBIT') {
        // Card purchase/charge: DR expense accounts, CR Credit Card liability account
        for (const s of dto.splits) {
          lines.push({ accountId: s.accountId, debitMinor: s.amountMinor, creditMinor: 0, description: s.description ?? null });
        }
        lines.push({ accountId: account.ledgerAccountId, debitMinor: 0, creditMinor: tx.amountMinor, description: tx.description });
      } else {
        // Card payment/credit: DR Credit Card liability account, CR Bank account
        lines.push({ accountId: account.ledgerAccountId, debitMinor: tx.amountMinor, creditMinor: 0, description: tx.description });
        for (const s of dto.splits) {
          lines.push({ accountId: s.accountId, debitMinor: 0, creditMinor: s.amountMinor, description: s.description ?? null });
        }
      }
    }

    const { entry } = await this.ledger.post({
      entryDate: tx.transactionDate,
      description: `${account.name}: ${tx.description}`,
      reference: tx.externalId ?? undefined,
      currency: tx.currency,
      sourceType: 'bank_transaction',
      sourceId: tx.id,
      sourceEvent: 'transaction.categorized',
      createdBy: actor.id,
      requestId,
      lines,
    });

    const splitEntities = dto.splits.map((s, idx) =>
      this.splits.create({
        id: randomUUID(),
        transactionId: tx.id,
        lineNo: idx + 1,
        accountId: s.accountId,
        amountMinor: s.amountMinor,
        description: s.description ?? null,
      }),
    );
    await this.splits.save(splitEntities);

    tx.status = 'CATEGORIZED';
    tx.categoryAccountId = dto.splits.length === 1 ? dto.splits[0].accountId : null;
    tx.postedJournalEntryId = entry.id;
    tx.reviewedBy = actor.id;
    tx.reviewedAt = new Date();
    if (dto.memo) tx.notes = dto.memo;
    await this.transactions.save(tx);

    await this.audit?.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'banking.transaction_categorized',
      entityType: 'financial_transaction',
      entityId: tx.id,
      summary: `${actor.email} categorized transaction "${tx.description}" (${formatMinor(tx.amountMinor, tx.currency)})`,
      metadata: { journalEntryId: entry.id, splitsCount: dto.splits.length },
    });

    return this.getTransaction(tx.id);
  }

  async match(id: string, dto: MatchDto, actor: AuthenticatedUser, requestId: string | null) {
    const tx = await this.transactions.findOne({ where: { id } });
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.status !== 'UNREVIEWED') {
      throw new ConflictException(`Transaction is already ${tx.status}`);
    }

    const account = await this.accounts.findOne({ where: { id: tx.accountId } });
    if (!account) throw new NotFoundException('Financial account not found');

    if (dto.type === 'PAYOUT') {
      // Stripe Payout match: DR Bank Account, CR Stripe Clearing
      const payout = await this.ds.getRepository(StripePayout).findOne({ where: { id: dto.targetId } });
      if (!payout) throw new NotFoundException('Stripe payout not found');

      const clearingAccount = (await this.reports.accounts()).find((a) => a.systemKey === 'STRIPE_CLEARING');
      if (!clearingAccount) throw new ConflictException('Stripe clearing account not configured');

      const { entry } = await this.ledger.post({
        entryDate: tx.transactionDate,
        description: `Stripe payout ${payout.providerPayoutId ?? dto.targetId}`,
        reference: payout.providerPayoutId ?? undefined,
        currency: tx.currency,
        sourceType: 'stripe_payout',
        sourceId: payout.id,
        sourceEvent: 'payout.reconciled',
        createdBy: actor.id,
        requestId,
        lines: [
          { accountId: account.ledgerAccountId, debitMinor: tx.amountMinor, creditMinor: 0, description: 'Payout deposit' },
          { accountId: clearingAccount.id, debitMinor: 0, creditMinor: tx.amountMinor, description: 'Transfer from Stripe clearing' },
        ],
      });

      tx.status = 'MATCHED';
      tx.matchType = 'PAYOUT';
      tx.matchRef = dto.targetId;
      tx.postedJournalEntryId = entry.id;
    } else if (dto.type === 'BILL') {
      // Vendor bill payment match: DR Accounts Payable, CR Bank/Card account
      const bill = await this.ds.getRepository(Bill).findOne({ where: { id: dto.targetId } });
      if (!bill) throw new NotFoundException('Vendor bill not found');

      const apAccount = (await this.reports.accounts()).find((a) => a.systemKey === 'AP');
      if (!apAccount) throw new ConflictException('Accounts payable ledger account not found');

      const { entry } = await this.ledger.post({
        entryDate: tx.transactionDate,
        description: `Bill payment for ${bill.billNumber}`,
        reference: bill.billNumber,
        currency: tx.currency,
        sourceType: 'bill_payment',
        sourceId: bill.id,
        sourceEvent: 'bill.paid',
        createdBy: actor.id,
        requestId,
        lines: [
          { accountId: apAccount.id, debitMinor: tx.amountMinor, creditMinor: 0, description: `Payment of ${bill.billNumber}` },
          { accountId: account.ledgerAccountId, debitMinor: 0, creditMinor: tx.amountMinor, description: `${account.name} payout` },
        ],
      });

      // Update bill paid minor and status
      bill.paidMinor = (bill.paidMinor || 0) + tx.amountMinor;
      if (bill.paidMinor >= bill.totalMinor) {
        bill.status = 'PAID';
      }
      await this.ds.getRepository(Bill).save(bill);

      // Create BillPayment record
      await this.ds.getRepository(BillPayment).save(
        this.ds.getRepository(BillPayment).create({
          id: randomUUID(),
          billId: bill.id,
          financialTransactionId: tx.id,
          amountMinor: tx.amountMinor,
          paidDate: tx.transactionDate,
          journalEntryId: entry.id,
          createdBy: actor.id,
        }),
      );

      tx.status = 'MATCHED';
      tx.matchType = 'BILL';
      tx.matchRef = dto.targetId;
      tx.postedJournalEntryId = entry.id;
    } else if (dto.type === 'JOURNAL_ENTRY') {
      tx.status = 'MATCHED';
      tx.matchType = 'JOURNAL_ENTRY';
      tx.matchedJournalEntryId = dto.targetId;
    }

    tx.reviewedBy = actor.id;
    tx.reviewedAt = new Date();
    await this.transactions.save(tx);

    await this.audit?.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'banking.transaction_matched',
      entityType: 'financial_transaction',
      entityId: tx.id,
      summary: `${actor.email} matched transaction "${tx.description}" to ${dto.type} ${dto.targetId}`,
      metadata: { matchType: dto.type, targetId: dto.targetId },
    });

    return this.getTransaction(tx.id);
  }

  async exclude(id: string, dto: ExcludeDto, actor: AuthenticatedUser) {
    const tx = await this.transactions.findOne({ where: { id } });
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.status !== 'UNREVIEWED') {
      throw new ConflictException(`Transaction is already ${tx.status}`);
    }

    tx.status = 'EXCLUDED';
    tx.notes = dto.reason;
    tx.reviewedBy = actor.id;
    tx.reviewedAt = new Date();
    await this.transactions.save(tx);

    await this.audit?.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'banking.transaction_excluded',
      entityType: 'financial_transaction',
      entityId: tx.id,
      summary: `${actor.email} excluded transaction "${tx.description}": ${dto.reason}`,
      metadata: { reason: dto.reason },
    });

    return tx;
  }

  // --------------------------------------------------------------------------
  // Reconciliation Workflow
  // --------------------------------------------------------------------------

  async startReconciliation(dto: StartReconciliationDto, actor: AuthenticatedUser) {
    const open = await this.reconciliations.findOne({
      where: { accountId: dto.accountId, status: 'IN_PROGRESS' },
    });
    if (open) {
      throw new ConflictException('A reconciliation is already in progress for this account');
    }

    // Determine opening balance
    let openingBalanceMinor = dto.openingBalanceMinor ?? 0;
    const lastCompleted = await this.reconciliations.findOne({
      where: { accountId: dto.accountId, status: 'COMPLETED' },
      order: { statementEndDate: 'DESC' },
    });

    if (lastCompleted) {
      openingBalanceMinor = lastCompleted.statementEndingBalanceMinor;
    }

    const rec = await this.reconciliations.save(
      this.reconciliations.create({
        id: randomUUID(),
        accountId: dto.accountId,
        statementEndDate: dto.statementEndDate,
        openingBalanceMinor,
        statementEndingBalanceMinor: dto.statementEndingBalanceMinor,
        status: 'IN_PROGRESS',
        startedBy: actor.id,
      }),
    );

    return rec;
  }

  async getReconciliation(id: string) {
    const rec = await this.reconciliations.findOne({ where: { id } });
    if (!rec) throw new NotFoundException('Reconciliation not found');

    const eligibleTransactions = await this.transactions.find({
      where: {
        accountId: rec.accountId,
        status: In(['CATEGORIZED', 'MATCHED']),
      },
      order: { transactionDate: 'ASC' },
    });

    return {
      ...rec,
      eligibleTransactions,
    };
  }

  async completeReconciliation(id: string, dto: CompleteReconciliationDto, actor: AuthenticatedUser) {
    const rec = await this.reconciliations.findOne({ where: { id } });
    if (!rec) throw new NotFoundException('Reconciliation not found');
    if (rec.status !== 'IN_PROGRESS') {
      throw new ConflictException('Reconciliation is not in progress');
    }

    const clearedTxs = dto.clearedTransactionIds.length
      ? await this.transactions.find({
          where: { id: In(dto.clearedTransactionIds), accountId: rec.accountId },
        })
      : [];

    let depositsMinor = 0;
    let withdrawalsMinor = 0;

    for (const tx of clearedTxs) {
      if (tx.direction === 'CREDIT') {
        depositsMinor += tx.amountMinor;
      } else {
        withdrawalsMinor += tx.amountMinor;
      }
    }

    // Book cleared balance
    const clearedBalanceMinor = rec.openingBalanceMinor + depositsMinor - withdrawalsMinor;
    const differenceMinor = rec.statementEndingBalanceMinor - clearedBalanceMinor;

    // Mark cleared transactions as RECONCILED
    for (const tx of clearedTxs) {
      tx.status = 'RECONCILED';
      tx.reconciliationId = rec.id;
    }
    if (clearedTxs.length > 0) {
      await this.transactions.save(clearedTxs);
    }

    rec.clearedBalanceMinor = clearedBalanceMinor;
    rec.differenceMinor = differenceMinor;
    rec.status = 'COMPLETED';
    rec.completedBy = actor.id;
    rec.completedAt = new Date();
    await this.reconciliations.save(rec);

    await this.audit?.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'banking.reconciliation_completed',
      entityType: 'bank_reconciliation',
      entityId: rec.id,
      summary: `${actor.email} completed reconciliation ending ${rec.statementEndDate} (cleared ${clearedTxs.length} items, diff: ${differenceMinor})`,
      metadata: { clearedCount: clearedTxs.length, differenceMinor },
    });

    return rec;
  }
}
