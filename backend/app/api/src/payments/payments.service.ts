import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, In, Repository, SelectQueryBuilder } from 'typeorm';

import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { JournalEntry } from '../accounting/entities/journal-entry.entity';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { addDays, businessDayStartUtc, isIsoDate, toBusinessDate } from '../common/dates';
import { isUniqueViolation, rowLock, UUID_PATTERN } from '../common/db-types';
import { decimalToMinor, formatMinor, isSupportedCurrency, minorToDecimalString, normalizeCurrency } from '../common/money';
import { Customer } from '../customers/entities/customer.entity';
import { DIVISION_GREENWAVE, DIVISION_STORAGE_SYNONYMS, normalizeDivision } from '../divisions/divisions.constants';
import { DivisionsService } from '../divisions/divisions.service';
import { assertGreenWaveRecyclingFinanceAccess } from '../common/guards/recycling-finance.guard';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoicesService } from '../invoices/invoices.service';
import { isDeliverableAddress, MailService } from '../mail/mail.service';
import { invoiceEmail } from '../mail/mail.templates';
import { mapRefundStatus } from '../stripe/stripe-mappers';
import { StripeService } from '../stripe/stripe.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { CreateRefundDto } from './dto/create-refund.dto';
import { ListPaymentsQueryDto, PaymentSummaryQueryDto } from './dto/list-payments.query';
import { SendInvoiceDto } from './dto/send-invoice.dto';
import { PaymentRefund } from './entities/payment-refund.entity';
import { Payment } from './entities/payment.entity';
import { ProviderEvent } from './entities/provider-event.entity';
import { StripeBalanceTransaction } from './entities/stripe-balance-transaction.entity';
import { StripeDispute } from './entities/stripe-dispute.entity';
import { StripePayout } from './entities/stripe-payout.entity';
import { StripeSyncRun } from './entities/stripe-sync-run.entity';
import { PaymentLinkService } from './payment-link.service';
import { NON_PAYABLE_INVOICE_STATUSES, SETTLED_PAYMENT_STATUSES } from './payment-status';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;
const OPEN_REFUND_STATUSES = ['REQUESTED', 'PENDING', 'REQUIRES_ACTION'] as const;
const BALANCE_CACHE_MS = 60_000;

function num(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseJson(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  try {
    return JSON.parse(String(value)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Manager/admin payment operations. Every read is scoped to the actor's
 * divisions and warehouses through the payment's invoice; every mutation is
 * permission-checked by the controller and audited here.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private balanceCache: { at: number; value: unknown } | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(PaymentRefund) private readonly refunds: Repository<PaymentRefund>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    @InjectRepository(ProviderEvent) private readonly events: Repository<ProviderEvent>,
    @InjectRepository(StripePayout) private readonly payouts: Repository<StripePayout>,
    @InjectRepository(StripeDispute) private readonly disputes: Repository<StripeDispute>,
    @InjectRepository(StripeSyncRun) private readonly syncRuns: Repository<StripeSyncRun>,
    @InjectRepository(StripeBalanceTransaction) private readonly balanceTxns: Repository<StripeBalanceTransaction>,
    private readonly warehouses: WarehousesService,
    private readonly divisions: DivisionsService,
    private readonly invoicesService: InvoicesService,
    private readonly links: PaymentLinkService,
    private readonly stripe: StripeService,
    private readonly mail: MailService,
    private readonly posting: AccountingPostingService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Scoping
  // ---------------------------------------------------------------------------

  private hasGlobalWarehouseAccess(actor: AuthenticatedUser): boolean {
    return !!actor.hasGlobalAccess || !!actor.permissions?.includes('warehouses:global_access');
  }

  /** Restricts a query joined to invoices as `inv` to what the actor may read (strictly GreenWave Recycling). */
  private async scopeToActor<T extends object>(qb: SelectQueryBuilder<T>, actor: AuthenticatedUser): Promise<void> {
    assertGreenWaveRecyclingFinanceAccess(actor);
    const divisions = DIVISION_STORAGE_SYNONYMS[DIVISION_GREENWAVE];
    qb.andWhere('inv.division IN (:...scopeDivisions)', { scopeDivisions: divisions });
    if (!this.hasGlobalWarehouseAccess(actor)) {
      const ids = await this.warehouses.getUserAuthorizedWarehouseIds(actor.id, actor.role, actor.permissions);
      if (ids.length === 0) qb.andWhere('inv.warehouseId IS NULL');
      else qb.andWhere('(inv.warehouseId IN (:...scopeWarehouses) OR inv.warehouseId IS NULL)', { scopeWarehouses: ids });
    }
  }

  private async assertInvoiceAccess(actor: AuthenticatedUser, invoice: Invoice): Promise<void> {
    assertGreenWaveRecyclingFinanceAccess(actor);
    if (invoice.warehouseId) await this.warehouses.assertWarehouseAccess(actor, invoice.warehouseId);
    await this.divisions.assertStoredDivisionAccess(actor, invoice.division);
    const invoiceCanonical = normalizeDivision(invoice.division);
    if (invoiceCanonical !== DIVISION_GREENWAVE) {
      throw new ForbiddenException('Financial operations are strictly restricted to the GreenWave Recycling division');
    }
  }

  private async loadInvoiceForActor(invoiceId: string, actor: AuthenticatedUser): Promise<Invoice> {
    const invoice = await this.invoices.findOne({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    await this.assertInvoiceAccess(actor, invoice);
    return invoice;
  }

  private async loadPaymentForActor(paymentId: string, actor: AuthenticatedUser): Promise<{ payment: Payment; invoice: Invoice }> {
    const payment = await this.payments.findOne({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    const invoice = await this.invoices.findOne({ where: { id: payment.invoiceId } });
    if (!invoice) throw new NotFoundException('Payment not found');
    await this.assertInvoiceAccess(actor, invoice);
    return { payment, invoice };
  }

  // ---------------------------------------------------------------------------
  // Payments list / detail / summary
  // ---------------------------------------------------------------------------

  async list(actor: AuthenticatedUser, q: ListPaymentsQueryDto) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const qb = this.payments
      .createQueryBuilder('p')
      .innerJoin(Invoice, 'inv', 'inv.id = p.invoiceId')
      .leftJoin(Customer, 'c', 'c.id = p.customerId');
    await this.scopeToActor(qb, actor);

    if (q.status) qb.andWhere('p.status = :status', { status: q.status });
    if (q.customerId) qb.andWhere('p.customerId = :customerId', { customerId: q.customerId });
    if (q.invoiceId) qb.andWhere('p.invoiceId = :invoiceId', { invoiceId: q.invoiceId });
    if (q.method) qb.andWhere('p.paymentMethodType = :method', { method: q.method });
    if (q.currency) qb.andWhere('p.currency = :currency', { currency: q.currency });
    if (q.from) {
      if (!isIsoDate(q.from)) throw new BadRequestException('from must be a valid date');
      qb.andWhere('COALESCE(p.paidAt, p.createdAt) >= :from', { from: businessDayStartUtc(q.from) });
    }
    if (q.to) {
      if (!isIsoDate(q.to)) throw new BadRequestException('to must be a valid date');
      qb.andWhere('COALESCE(p.paidAt, p.createdAt) < :to', { to: businessDayStartUtc(addDays(q.to, 1)) });
    }
    const term = q.q?.trim();
    if (term) {
      const like = `%${escapeLike(term.toLowerCase())}%`;
      const clauses = [
        "LOWER(inv.invoiceNumber) LIKE :like ESCAPE '\\'",
        "LOWER(c.name) LIKE :like ESCAPE '\\'",
        'p.providerPaymentId = :exact',
        'p.providerChargeId = :exact',
      ];
      if (UUID_PATTERN.test(term)) clauses.push('p.id = :uuid');
      qb.andWhere(`(${clauses.join(' OR ')})`, { like, exact: term, uuid: term.toLowerCase() });
    }

    const total = await qb.clone().getCount();
    const rows = await qb
      .select([
        'p.id AS id',
        'p.invoiceId AS "invoiceId"',
        'inv.invoiceNumber AS "invoiceNumber"',
        'p.customerId AS "customerId"',
        'c.name AS "customerName"',
        'p.amountMinor AS "amountMinor"',
        'p.currency AS currency',
        'p.status AS status',
        'p.paymentMethodType AS "paymentMethodType"',
        'p.paymentMethodDisplay AS "paymentMethodDisplay"',
        'p.paidAt AS "paidAt"',
        'p.createdAt AS "createdAt"',
        'p.providerPaymentId AS "providerPaymentId"',
        'p.feeMinor AS "feeMinor"',
        'p.netMinor AS "netMinor"',
        'p.refundedMinor AS "refundedMinor"',
        'p.disputedMinor AS "disputedMinor"',
        'p.disputeStatus AS "disputeStatus"',
        'p.metadata AS metadata',
      ])
      .orderBy('COALESCE(p.paidAt, p.createdAt)', 'DESC')
      .addOrderBy('p.id', 'DESC')
      .offset((page - 1) * pageSize)
      .limit(pageSize)
      .getRawMany<Record<string, unknown>>();

    return {
      page,
      pageSize,
      total,
      items: rows.map((r) => {
        const meta = parseJson(r.metadata);
        return {
          id: r.id,
          invoiceId: r.invoiceId,
          invoiceNumber: r.invoiceNumber,
          customerId: r.customerId ?? null,
          customerName: r.customerName ?? null,
          amountMinor: num(r.amountMinor),
          currency: r.currency,
          status: r.status,
          paymentMethodType: r.paymentMethodType ?? null,
          paymentMethodDisplay: r.paymentMethodDisplay ?? null,
          paidAt: iso(r.paidAt),
          createdAt: iso(r.createdAt),
          providerPaymentId: r.providerPaymentId ?? null,
          feeMinor: r.feeMinor === null || r.feeMinor === undefined ? null : num(r.feeMinor),
          netMinor: r.netMinor === null || r.netMinor === undefined ? null : num(r.netMinor),
          refundedMinor: num(r.refundedMinor),
          disputedMinor: num(r.disputedMinor),
          disputeStatus: r.disputeStatus ?? null,
          reviewRequired: !!meta?.reviewRequired,
          legacy: !!meta?.legacySimulatedGateway,
        };
      }),
    };
  }

  async get(paymentId: string, actor: AuthenticatedUser) {
    const { payment: p, invoice } = await this.loadPaymentForActor(paymentId, actor);
    const [refunds, disputes, customer, entries] = await Promise.all([
      this.refunds.find({ where: { paymentId: p.id }, order: { createdAt: 'DESC' } }),
      this.disputes.find({ where: { paymentId: p.id }, order: { providerCreated: 'DESC' } }),
      p.customerId ? this.customers.findOne({ where: { id: p.customerId } }) : Promise.resolve(null),
      this.dataSource.getRepository(JournalEntry).find({
        where: [
          { sourceType: 'payment', sourceId: p.id },
          { sourceType: 'invoice', sourceId: invoice.id },
        ],
        order: { createdAt: 'ASC' },
        take: 50,
      }),
    ]);
    const objectIds = [p.providerPaymentId, p.providerChargeId, ...refunds.map((r) => r.providerRefundId)].filter(
      (v): v is string => !!v,
    );
    const events = objectIds.length
      ? await this.events.find({ where: { objectId: In(objectIds) }, order: { receivedAt: 'DESC' }, take: 50 })
      : [];
    const pendingRefunds = refunds
      .filter((r) => (OPEN_REFUND_STATUSES as readonly string[]).includes(r.status))
      .reduce((sum, r) => sum + r.amountMinor, 0);
    const refundable =
      (p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED') && p.providerPaymentId && !p.metadata?.legacySimulatedGateway
        ? Math.max(0, p.amountMinor - p.refundedMinor - pendingRefunds)
        : 0;

    return {
      payment: {
        id: p.id,
        status: p.status,
        amountMinor: p.amountMinor,
        currency: p.currency,
        feeMinor: p.feeMinor,
        netMinor: p.netMinor,
        refundedMinor: p.refundedMinor,
        disputedMinor: p.disputedMinor,
        disputeStatus: p.disputeStatus,
        refundableMinor: refundable,
        paymentMethodType: p.paymentMethodType,
        paymentMethodDisplay: p.paymentMethodDisplay,
        provider: p.provider,
        providerPaymentId: p.providerPaymentId,
        providerChargeId: p.providerChargeId,
        failureReason: p.failureReason,
        reviewRequired: !!p.metadata?.reviewRequired,
        problems: Array.isArray(p.metadata?.problems) ? p.metadata?.problems : [],
        legacy: !!p.metadata?.legacySimulatedGateway,
        paidAt: iso(p.paidAt),
        failedAt: iso(p.failedAt),
        canceledAt: iso(p.canceledAt),
        createdAt: iso(p.createdAt),
      },
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        paymentStatus: invoice.paymentStatus,
        total: invoice.total,
        currency: invoice.currency,
        dueDate: invoice.dueDate,
      },
      customer: customer ? { id: customer.id, name: customer.name } : null,
      refunds: refunds.map((r) => ({
        id: r.id,
        amountMinor: r.amountMinor,
        currency: r.currency,
        status: r.status,
        reason: r.reason,
        note: r.note,
        failureReason: r.failureReason,
        providerRefundId: r.providerRefundId,
        requestedBy: r.requestedBy,
        createdAt: iso(r.createdAt),
        succeededAt: iso(r.succeededAt),
      })),
      disputes: disputes.map((d) => ({
        id: d.providerDisputeId,
        amountMinor: d.amountMinor,
        currency: d.currency,
        status: d.status,
        reason: d.reason,
        evidenceDueBy: iso(d.evidenceDueBy),
      })),
      providerEvents: events.map((e) => ({
        id: e.providerEventId,
        type: e.eventType,
        status: e.status,
        attempts: e.attempts,
        note: e.lastError,
        receivedAt: iso(e.receivedAt),
      })),
      journalEntries: entries.map((e) => ({
        id: e.id,
        entryDate: e.entryDate,
        description: e.description,
        status: e.status,
        sourceType: e.sourceType,
        sourceEvent: e.sourceEvent,
      })),
    };
  }

  async summary(actor: AuthenticatedUser, q: PaymentSummaryQueryDto) {
    const currency = normalizeCurrency(q.currency ?? 'CAD');
    const range = (qb: SelectQueryBuilder<any>, column: string) => {
      if (q.from) qb.andWhere(`${column} >= :from`, { from: businessDayStartUtc(q.from) });
      if (q.to) qb.andWhere(`${column} < :to`, { to: businessDayStartUtc(addDays(q.to, 1)) });
    };

    const settled = this.payments
      .createQueryBuilder('p')
      .innerJoin(Invoice, 'inv', 'inv.id = p.invoiceId')
      .where('p.currency = :currency', { currency })
      .andWhere('p.status IN (:...settled)', { settled: [...SETTLED_PAYMENT_STATUSES] });
    await this.scopeToActor(settled, actor);
    range(settled, 'p.paidAt');
    const totals = await settled
      .select('COALESCE(SUM(p.amountMinor), 0)', 'collected')
      .addSelect('COALESCE(SUM(p.feeMinor), 0)', 'fees')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(CASE WHEN p.feeMinor IS NULL THEN 1 ELSE 0 END)', 'feesUnknown')
      .getRawOne<Record<string, unknown>>();

    const refundsQb = this.refunds
      .createQueryBuilder('r')
      .innerJoin(Payment, 'p', 'p.id = r.paymentId')
      .innerJoin(Invoice, 'inv', 'inv.id = p.invoiceId')
      .where('r.currency = :currency', { currency })
      .andWhere("r.status = 'SUCCEEDED'");
    await this.scopeToActor(refundsQb, actor);
    range(refundsQb, 'r.succeededAt');
    const refunded = await refundsQb.select('COALESCE(SUM(r.amountMinor), 0)', 'amount').getRawOne<Record<string, unknown>>();

    const disputedQb = this.payments
      .createQueryBuilder('p')
      .innerJoin(Invoice, 'inv', 'inv.id = p.invoiceId')
      .where('p.currency = :currency', { currency })
      .andWhere("p.status = 'DISPUTED'");
    await this.scopeToActor(disputedQb, actor);
    const disputed = await disputedQb.select('COALESCE(SUM(p.disputedMinor), 0)', 'amount').getRawOne<Record<string, unknown>>();

    const byStatusQb = this.payments
      .createQueryBuilder('p')
      .innerJoin(Invoice, 'inv', 'inv.id = p.invoiceId')
      .where('p.currency = :currency', { currency });
    await this.scopeToActor(byStatusQb, actor);
    range(byStatusQb, 'p.createdAt');
    const byStatus = await byStatusQb
      .select('p.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('p.status')
      .getRawMany<Record<string, unknown>>();

    const collected = num(totals?.collected);
    const fees = num(totals?.fees);
    const refundedMinor = num(refunded?.amount);
    return {
      currency,
      from: q.from ?? null,
      to: q.to ?? null,
      collectedMinor: collected,
      feesMinor: fees,
      feesUnknownCount: num(totals?.feesUnknown),
      refundedMinor,
      disputedMinor: num(disputed?.amount),
      netMinor: collected - fees - refundedMinor,
      settledCount: num(totals?.count),
      countsByStatus: Object.fromEntries(byStatus.map((r) => [String(r.status), num(r.count)])),
    };
  }

  /** Legacy KPI shape used by the invoices screen (decimal amounts). Aggregated in SQL. */
  async metrics(actor: AuthenticatedUser, warehouseId?: string) {
    if (warehouseId) await this.warehouses.assertWarehouseAccess(actor, warehouseId);
    const currency = 'CAD';
    const today = toBusinessDate(new Date());

    const qb = this.invoices.createQueryBuilder('inv').where('inv.currency = :currency', { currency });
    await this.scopeToActor(qb, actor);
    if (warehouseId) qb.andWhere('inv.warehouseId = :warehouseId', { warehouseId });
    const rows = await qb
      .select('inv.paymentStatus', 'paymentStatus')
      .addSelect('inv.status', 'status')
      .addSelect(`CASE WHEN inv.dueDate < :today THEN 1 ELSE 0 END`, 'overdue')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(inv.total), 0)', 'total')
      .setParameter('today', today)
      .groupBy('inv.paymentStatus')
      .addGroupBy('inv.status')
      .addGroupBy(`CASE WHEN inv.dueDate < :today THEN 1 ELSE 0 END`)
      .getRawMany<Record<string, unknown>>();

    let outstanding = 0;
    let paidAll = 0;
    const counts = { unpaid: 0, pending: 0, paid: 0, failed: 0, refunded: 0, overdue: 0, total: 0 };
    for (const r of rows) {
      const count = num(r.count);
      const minor = decimalToMinor(String(r.total ?? '0'), currency);
      const ps = String(r.paymentStatus || 'unpaid').toLowerCase();
      const docStatus = String(r.status || '').toLowerCase();
      counts.total += count;
      if (ps === 'paid') {
        counts.paid += count;
        paidAll += minor;
      } else if (ps === 'refunded' || ps === 'partially_refunded') {
        counts.refunded += count;
      } else if (docStatus !== 'draft' && !NON_PAYABLE_INVOICE_STATUSES.includes(docStatus)) {
        outstanding += minor;
        if (ps === 'processing' || ps === 'pending') counts.pending += count;
        else if (ps === 'failed') counts.failed += count;
        else counts.unpaid += count;
        if (num(r.overdue) === 1) counts.overdue += count;
      }
    }

    const monthStart = `${today.slice(0, 7)}-01`;
    const paidMonthQb = this.payments
      .createQueryBuilder('p')
      .innerJoin(Invoice, 'inv', 'inv.id = p.invoiceId')
      .where('p.currency = :currency', { currency })
      .andWhere('p.status IN (:...settled)', { settled: [...SETTLED_PAYMENT_STATUSES] })
      .andWhere('p.paidAt >= :monthStart', { monthStart: businessDayStartUtc(monthStart) });
    await this.scopeToActor(paidMonthQb, actor);
    if (warehouseId) paidMonthQb.andWhere('inv.warehouseId = :warehouseId', { warehouseId });
    const paidMonth = await paidMonthQb.select('COALESCE(SUM(p.amountMinor), 0)', 'amount').getRawOne<Record<string, unknown>>();

    const toNumber = (minor: number) => Number(minorToDecimalString(minor, currency));
    return {
      totalOutstanding: toNumber(outstanding),
      paidThisMonth: toNumber(num(paidMonth?.amount)),
      totalPaidAllTime: toNumber(paidAll),
      unpaidCount: counts.unpaid,
      pendingCount: counts.pending,
      paidCount: counts.paid,
      failedCount: counts.failed,
      refundedCount: counts.refunded,
      overdueCount: counts.overdue,
      totalInvoicesCount: counts.total,
      currency,
    };
  }

  /**
   * Company-wide Stripe view (balance, payouts, sync and webhook health). The
   * Stripe account is not division- or warehouse-scoped, so this requires
   * global access in addition to the controller's permission.
   */
  async stripeOverview(actor: AuthenticatedUser) {
    assertGreenWaveRecyclingFinanceAccess(actor);
    if (actor.role !== 'admin' && !this.hasGlobalWarehouseAccess(actor)) {
      throw new NotFoundException('Not available');
    }
    const configured = this.stripe.isPaymentsConfigured();
    let balance: unknown = { available: [], pending: [], status: configured ? 'unavailable' : 'not_configured' };
    if (configured) {
      if (this.balanceCache && Date.now() - this.balanceCache.at < BALANCE_CACHE_MS) {
        balance = this.balanceCache.value;
      } else {
        try {
          const b = await this.stripe.retrieveBalance();
          const map = (arr: Array<{ amount: number; currency: string }>) =>
            arr.map((x) => ({ amountMinor: x.amount, currency: x.currency.toUpperCase() }));
          balance = { available: map(b.available), pending: map(b.pending), status: 'ok', retrievedAt: new Date().toISOString() };
          this.balanceCache = { at: Date.now(), value: balance };
        } catch (err) {
          this.logger.warn(`Stripe balance unavailable: ${JSON.stringify(StripeService.safeError(err))}`);
        }
      }
    }

    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const [recentPayouts, lastRun, lastSuccessfulRun, eventHealth, lastEvent, activity] = await Promise.all([
      this.payouts.find({ order: { providerCreated: 'DESC' }, take: 10 }),
      this.syncRuns.findOne({ where: {}, order: { startedAt: 'DESC' } }),
      this.syncRuns.findOne({ where: { status: 'SUCCEEDED' }, order: { startedAt: 'DESC' } }),
      this.events
        .createQueryBuilder('e')
        .select('e.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('e.receivedAt >= :since', { since })
        .groupBy('e.status')
        .getRawMany<Record<string, unknown>>(),
      this.events.findOne({ where: {}, order: { receivedAt: 'DESC' } }),
      this.balanceTxns
        .createQueryBuilder('bt')
        .select('bt.type', 'type')
        .addSelect('bt.currency', 'currency')
        .addSelect('COALESCE(SUM(bt.amountMinor), 0)', 'amount')
        .addSelect('COALESCE(SUM(bt.feeMinor), 0)', 'fee')
        .addSelect('COUNT(*)', 'count')
        .where('bt.providerCreated >= :since30', { since30: new Date(Date.now() - 30 * 86_400_000) })
        .groupBy('bt.type')
        .addGroupBy('bt.currency')
        .getRawMany<Record<string, unknown>>(),
    ]);

    return {
      configured,
      mode: this.stripe.mode(),
      webhookConfigured: this.stripe.isWebhookConfigured(),
      balance,
      recentPayouts: recentPayouts.map((po) => ({
        id: po.providerPayoutId,
        amountMinor: po.amountMinor,
        currency: po.currency,
        status: po.status,
        arrivalDate: iso(po.arrivalDate),
        method: po.method,
      })),
      last30DaysActivity: activity.map((a) => ({
        type: a.type,
        currency: a.currency,
        amountMinor: num(a.amount),
        feeMinor: num(a.fee),
        count: num(a.count),
      })),
      sync: {
        lastRun: lastRun ? { id: lastRun.id, kind: lastRun.kind, status: lastRun.status, startedAt: iso(lastRun.startedAt), finishedAt: iso(lastRun.finishedAt), error: lastRun.error } : null,
        lastSuccessAt: iso(lastSuccessfulRun?.finishedAt),
      },
      webhooks: {
        last24h: Object.fromEntries(eventHealth.map((r) => [String(r.status), num(r.count)])),
        lastReceivedAt: iso(lastEvent?.receivedAt),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Refunds
  // ---------------------------------------------------------------------------

  async refund(paymentId: string, actor: AuthenticatedUser, dto: CreateRefundDto, idempotencyKey: string | undefined, requestId: string | null) {
    if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw new BadRequestException('An Idempotency-Key header (8-128 characters: letters, digits, - or _) is required');
    }
    const scopedKey = `refund:${actor.id}:${idempotencyKey}`;
    const { payment } = await this.loadPaymentForActor(paymentId, actor);

    const prior = await this.refunds.findOne({ where: { idempotencyKey: scopedKey } });
    if (prior) {
      if (prior.paymentId !== payment.id) throw new ConflictException('Idempotency-Key was already used for a different payment');
      return { duplicate: true, refund: this.refundView(prior) };
    }

    let refund: PaymentRefund;
    try {
      refund = await this.dataSource.transaction(async (m) => {
        const p = await m.getRepository(Payment).findOne({ where: { id: payment.id }, lock: rowLock(m) });
        if (!p) throw new NotFoundException('Payment not found');
        if (p.metadata?.legacySimulatedGateway || p.provider !== 'stripe' || !p.providerPaymentId) {
          throw new ConflictException('This payment was not processed through Stripe and cannot be refunded here');
        }
        if (p.status !== 'SUCCEEDED' && p.status !== 'PARTIALLY_REFUNDED') {
          throw new ConflictException(`A ${p.status} payment cannot be refunded`);
        }
        const open = await m.getRepository(PaymentRefund).find({ where: { paymentId: p.id, status: In([...OPEN_REFUND_STATUSES]) } });
        const pending = open.reduce((s, r) => s + r.amountMinor, 0);
        const eligible = p.amountMinor - p.refundedMinor - pending;
        const amount = dto.amountMinor ?? eligible;
        if (eligible <= 0) throw new ConflictException('Nothing left to refund on this payment');
        if (amount < 1 || amount > eligible) {
          throw new BadRequestException(`Refund amount must be between 1 and ${eligible} (${formatMinor(eligible, p.currency)})`);
        }
        const repo = m.getRepository(PaymentRefund);
        const created = await repo.save(
          repo.create({
            id: randomUUID(),
            paymentId: p.id,
            provider: 'stripe',
            providerRefundId: null,
            amountMinor: amount,
            currency: p.currency,
            status: 'REQUESTED',
            reason: dto.reason ?? null,
            note: dto.note?.trim() || null,
            failureReason: null,
            idempotencyKey: scopedKey,
            requestedBy: actor.id,
            succeededAt: null,
          }),
        );
        await this.audit.record(
          {
            actorUserId: actor.id,
            actorRole: actor.role,
            action: 'refund.requested',
            entityType: 'payment_refund',
            entityId: created.id,
            warehouseId: p.warehouseId,
            summary: `${actor.email} requested a ${amount === p.amountMinor - p.refundedMinor ? 'full' : 'partial'} refund of ${formatMinor(amount, p.currency)} on payment ${p.id}`,
            metadata: { paymentId: p.id, amountMinor: amount, reason: dto.reason ?? null, requestId },
          },
          m,
        );
        return created;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const again = await this.refunds.findOne({ where: { idempotencyKey: scopedKey } });
        if (again) return { duplicate: true, refund: this.refundView(again) };
      }
      throw err;
    }

    try {
      const result = await this.stripe.createRefund(
        {
          payment_intent: payment.providerPaymentId!,
          amount: refund.amountMinor,
          ...(refund.reason ? { reason: refund.reason as 'duplicate' | 'fraudulent' | 'requested_by_customer' } : {}),
          metadata: { greenwave_refund_id: refund.id, greenwave_payment_id: payment.id },
        },
        `gw-refund-${refund.id}`,
      );
      // Only advance from REQUESTED: the refund webhook may already have
      // applied a later state, which this response must never overwrite.
      await this.refunds.update({ id: refund.id, providerRefundId: null as unknown as string }, { providerRefundId: result.id });
      const mapped = mapRefundStatus(result.status);
      await this.refunds.update(
        { id: refund.id, status: 'REQUESTED' },
        { status: mapped === 'FAILED' || mapped === 'CANCELED' ? mapped : 'PENDING' },
      );
    } catch (err) {
      const safe = StripeService.safeError(err);
      await this.refunds.update({ id: refund.id, status: 'REQUESTED' }, { status: 'FAILED', failureReason: `provider_error:${safe.code ?? safe.type}` });
      await this.audit.record({
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'refund.provider_rejected',
        entityType: 'payment_refund',
        entityId: refund.id,
        warehouseId: payment.warehouseId,
        summary: `Stripe rejected refund ${refund.id}${safe.code ? ` (${safe.code})` : ''}`,
        metadata: { paymentId: payment.id, stripeRequestId: safe.requestId, requestId },
      });
      this.logger.error(`Refund ${refund.id} rejected by Stripe: ${JSON.stringify(safe)} [request ${requestId ?? '-'}]`);
      throw new BadGatewayException(`Stripe did not accept the refund${safe.code ? ` (${safe.code})` : ''}`);
    }

    const latest = await this.refunds.findOne({ where: { id: refund.id } });
    return {
      duplicate: false,
      refund: this.refundView(latest ?? refund),
      message: 'Refund submitted to Stripe. The payment is updated when Stripe confirms it.',
    };
  }

  private refundView(r: PaymentRefund) {
    return {
      id: r.id,
      paymentId: r.paymentId,
      amountMinor: r.amountMinor,
      currency: r.currency,
      status: r.status,
      reason: r.reason,
      providerRefundId: r.providerRefundId,
      createdAt: iso(r.createdAt),
    };
  }

  // ---------------------------------------------------------------------------
  // Payment links and sending invoices
  // ---------------------------------------------------------------------------

  async getPaymentLink(invoiceId: string, actor: AuthenticatedUser, mode: 'get' | 'regenerate', requestId: string | null) {
    await this.loadInvoiceForActor(invoiceId, actor);
    return this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(Invoice);
      const inv = await repo.findOne({ where: { id: invoiceId }, lock: rowLock(m) });
      if (!inv) throw new NotFoundException('Invoice not found');
      const status = (inv.status || '').toLowerCase();
      if (NON_PAYABLE_INVOICE_STATUSES.includes(status)) throw new ConflictException(`A ${status} invoice cannot be paid`);
      if ((inv.paymentStatus || '').toLowerCase() === 'paid') throw new ConflictException('This invoice is already paid');
      if (!isSupportedCurrency(inv.currency)) throw new BadRequestException('Unsupported invoice currency');
      const currency = normalizeCurrency(inv.currency);
      const amountMinor = decimalToMinor(inv.total ?? '0', currency);
      if (amountMinor <= 0) throw new BadRequestException('This invoice has no amount due');

      if (status === 'draft') {
        // A payable link issues the invoice: it becomes a receivable.
        inv.status = 'final';
        await repo.update(inv.id, { status: 'final', updatedBy: actor.id });
        await this.posting.syncInvoiceIssued(inv, { actorId: actor.id, requestId }, m);
        await this.audit.record(
          { actorUserId: actor.id, actorRole: actor.role, action: 'invoice.issued', entityType: 'invoice', entityId: inv.id, warehouseId: inv.warehouseId, summary: `${actor.email} issued invoice #${inv.invoiceNumber}`, metadata: { requestId } },
          m,
        );
      }

      let token: string | null = null;
      const active = !inv.paymentLinkRevokedAt;
      if (mode === 'get' && active && inv.paymentLinkNonce && inv.paymentTokenHash) {
        const derived = this.links.tokenForNonce(inv.paymentLinkNonce);
        if (this.links.hashToken(derived) !== inv.paymentTokenHash) {
          throw new ConflictException('The payment-link secret has changed. Regenerate this link.');
        }
        token = derived;
      } else if (mode === 'get' && active && !inv.paymentLinkNonce && inv.paymentToken && inv.paymentTokenHash) {
        token = inv.paymentToken; // pre-019 link, still valid
      }

      let created = false;
      if (!token) {
        const nonce = this.links.newNonce();
        token = this.links.tokenForNonce(nonce);
        await repo.update(inv.id, {
          paymentLinkNonce: nonce,
          paymentTokenHash: this.links.hashToken(token),
          paymentToken: null,
          paymentLinkCreatedAt: new Date(),
          paymentLinkRevokedAt: null,
        });
        created = true;
        await this.audit.record(
          {
            actorUserId: actor.id,
            actorRole: actor.role,
            action: mode === 'regenerate' ? 'payment.link_regenerated' : 'payment.link_created',
            entityType: 'invoice',
            entityId: inv.id,
            warehouseId: inv.warehouseId,
            summary: `${actor.email} ${mode === 'regenerate' ? 'regenerated' : 'created'} the payment link for invoice #${inv.invoiceNumber}`,
            metadata: { requestId },
          },
          m,
        );
      }

      return {
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        paymentUrl: this.links.urlForToken(token),
        created,
        amountMinor,
        currency,
        status: inv.status,
        paymentStatus: inv.paymentStatus,
      };
    });
  }

  async revokePaymentLink(invoiceId: string, actor: AuthenticatedUser, requestId: string | null) {
    const inv = await this.loadInvoiceForActor(invoiceId, actor);
    if (!inv.paymentTokenHash || inv.paymentLinkRevokedAt) return { invoiceId, revoked: false };
    await this.invoices.update(inv.id, { paymentLinkRevokedAt: new Date() });
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'payment.link_revoked',
      entityType: 'invoice',
      entityId: inv.id,
      warehouseId: inv.warehouseId,
      summary: `${actor.email} revoked the payment link for invoice #${inv.invoiceNumber}`,
      metadata: { requestId },
    });
    return { invoiceId, revoked: true };
  }

  async sendInvoice(invoiceId: string, actor: AuthenticatedUser, dto: SendInvoiceDto, requestId: string | null) {
    const inv = await this.loadInvoiceForActor(invoiceId, actor);
    if (!this.mail.isConfigured()) {
      throw new ServiceUnavailableException('Outgoing email is not configured on the server; the invoice was not sent');
    }
    const status = (inv.status || '').toLowerCase();
    if (NON_PAYABLE_INVOICE_STATUSES.includes(status)) throw new ConflictException(`A ${status} invoice cannot be sent`);

    const customer = inv.customerId ? await this.customers.findOne({ where: { id: inv.customerId } }) : null;
    const recipient = dto.recipientEmail?.trim() || customer?.email || null;
    if (!isDeliverableAddress(recipient)) throw new BadRequestException('A valid recipient email address is required');
    if (!isSupportedCurrency(inv.currency)) throw new BadRequestException('Unsupported invoice currency');
    const currency = normalizeCurrency(inv.currency);
    const totalMinor = decimalToMinor(inv.total ?? '0', currency);

    let paymentUrl: string | null = null;
    if ((inv.paymentStatus || '').toLowerCase() !== 'paid' && totalMinor > 0) {
      paymentUrl = (await this.getPaymentLink(inv.id, actor, 'get', requestId)).paymentUrl;
    } else if (status === 'draft') {
      await this.dataSource.transaction(async (m) => {
        await m.getRepository(Invoice).update(inv.id, { status: 'final', updatedBy: actor.id });
        inv.status = 'final';
        await this.posting.syncInvoiceIssued(inv, { actorId: actor.id, requestId }, m);
      });
    }

    let pdf: Buffer;
    try {
      pdf = await this.invoicesService.generatePdf(dto.documentHtml);
    } catch (err) {
      this.logger.error(`Invoice PDF render failed for ${inv.id}: ${(err as Error)?.name ?? 'Error'} [request ${requestId ?? '-'}]`);
      throw new BadGatewayException('The invoice PDF could not be generated; the invoice was not sent');
    }

    const email = invoiceEmail({
      invoiceNumber: inv.invoiceNumber,
      customerName: customer?.name ?? ((inv.billTo || '').split('\n')[0].trim() || null),
      totalDisplay: formatMinor(totalMinor, currency),
      dueDate: inv.dueDate,
      payUrl: paymentUrl,
      message: dto.customMessage?.trim() || null,
    });
    const safeNumber = inv.invoiceNumber.replace(/[^A-Za-z0-9_-]/g, '');
    const result = await this.mail.sendOnce({
      dedupeKey: `invoice-send:${inv.id}:${dto.idempotencyKey ?? randomUUID()}`,
      template: 'invoice',
      to: recipient,
      ...email,
      attachments: [{ filename: `Invoice-${safeNumber}.pdf`, content: pdf, contentType: 'application/pdf' }],
      entityType: 'invoice',
      entityId: inv.id,
    });

    if (result.status === 'SKIPPED') throw new ServiceUnavailableException('Outgoing email is not configured; the invoice was not sent');
    if (result.status === 'FAILED') throw new BadGatewayException('The email server rejected the message; the invoice was not sent');

    const sentAt = new Date();
    if (result.status === 'SENT') {
      await this.invoices.update(inv.id, { sentAt, recipientEmail: recipient });
      await this.audit.record({
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'invoice.sent',
        entityType: 'invoice',
        entityId: inv.id,
        warehouseId: inv.warehouseId,
        summary: `${actor.email} emailed invoice #${inv.invoiceNumber} to ${recipient}`,
        metadata: { withPaymentLink: !!paymentUrl, requestId },
      });
    }
    return {
      delivered: true,
      duplicate: result.status === 'DUPLICATE',
      recipient,
      invoiceNumber: inv.invoiceNumber,
      paymentUrl,
      sentAt: sentAt.toISOString(),
    };
  }
}
