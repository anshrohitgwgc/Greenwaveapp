import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import type Stripe from 'stripe';
import { DataSource, In, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import { isUniqueViolation, rowLock } from '../common/db-types';
import { decimalToMinor, isSupportedCurrency, minorToDecimalString, normalizeCurrency } from '../common/money';
import { Customer } from '../customers/entities/customer.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { mapIntentStatus } from '../stripe/stripe-mappers';
import { StripeService } from '../stripe/stripe.service';
import { Payment } from './entities/payment.entity';
import { PaymentLinkService } from './payment-link.service';
import { NON_PAYABLE_INVOICE_STATUSES, OPEN_PAYMENT_STATUSES, SETTLED_PAYMENT_STATUSES } from './payment-status';

/** One message for every unresolvable link, so responses do not reveal which links exist. */
const LINK_NOT_FOUND = 'This payment link is invalid or has expired.';
const SUPPORT_EMAIL = 'sales@greenwaverecycling.ca';
const REUSABLE_INTENT_STATUSES: ReadonlyArray<Stripe.PaymentIntent.Status> = [
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
];
const CANCELABLE_INTENT_STATUSES: ReadonlyArray<Stripe.PaymentIntent.Status> = [
  ...REUSABLE_INTENT_STATUSES,
  'requires_capture',
];
const STALE_UNPROVISIONED_MS = 2 * 60 * 1000;

export type PublicPaymentState = 'payable' | 'processing' | 'paid' | 'refunded' | 'not_payable';

export interface PublicInvoiceView {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  customerName: string | null;
  currency: string;
  totalMinor: number;
  amountDueMinor: number;
  amountDue: string;
  state: PublicPaymentState;
  paidAt: string | null;
  onlinePaymentsAvailable: boolean;
  publishableKey: string | null;
  supportEmail: string;
}

export type IntentResult =
  | { state: 'ready'; clientSecret: string; paymentReference: string; amountMinor: number; currency: string }
  | { state: 'processing' | 'paid' };

/**
 * Public, token-authorized payment flow for pay.gwgcservers.ca.
 *
 * The browser never supplies an amount: the server loads the invoice, derives
 * the exact outstanding balance in minor units, and creates (or resumes) the
 * PaymentIntent for exactly that. The response to the browser is never taken
 * as proof of payment — only the verified webhook settles.
 */
@Injectable()
export class PublicPaymentsService {
  private readonly logger = new Logger(PublicPaymentsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    private readonly links: PaymentLinkService,
    private readonly stripe: StripeService,
    private readonly audit: AuditService,
  ) {}

  private async resolve(token: string): Promise<Invoice> {
    if (!this.links.isWellFormed(token)) throw new NotFoundException(LINK_NOT_FOUND);
    const invoice = await this.invoices.findOne({ where: { paymentTokenHash: this.links.hashToken(token) } });
    if (!invoice || invoice.paymentLinkRevokedAt) throw new NotFoundException(LINK_NOT_FOUND);
    return invoice;
  }

  private amountMinorOf(invoice: Invoice): number | null {
    try {
      return decimalToMinor(invoice.total ?? '0', normalizeCurrency(invoice.currency || 'CAD'));
    } catch {
      return null;
    }
  }

  private async stateOf(invoice: Invoice): Promise<{ state: PublicPaymentState; paidAt: Date | null }> {
    const rows = await this.payments.find({
      where: { invoiceId: invoice.id, status: In([...SETTLED_PAYMENT_STATUSES, 'PROCESSING']) },
      order: { createdAt: 'DESC' },
      take: 5,
    });
    const settled = rows.find((p) => SETTLED_PAYMENT_STATUSES.includes(p.status) && !p.metadata?.reviewRequired);
    if (settled) return { state: settled.status === 'REFUNDED' ? 'refunded' : 'paid', paidAt: settled.paidAt };
    if ((invoice.paymentStatus || '').toLowerCase() === 'paid') return { state: 'paid', paidAt: invoice.paidAt };
    const status = (invoice.status || '').toLowerCase();
    if (status === 'draft' || NON_PAYABLE_INVOICE_STATUSES.includes(status)) return { state: 'not_payable', paidAt: null };
    if (rows.some((p) => p.status === 'PROCESSING')) return { state: 'processing', paidAt: null };
    const minor = this.amountMinorOf(invoice);
    if (minor === null || minor <= 0) return { state: 'not_payable', paidAt: null };
    return { state: 'payable', paidAt: null };
  }

  async getPublicInvoice(token: string): Promise<PublicInvoiceView> {
    const invoice = await this.resolve(token);
    const { state, paidAt } = await this.stateOf(invoice);
    const currency = isSupportedCurrency(invoice.currency) ? invoice.currency.toUpperCase() : 'CAD';
    const totalMinor = this.amountMinorOf(invoice) ?? 0;
    const due = state === 'payable' || state === 'processing' ? totalMinor : 0;
    const customer = invoice.customerId ? await this.customers.findOne({ where: { id: invoice.customerId } }) : null;
    const cfg = this.stripe.publicConfig();
    const online = state === 'payable' && !!cfg.publishableKey && this.stripe.isPaymentsConfigured();

    // Deliberately minimal: no addresses, line items, internal ids, or notes.
    return {
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate ?? null,
      customerName: (customer?.name ?? (invoice.billTo || '').split('\n')[0]).trim().slice(0, 120) || null,
      currency,
      totalMinor,
      amountDueMinor: due,
      amountDue: minorToDecimalString(due, currency),
      state,
      paidAt: paidAt ? new Date(paidAt).toISOString() : null,
      onlinePaymentsAvailable: online,
      publishableKey: online ? cfg.publishableKey : null,
      supportEmail: SUPPORT_EMAIL,
    };
  }

  async getStatus(token: string): Promise<{ state: PublicPaymentState; paidAt: string | null }> {
    const invoice = await this.resolve(token);
    const { state, paidAt } = await this.stateOf(invoice);
    return { state, paidAt: paidAt ? new Date(paidAt).toISOString() : null };
  }

  async createIntent(token: string, requestId: string | null, depth = 0): Promise<IntentResult> {
    const resolved = await this.resolve(token);
    if (!this.stripe.isPaymentsConfigured() || !this.stripe.publicConfig().publishableKey) {
      throw new ServiceUnavailableException('Online payment is temporarily unavailable. Please contact us to pay.');
    }
    if (depth > 1) throw new ConflictException('Unable to prepare payment. Please refresh and try again.');

    type Prepared =
      | { kind: 'new'; payment: Payment; invoice: Invoice }
      | { kind: 'existing'; payment: Payment; amountMinor: number; currency: string }
      | { kind: 'settled' };

    let prepared: Prepared;
    try {
      prepared = await this.dataSource.transaction(async (m): Promise<Prepared> => {
        const invoice = await m.getRepository(Invoice).findOne({ where: { id: resolved.id }, lock: rowLock(m) });
        if (!invoice || invoice.paymentLinkRevokedAt) throw new NotFoundException(LINK_NOT_FOUND);
        const status = (invoice.status || '').toLowerCase();
        if (status === 'draft' || NON_PAYABLE_INVOICE_STATUSES.includes(status)) {
          throw new ConflictException('This invoice cannot be paid online.');
        }
        if ((invoice.paymentStatus || '').toLowerCase() === 'paid') return { kind: 'settled' };
        const currency = normalizeCurrency(invoice.currency || 'CAD');
        const amountMinor = decimalToMinor(invoice.total ?? '0', currency);
        if (amountMinor <= 0) throw new BadRequestException('This invoice has no amount due.');

        const repo = m.getRepository(Payment);
        const settled = await repo.count({ where: { invoiceId: invoice.id, status: In([...SETTLED_PAYMENT_STATUSES]) } });
        if (settled > 0) return { kind: 'settled' };

        const open = await repo.findOne({ where: { invoiceId: invoice.id, status: In([...OPEN_PAYMENT_STATUSES]) } });
        if (open) return { kind: 'existing', payment: open, amountMinor, currency };

        const id = randomUUID();
        const payment = await repo.save(
          repo.create({
            id,
            invoiceId: invoice.id,
            customerId: invoice.customerId,
            warehouseId: invoice.warehouseId,
            provider: 'stripe',
            amount: minorToDecimalString(amountMinor, currency),
            amountMinor,
            currency,
            status: 'CREATED',
            refundedMinor: 0,
            disputedMinor: 0,
            idempotencyKey: `gw-pi-${id}`,
            metadata: { createdVia: 'public_payment_page', requestId },
          }),
        );
        return { kind: 'new', payment, invoice };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('A payment for this invoice is being prepared. Please try again in a moment.');
      }
      throw err;
    }

    if (prepared.kind === 'settled') return { state: 'paid' };
    if (prepared.kind === 'existing') return this.resumeIntent(token, prepared.payment, prepared.amountMinor, prepared.currency, requestId, depth);
    return this.provisionIntent(prepared.payment, prepared.invoice, requestId);
  }

  private async resumeIntent(
    token: string,
    payment: Payment,
    amountMinor: number,
    currency: string,
    requestId: string | null,
    depth: number,
  ): Promise<IntentResult> {
    if (!payment.providerPaymentId) {
      if (Date.now() - new Date(payment.createdAt).getTime() < STALE_UNPROVISIONED_MS) {
        throw new ConflictException('A payment for this invoice is being prepared. Please try again in a moment.');
      }
      await this.closeAttempt(payment.id, 'CANCELED', 'provider_intent_never_created');
      return this.createIntent(token, requestId, depth + 1);
    }

    const intent = await this.stripe.getClient().paymentIntents.retrieve(payment.providerPaymentId);
    if (intent.status === 'processing') return { state: 'processing' };
    if (intent.status === 'succeeded') return { state: 'processing' }; // webhook will settle
    if (
      REUSABLE_INTENT_STATUSES.includes(intent.status) &&
      intent.client_secret &&
      intent.amount === amountMinor &&
      intent.currency.toUpperCase() === currency &&
      payment.amountMinor === amountMinor &&
      payment.currency === currency
    ) {
      return { state: 'ready', clientSecret: intent.client_secret, paymentReference: payment.id, amountMinor, currency };
    }

    // Invoice amount changed or the intent can no longer be used: retire it at
    // Stripe first so it can never be paid, then start a fresh attempt.
    if (CANCELABLE_INTENT_STATUSES.includes(intent.status)) {
      await this.stripe.cancelPaymentIntent(intent.id, `gw-pi-cancel-${payment.id}`);
    }
    await this.closeAttempt(payment.id, 'CANCELED', 'superseded');
    return this.createIntent(token, requestId, depth + 1);
  }

  private async provisionIntent(payment: Payment, invoice: Invoice, requestId: string | null): Promise<IntentResult> {
    // Earlier attempts whose last try failed may still be confirmable from an
    // old browser tab. Cancel them at Stripe before creating a new intent so
    // an invoice can never be captured twice through two live intents.
    const retired = await this.payments.find({ where: { invoiceId: invoice.id, status: In(['FAILED']) } });
    for (const old of retired) {
      if (!old.providerPaymentId || old.metadata?.providerCanceled) continue;
      try {
        const intent = await this.stripe.getClient().paymentIntents.retrieve(old.providerPaymentId);
        if (intent.status === 'processing' || intent.status === 'succeeded') {
          await this.closeAttempt(payment.id, 'CANCELED', 'earlier_attempt_in_progress');
          return { state: 'processing' };
        }
        if (CANCELABLE_INTENT_STATUSES.includes(intent.status)) {
          await this.stripe.cancelPaymentIntent(intent.id, `gw-pi-cancel-${old.id}`);
        }
        await this.payments.update(old.id, { metadata: { ...(old.metadata ?? {}), providerCanceled: true } });
      } catch (err) {
        await this.closeAttempt(payment.id, 'CANCELED', 'could_not_retire_earlier_attempt');
        this.logger.error(`Could not retire intent for payment ${old.id}: ${JSON.stringify(StripeService.safeError(err))}`);
        throw new BadGatewayException('Payment provider is unavailable. Please try again shortly.');
      }
    }

    let intent: Stripe.PaymentIntent;
    try {
      intent = await this.stripe.createPaymentIntent(
        {
          amount: payment.amountMinor,
          currency: payment.currency.toLowerCase(),
          automatic_payment_methods: { enabled: true },
          description: `GreenWave Recycling invoice ${invoice.invoiceNumber}`,
          metadata: {
            greenwave_payment_id: payment.id,
            greenwave_invoice_id: invoice.id,
            greenwave_invoice_number: invoice.invoiceNumber,
          },
        },
        payment.idempotencyKey!,
      );
    } catch (err) {
      const safe = StripeService.safeError(err);
      await this.closeAttempt(payment.id, 'CANCELED', `provider_error:${safe.code ?? safe.type}`);
      this.logger.error(`PaymentIntent creation failed for payment ${payment.id}: ${JSON.stringify(safe)} [request ${requestId ?? '-'}]`);
      throw new BadGatewayException('Payment provider is unavailable. Please try again shortly.');
    }

    if (intent.amount !== payment.amountMinor || intent.currency.toUpperCase() !== payment.currency || !intent.client_secret) {
      await this.stripe.cancelPaymentIntent(intent.id, `gw-pi-cancel-${payment.id}`).catch(() => undefined);
      await this.closeAttempt(payment.id, 'CANCELED', 'provider_intent_mismatch');
      throw new BadGatewayException('Payment could not be prepared. Please try again.');
    }

    await this.payments.update(payment.id, { providerPaymentId: intent.id, status: mapIntentStatus(intent.status) });
    await this.audit.record({
      actorUserId: null,
      actorRole: 'PUBLIC_PAYMENT_PAGE',
      action: 'payment.intent_created',
      entityType: 'payment',
      entityId: payment.id,
      warehouseId: payment.warehouseId,
      summary: `Payment session created for invoice #${invoice.invoiceNumber}`,
      metadata: { invoiceId: invoice.id, providerPaymentId: intent.id, requestId },
    });
    return {
      state: 'ready',
      clientSecret: intent.client_secret,
      paymentReference: payment.id,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
    };
  }

  private async closeAttempt(paymentId: string, status: 'CANCELED' | 'FAILED', reason: string): Promise<void> {
    await this.payments.update(paymentId, {
      status,
      failureReason: reason.slice(0, 200),
      ...(status === 'CANCELED' ? { canceledAt: new Date() } : { failedAt: new Date() }),
    });
  }
}
