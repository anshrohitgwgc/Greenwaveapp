import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import type Stripe from 'stripe';
import { DataSource, EntityManager, In, Not, Repository } from 'typeorm';

import { AccountingPostingService, PostingContext } from '../accounting/accounting-posting.service';
import { AuditService } from '../audit/audit.service';
import { isUniqueViolation, rowLock, UUID_PATTERN } from '../common/db-types';
import { decimalToMinor, formatMinor, isSupportedCurrency, minorToDecimalString } from '../common/money';
import { Invoice } from '../invoices/entities/invoice.entity';
import { describePaymentMethod, idOf, mapRefundStatus } from '../stripe/stripe-mappers';
import { StripeService } from '../stripe/stripe.service';
import { PaymentRefund } from './entities/payment-refund.entity';
import { Payment } from './entities/payment.entity';
import { ProviderEvent, ProviderEventStatus } from './entities/provider-event.entity';
import { PaymentNotificationsService } from './payment-notifications.service';
import { NON_PAYABLE_INVOICE_STATUSES, SETTLED_PAYMENT_STATUSES } from './payment-status';
import { upsertBalanceTransaction, upsertDispute, upsertPayout } from './stripe-mirror';

/**
 * The exact event set to enable on the Stripe webhook endpoint.
 * Documented in STRIPE_PRODUCTION_SETUP.md; anything else is recorded and ignored.
 */
export const STRIPE_WEBHOOK_EVENTS = [
  'payment_intent.succeeded',
  'payment_intent.processing',
  'payment_intent.requires_action',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'charge.updated',
  'refund.created',
  'refund.updated',
  'refund.failed',
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
  'charge.dispute.funds_withdrawn',
  'charge.dispute.funds_reinstated',
  'payout.paid',
  'payout.failed',
  'payout.updated',
  'payout.canceled',
] as const;

const HANDLED_EVENTS = new Set<string>(STRIPE_WEBHOOK_EVENTS);
const IN_FLIGHT_WINDOW_MS = 120_000;

interface Outcome {
  status: Extract<ProviderEventStatus, 'PROCESSED' | 'IGNORED'>;
  note?: string;
  /** Side effects that must happen only after the transaction commits (email). */
  after?: () => Promise<void>;
}

type Claim =
  | { kind: 'new' | 'retry'; row: ProviderEvent }
  | { kind: 'duplicate'; status: ProviderEventStatus }
  | { kind: 'in_flight' };

function safeError(err: unknown): string {
  if (err instanceof HttpException) return `${err.name}: ${err.message}`.slice(0, 300);
  const e = err as { name?: string; code?: string; message?: string; type?: string };
  if (typeof e?.type === 'string' && e.type.startsWith('Stripe')) {
    const s = StripeService.safeError(err);
    return `${s.type}${s.code ? `:${s.code}` : ''}${s.requestId ? ` request=${s.requestId}` : ''}`;
  }
  return `${e?.name ?? 'Error'}${e?.code ? `:${e.code}` : ''}: ${String(e?.message ?? '').slice(0, 200)}`;
}

function summarize(obj: Record<string, unknown>): Record<string, unknown> {
  const pick = (k: string) => (typeof obj[k] === 'string' ? String(obj[k]).slice(0, 64) : undefined);
  return {
    object: pick('object'),
    status: pick('status'),
    currency: pick('currency'),
    amount: typeof obj.amount === 'number' ? obj.amount : undefined,
  };
}

/**
 * Verified, idempotent, order-tolerant Stripe webhook processing.
 *
 * - Signature is verified over the raw body before anything else.
 * - Each event id is claimed once in provider_events; duplicates are
 *   acknowledged without side effects.
 * - Business state changes and ledger postings for one event commit in one
 *   database transaction. Emails run only after commit and are deduplicated.
 * - Out-of-order delivery: a settled payment is never regressed; non-terminal
 *   intent events older than the last applied event are ignored; refund,
 *   dispute and payout state follow explicit transition rules.
 * - Processing failures return 500 so Stripe retries.
 */
@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ProviderEvent) private readonly events: Repository<ProviderEvent>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    private readonly stripe: StripeService,
    private readonly posting: AccountingPostingService,
    private readonly audit: AuditService,
    private readonly notifications: PaymentNotificationsService,
  ) {}

  async handle(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    requestId: string | null,
  ): Promise<{ received: true; status: string; duplicate?: boolean }> {
    const event = this.stripe.constructWebhookEvent(rawBody, signature);

    const claim = await this.claim(event);
    if (claim.kind === 'duplicate') return { received: true, status: claim.status, duplicate: true };
    if (claim.kind === 'in_flight') throw new ConflictException('Event is already being processed');

    const ctx: PostingContext = { actorId: null, requestId };
    try {
      const outcome = await this.dispatch(event, ctx);
      await this.finish(claim.row.id, outcome.status, outcome.note ?? null);
      this.logger.log(
        `stripe ${event.id} ${event.type} -> ${outcome.status}${outcome.note ? ` (${outcome.note})` : ''} [request ${requestId ?? '-'}]`,
      );
      if (outcome.after) {
        await outcome.after().catch((err) =>
          this.logger.error(`post-commit side effect failed for ${event.id}: ${safeError(err)}`),
        );
      }
      return { received: true, status: outcome.status };
    } catch (err) {
      const reason = safeError(err);
      await this.finish(claim.row.id, 'FAILED', reason).catch(() => undefined);
      this.logger.error(`stripe ${event.id} ${event.type} failed: ${reason} [request ${requestId ?? '-'}]`);
      throw new InternalServerErrorException('Webhook processing failed');
    }
  }

  private async claim(event: Stripe.Event): Promise<Claim> {
    const obj = (event.data?.object ?? {}) as unknown as Record<string, unknown>;
    const row = this.events.create({
      id: randomUUID(),
      provider: 'stripe',
      providerEventId: event.id,
      eventType: event.type.slice(0, 96),
      objectId: typeof obj.id === 'string' ? obj.id.slice(0, 128) : null,
      livemode: event.livemode,
      providerCreated: event.created,
      status: 'RECEIVED',
      attempts: 1,
      lastError: null,
      summary: summarize(obj),
      receivedAt: new Date(),
      processedAt: null,
    });
    try {
      // save() on a fresh primary key performs a plain INSERT; a duplicate
      // provider_event_id surfaces as a unique violation below.
      await this.events.save(row, { reload: false });
      return { kind: 'new', row };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const existing = await this.events.findOne({ where: { provider: 'stripe', providerEventId: event.id } });
      if (!existing) throw err;
      if (existing.status === 'PROCESSED' || existing.status === 'IGNORED') {
        return { kind: 'duplicate', status: existing.status };
      }
      if (existing.status === 'RECEIVED' && Date.now() - new Date(existing.receivedAt).getTime() < IN_FLIGHT_WINDOW_MS) {
        return { kind: 'in_flight' };
      }
      const res = await this.events.update(
        { id: existing.id, status: existing.status, attempts: existing.attempts },
        { status: 'RECEIVED', attempts: existing.attempts + 1, receivedAt: new Date(), lastError: null },
      );
      return res.affected === 1 ? { kind: 'retry', row: existing } : { kind: 'in_flight' };
    }
  }

  private async finish(id: string, status: ProviderEventStatus, note: string | null): Promise<void> {
    await this.events.update(id, { status, processedAt: new Date(), lastError: note ? note.slice(0, 500) : null });
  }

  private async dispatch(event: Stripe.Event, ctx: PostingContext): Promise<Outcome> {
    if (!event.data?.object) return { status: 'IGNORED', note: 'event has no data object' };
    if (!HANDLED_EVENTS.has(event.type)) return { status: 'IGNORED', note: 'event type not handled' };
    const mode = this.stripe.mode();
    if (mode && event.livemode !== (mode === 'live')) {
      return { status: 'IGNORED', note: 'livemode does not match configured Stripe mode' };
    }
    if (event.type.startsWith('payment_intent.')) return this.onPaymentIntent(event, ctx);
    if (event.type === 'charge.updated') return this.onChargeUpdated(event, ctx);
    if (event.type.startsWith('refund.')) return this.onRefund(event, ctx);
    if (event.type.startsWith('charge.dispute.')) return this.onDispute(event, ctx);
    if (event.type.startsWith('payout.')) return this.onPayout(event, ctx);
    return { status: 'IGNORED', note: 'no handler' };
  }

  // ---------------------------------------------------------------------------
  // PaymentIntent lifecycle
  // ---------------------------------------------------------------------------

  private async findPaymentForIntent(pi: Stripe.PaymentIntent): Promise<Payment | null> {
    const byProvider = await this.payments.findOne({ where: { provider: 'stripe', providerPaymentId: pi.id } });
    if (byProvider) return byProvider;
    // The intent was created but our row was not yet updated with its id
    // (e.g. crash between the Stripe call and the update). Metadata links it,
    // and must agree on the invoice too.
    const gwId = pi.metadata?.greenwave_payment_id;
    if (typeof gwId === 'string' && UUID_PATTERN.test(gwId)) {
      const p = await this.payments.findOne({ where: { id: gwId } });
      if (p && p.invoiceId === pi.metadata?.greenwave_invoice_id && (!p.providerPaymentId || p.providerPaymentId === pi.id)) {
        return p;
      }
    }
    return null;
  }

  private async onPaymentIntent(event: Stripe.Event, ctx: PostingContext): Promise<Outcome> {
    const pi = event.data.object as Stripe.PaymentIntent;
    const found = await this.findPaymentForIntent(pi);
    if (!found) return { status: 'IGNORED', note: 'intent was not created by GreenWave' };
    if (event.type === 'payment_intent.succeeded') return this.applySucceeded(event, pi.id, found.id, ctx);

    return this.dataSource.transaction(async (m): Promise<Outcome> => {
      const repo = m.getRepository(Payment);
      const p = await repo.findOne({ where: { id: found.id }, lock: rowLock(m) });
      if (!p) throw new Error('payment row disappeared');
      if (SETTLED_PAYMENT_STATUSES.includes(p.status)) return { status: 'IGNORED', note: `payment already ${p.status}` };
      if (p.lastEventCreated !== null && event.created < p.lastEventCreated) {
        return { status: 'IGNORED', note: 'older than already-applied state' };
      }
      if (!p.providerPaymentId) p.providerPaymentId = pi.id;

      let invoicePaymentStatus: string | null = null;
      switch (event.type) {
        case 'payment_intent.processing':
          p.status = 'PROCESSING';
          invoicePaymentStatus = 'processing';
          break;
        case 'payment_intent.requires_action':
          p.status = 'REQUIRES_ACTION';
          break;
        case 'payment_intent.payment_failed':
          p.status = 'FAILED';
          p.failedAt = new Date(event.created * 1000);
          p.failureReason =
            [pi.last_payment_error?.code, pi.last_payment_error?.decline_code].filter(Boolean).join(':') || 'payment_failed';
          invoicePaymentStatus = 'failed';
          break;
        case 'payment_intent.canceled':
          p.status = 'CANCELED';
          p.canceledAt = new Date(event.created * 1000);
          p.failureReason = pi.cancellation_reason ?? p.failureReason;
          invoicePaymentStatus = 'unpaid';
          break;
        default:
          return { status: 'IGNORED', note: 'intent event not handled' };
      }
      p.lastEventCreated = event.created;
      await repo.save(p);

      if (invoicePaymentStatus) {
        await m
          .createQueryBuilder()
          .update(Invoice)
          .set({ paymentStatus: invoicePaymentStatus })
          .where('id = :id', { id: p.invoiceId })
          .andWhere("payment_status NOT IN ('paid', 'refunded', 'partially_refunded', 'disputed')")
          .execute();
      }
      if (event.type === 'payment_intent.payment_failed') {
        await this.audit.record(
          {
            actorUserId: null,
            actorRole: 'SYSTEM_WEBHOOK',
            action: 'payment.failed',
            entityType: 'payment',
            entityId: p.id,
            warehouseId: p.warehouseId,
            summary: `Payment attempt failed (${p.failureReason})`,
            metadata: { invoiceId: p.invoiceId, providerEventId: event.id, requestId: ctx.requestId },
          },
          m,
        );
      }
      return { status: 'PROCESSED' };
    });
  }

  private async applySucceeded(event: Stripe.Event, intentId: string, paymentId: string, ctx: PostingContext): Promise<Outcome> {
    // Authoritative re-read with the charge and balance transaction expanded,
    // rather than trusting the event snapshot alone.
    const pi = await this.stripe.retrievePaymentIntent(intentId);
    if (pi.status !== 'succeeded') throw new Error(`intent is ${pi.status}, expected succeeded`);
    const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
    const bt = charge?.balance_transaction && typeof charge.balance_transaction === 'object' ? charge.balance_transaction : null;
    const method = describePaymentMethod(charge);
    const receivedCurrency = pi.currency.toUpperCase();
    if (!isSupportedCurrency(receivedCurrency)) throw new Error(`unsupported currency ${receivedCurrency}`);

    return this.dataSource.transaction(async (m): Promise<Outcome> => {
      const payRepo = m.getRepository(Payment);
      const invRepo = m.getRepository(Invoice);
      const p = await payRepo.findOne({ where: { id: paymentId }, lock: rowLock(m) });
      if (!p) throw new Error('payment row disappeared');
      if (SETTLED_PAYMENT_STATUSES.includes(p.status)) return { status: 'IGNORED', note: `payment already ${p.status}` };
      const inv = await invRepo.findOne({ where: { id: p.invoiceId }, lock: rowLock(m) });
      if (!inv) throw new Error('invoice for payment not found');

      // Verification: money captured is a fact and is always recorded; the
      // invoice is marked PAID only when every check passes.
      const problems: string[] = [];
      if (pi.amount_received !== p.amountMinor) problems.push('amount_mismatch');
      if (receivedCurrency !== p.currency) problems.push('currency_mismatch');
      if (pi.metadata?.greenwave_invoice_id !== p.invoiceId) problems.push('invoice_metadata_mismatch');
      let invoiceMinor: number | null = null;
      try {
        invoiceMinor = decimalToMinor(inv.total, inv.currency || 'CAD');
      } catch {
        invoiceMinor = null;
      }
      if (invoiceMinor !== pi.amount_received || (inv.currency || 'CAD').toUpperCase() !== receivedCurrency) {
        problems.push('invoice_amount_changed');
      }
      const invStatus = (inv.status || '').toLowerCase();
      if (invStatus === 'draft' || NON_PAYABLE_INVOICE_STATUSES.includes(invStatus)) problems.push('invoice_not_payable');
      const otherSettled = await payRepo.count({
        where: { invoiceId: p.invoiceId, status: In([...SETTLED_PAYMENT_STATUSES]), id: Not(p.id) },
      });
      if (otherSettled > 0) problems.push('duplicate_payment');
      else if ((inv.paymentStatus || '').toLowerCase() === 'paid') problems.push('invoice_already_marked_paid');

      if (problems.includes('amount_mismatch') || problems.includes('currency_mismatch')) {
        p.metadata = { ...(p.metadata ?? {}), expectedAmountMinor: p.amountMinor, expectedCurrency: p.currency };
        p.amountMinor = pi.amount_received;
        p.currency = receivedCurrency;
      }
      p.amount = minorToDecimalString(p.amountMinor, p.currency);
      p.status = 'SUCCEEDED';
      p.providerPaymentId = pi.id;
      p.paidAt = new Date((charge?.created ?? event.created) * 1000);
      p.providerChargeId = charge?.id ?? idOf(pi.latest_charge);
      p.providerCustomerId = idOf(pi.customer as string | { id: string } | null);
      p.paymentMethodType = method.type;
      p.paymentMethodDisplay = method.display ? method.display.slice(0, 64) : null;
      if (bt && bt.currency.toUpperCase() === p.currency) {
        p.feeMinor = bt.fee;
        p.netMinor = bt.net;
        p.providerBalanceTxnId = bt.id;
      }
      p.failureReason = null;
      p.lastEventCreated = Math.max(p.lastEventCreated ?? 0, event.created);
      p.metadata = {
        ...(p.metadata ?? {}),
        reviewRequired: problems.length > 0,
        ...(problems.length ? { problems } : {}),
        succeededEventId: event.id,
      };
      await payRepo.save(p);

      if (problems.length === 0) {
        await invRepo.update(inv.id, {
          paymentStatus: 'paid',
          status: 'paid',
          paidAt: p.paidAt,
          paymentProvider: 'stripe',
          paymentReference: p.id,
        });
        inv.status = 'paid';
        inv.paymentStatus = 'paid';
      }

      await this.posting.postPaymentReceived(p, inv, ctx, m);
      if (p.feeMinor) await this.posting.postProcessorFee(p, p.feeMinor, p.providerBalanceTxnId, ctx, m);
      if (bt) await upsertBalanceTransaction(m, bt);

      await this.audit.record(
        {
          actorUserId: null,
          actorRole: 'SYSTEM_WEBHOOK',
          action: problems.length ? 'payment.succeeded_review_required' : 'invoice.paid',
          entityType: 'payment',
          entityId: p.id,
          warehouseId: p.warehouseId,
          summary: problems.length
            ? `Payment captured for invoice #${inv.invoiceNumber} requires review: ${problems.join(', ')}`
            : `Invoice #${inv.invoiceNumber} paid via Stripe (${formatMinor(p.amountMinor, p.currency)})`,
          metadata: { invoiceId: inv.id, providerPaymentId: pi.id, providerEventId: event.id, requestId: ctx.requestId, problems },
        },
        m,
      );

      const id = p.id;
      return problems.length
        ? { status: 'PROCESSED', note: `review required: ${problems.join(',')}`, after: () => this.notifications.sendReviewNotice(id, problems) }
        : { status: 'PROCESSED', after: () => this.notifications.sendPaymentConfirmation(id) };
    });
  }

  /** Fees for some payment methods become known only after the charge settles. */
  private async onChargeUpdated(event: Stripe.Event, ctx: PostingContext): Promise<Outcome> {
    const charge = event.data.object as Stripe.Charge;
    const intentId = idOf(charge.payment_intent);
    if (!intentId) return { status: 'IGNORED', note: 'charge without payment intent' };
    const existing = await this.payments.findOne({ where: { provider: 'stripe', providerPaymentId: intentId } });
    if (!existing) return { status: 'IGNORED', note: 'charge not linked to a GreenWave payment' };
    if (existing.feeMinor !== null) return { status: 'IGNORED', note: 'fee already recorded' };
    if (!SETTLED_PAYMENT_STATUSES.includes(existing.status)) return { status: 'IGNORED', note: 'payment not settled yet' };
    const btId = idOf(charge.balance_transaction);
    if (!btId) return { status: 'IGNORED', note: 'balance transaction not available yet' };
    const bt = await this.stripe.retrieveBalanceTransaction(btId);

    return this.dataSource.transaction(async (m): Promise<Outcome> => {
      const repo = m.getRepository(Payment);
      const p = await repo.findOne({ where: { id: existing.id }, lock: rowLock(m) });
      if (!p || p.feeMinor !== null) return { status: 'IGNORED', note: 'fee already recorded' };
      await upsertBalanceTransaction(m, bt);
      if (bt.currency.toUpperCase() !== p.currency) {
        return { status: 'PROCESSED', note: 'settlement currency differs from payment currency; fee not posted' };
      }
      p.feeMinor = bt.fee;
      p.netMinor = bt.net;
      p.providerBalanceTxnId = bt.id;
      await repo.save(p);
      await this.posting.postProcessorFee(p, bt.fee, bt.id, ctx, m);
      return { status: 'PROCESSED' };
    });
  }

  // ---------------------------------------------------------------------------
  // Refunds
  // ---------------------------------------------------------------------------

  private recomputeSettledStatus(p: Payment): void {
    if (p.status === 'DISPUTED') return;
    p.status = p.refundedMinor <= 0 ? 'SUCCEEDED' : p.refundedMinor >= p.amountMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  }

  /** Mirrors a settled payment's state onto the invoice it paid (if it is the paying payment). */
  private async syncInvoicePaymentState(m: EntityManager, p: Payment): Promise<void> {
    const status =
      p.status === 'DISPUTED'
        ? 'disputed'
        : p.status === 'REFUNDED'
          ? 'refunded'
          : p.status === 'PARTIALLY_REFUNDED'
            ? 'partially_refunded'
            : p.status === 'SUCCEEDED'
              ? 'paid'
              : null;
    if (!status) return;
    await m
      .createQueryBuilder()
      .update(Invoice)
      .set({ paymentStatus: status })
      .where('id = :id', { id: p.invoiceId })
      .andWhere('payment_reference = :ref', { ref: p.id })
      .execute();
  }

  private async onRefund(event: Stripe.Event, ctx: PostingContext): Promise<Outcome> {
    const refund = event.data.object as Stripe.Refund;
    const intentId = idOf(refund.payment_intent);
    const next = mapRefundStatus(refund.status);

    return this.dataSource.transaction(async (m): Promise<Outcome> => {
      const refundRepo = m.getRepository(PaymentRefund);
      const payRepo = m.getRepository(Payment);

      let r = await refundRepo.findOne({ where: { provider: 'stripe', providerRefundId: refund.id }, lock: rowLock(m) });
      const gwRefundId = refund.metadata?.greenwave_refund_id;
      if (!r && typeof gwRefundId === 'string' && UUID_PATTERN.test(gwRefundId)) {
        r = await refundRepo.findOne({ where: { id: gwRefundId }, lock: rowLock(m) });
      }
      const p = r
        ? await payRepo.findOne({ where: { id: r.paymentId }, lock: rowLock(m) })
        : intentId
          ? await payRepo.findOne({ where: { provider: 'stripe', providerPaymentId: intentId }, lock: rowLock(m) })
          : null;
      if (!p) return { status: 'IGNORED', note: 'refund not linked to a GreenWave payment' };

      if (!r) {
        // Refund created outside GreenWave (e.g. Stripe Dashboard). Record it.
        r = refundRepo.create({
          id: randomUUID(),
          paymentId: p.id,
          provider: 'stripe',
          providerRefundId: refund.id,
          amountMinor: refund.amount,
          currency: refund.currency.toUpperCase(),
          status: 'REQUESTED',
          reason: refund.reason ?? null,
          note: 'Initiated outside GreenWave (Stripe Dashboard or API)',
          failureReason: null,
          idempotencyKey: `stripe:${refund.id}`,
          requestedBy: null,
          succeededAt: null,
        });
        await refundRepo.save(r);
      } else if (!r.providerRefundId) {
        r.providerRefundId = refund.id;
      }
      if (r.amountMinor !== refund.amount || r.currency !== refund.currency.toUpperCase()) {
        throw new Error('refund amount/currency differs from the recorded refund');
      }

      const prev = r.status;
      if (prev === next) {
        await refundRepo.save(r);
        return { status: 'PROCESSED', note: 'no state change' };
      }
      if (prev === 'FAILED' || prev === 'CANCELED') return { status: 'IGNORED', note: `refund already ${prev}` };
      if (prev === 'SUCCEEDED' && next !== 'FAILED') return { status: 'IGNORED', note: 'stale event after refund succeeded' };

      const refundId = r.id;
      let action: string | null = null;

      if (next === 'SUCCEEDED') {
        const refunded = p.refundedMinor + r.amountMinor;
        if (refunded > p.amountMinor) throw new Error('refunds would exceed the captured amount');
        p.refundedMinor = refunded;
        this.recomputeSettledStatus(p);
        r.status = 'SUCCEEDED';
        r.failureReason = null;
        r.succeededAt = new Date(event.created * 1000);
        await payRepo.save(p);
        await refundRepo.save(r);
        await this.syncInvoicePaymentState(m, p);
        const inv = await m.getRepository(Invoice).findOne({ where: { id: p.invoiceId } });
        await this.posting.postRefundSucceeded(r, p, inv, ctx, m);
        action = 'refund.succeeded';
      } else if (prev === 'SUCCEEDED' && next === 'FAILED') {
        p.refundedMinor = Math.max(0, p.refundedMinor - r.amountMinor);
        this.recomputeSettledStatus(p);
        r.status = 'FAILED';
        r.failureReason = refund.failure_reason ?? 'failed';
        await payRepo.save(p);
        await refundRepo.save(r);
        await this.syncInvoicePaymentState(m, p);
        await this.posting.reverseRefund(r, ctx, m);
        action = 'refund.failed_after_success';
      } else {
        r.status = next;
        r.failureReason = next === 'FAILED' ? (refund.failure_reason ?? 'failed') : null;
        await refundRepo.save(r);
        if (next === 'FAILED' || next === 'CANCELED') action = `refund.${next.toLowerCase()}`;
      }

      if (action) {
        await this.audit.record(
          {
            actorUserId: null,
            actorRole: 'SYSTEM_WEBHOOK',
            action,
            entityType: 'payment_refund',
            entityId: r.id,
            warehouseId: p.warehouseId,
            summary: `Refund ${formatMinor(r.amountMinor, r.currency)} on payment ${p.id}: ${r.status}`,
            metadata: { paymentId: p.id, providerRefundId: refund.id, providerEventId: event.id, requestId: ctx.requestId },
          },
          m,
        );
      }
      return action
        ? { status: 'PROCESSED', after: () => this.notifications.sendRefundNotice(refundId) }
        : { status: 'PROCESSED' };
    });
  }

  // ---------------------------------------------------------------------------
  // Disputes
  // ---------------------------------------------------------------------------

  private async onDispute(event: Stripe.Event, ctx: PostingContext): Promise<Outcome> {
    const d = event.data.object as Stripe.Dispute;
    const chargeId = idOf(d.charge);
    const intentId = idOf(d.payment_intent);

    return this.dataSource.transaction(async (m): Promise<Outcome> => {
      const payRepo = m.getRepository(Payment);
      let p = chargeId ? await payRepo.findOne({ where: { providerChargeId: chargeId }, lock: rowLock(m) }) : null;
      if (!p && intentId) p = await payRepo.findOne({ where: { provider: 'stripe', providerPaymentId: intentId }, lock: rowLock(m) });

      const { stale } = await upsertDispute(m, d, p?.id ?? null, event.created);
      if (!p) return { status: 'PROCESSED', note: 'dispute not linked to a GreenWave payment; mirrored only' };
      if (!isSupportedCurrency(d.currency)) return { status: 'PROCESSED', note: 'unsupported currency; mirrored only' };

      let withdrawn = 0;
      for (const bt of d.balance_transactions ?? []) {
        await this.posting.postDisputeBalanceTransaction(
          {
            disputeId: d.id,
            balanceTxnId: bt.id,
            amountMinor: bt.amount,
            feeMinor: bt.fee,
            currency: bt.currency.toUpperCase(),
            date: new Date(bt.created * 1000),
            customerId: p.customerId,
          },
          ctx,
          m,
        );
        await upsertBalanceTransaction(m, bt);
        withdrawn -= bt.amount;
      }
      p.disputedMinor = Math.max(0, withdrawn);

      if (!stale) {
        p.disputeStatus = d.status;
        if (d.status === 'won' || d.status === 'warning_closed') {
          if (p.status === 'DISPUTED') {
            p.status = 'SUCCEEDED';
            this.recomputeSettledStatus(p);
          }
        } else if (d.status === 'lost') {
          p.status = 'DISPUTED';
          await this.posting.postDisputeLost(
            { disputeId: d.id, amountMinor: p.disputedMinor, currency: d.currency.toUpperCase(), date: new Date(event.created * 1000), customerId: p.customerId },
            ctx,
            m,
          );
        } else if (!d.status.startsWith('warning_')) {
          p.status = 'DISPUTED';
        }
      }
      await payRepo.save(p);
      await this.syncInvoicePaymentState(m, p);

      await this.audit.record(
        {
          actorUserId: null,
          actorRole: 'SYSTEM_WEBHOOK',
          action: `payment.dispute_${d.status}`.slice(0, 100),
          entityType: 'payment',
          entityId: p.id,
          warehouseId: p.warehouseId,
          summary: `Dispute ${d.id} on payment ${p.id}: ${d.status} (${formatMinor(d.amount, d.currency.toUpperCase())})`,
          metadata: { providerDisputeId: d.id, providerEventId: event.id, requestId: ctx.requestId },
        },
        m,
      );
      const paymentId = p.id;
      const status = d.status;
      return { status: 'PROCESSED', after: () => this.notifications.sendDisputeNotice(d.id, paymentId, status) };
    });
  }

  // ---------------------------------------------------------------------------
  // Payouts
  // ---------------------------------------------------------------------------

  private async onPayout(event: Stripe.Event, ctx: PostingContext): Promise<Outcome> {
    const po = event.data.object as Stripe.Payout;
    return this.dataSource.transaction(async (m): Promise<Outcome> => {
      const { row, stale } = await upsertPayout(m, po, event.created);
      // Post from the mirror's resolved state, not the event type, so a stale
      // payout.paid arriving after payout.failed cannot post cash to the bank.
      if (row.status === 'paid') {
        await this.posting.postPayoutPaid(
          { providerPayoutId: po.id, amountMinor: row.amountMinor, currency: row.currency, arrivalDate: row.arrivalDate },
          ctx,
          m,
        );
      } else if (row.status === 'failed' || row.status === 'canceled') {
        const reversed = await this.posting.reversePayout(po.id, ctx, m);
        if (reversed?.created) {
          await this.audit.record(
            {
              actorUserId: null,
              actorRole: 'SYSTEM_WEBHOOK',
              action: 'stripe.payout_failed',
              entityType: 'stripe_payout',
              entityId: po.id,
              summary: `Stripe payout ${po.id} ${row.status} after being paid; bank posting reversed`,
              metadata: { providerEventId: event.id, failureCode: row.failureCode, requestId: ctx.requestId },
            },
            m,
          );
        }
      }
      return { status: 'PROCESSED', note: stale ? 'stale event; state unchanged' : undefined };
    });
  }
}
