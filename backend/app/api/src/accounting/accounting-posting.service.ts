import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager, In, IsNull, Like } from 'typeorm';

import { isIsoDate, toBusinessDate } from '../common/dates';
import { decimalToMinor, isSupportedCurrency, normalizeCurrency } from '../common/money';
import type { Invoice } from '../invoices/entities/invoice.entity';
import type { PaymentRefund } from '../payments/entities/payment-refund.entity';
import type { Payment } from '../payments/entities/payment.entity';
import { NON_PAYABLE_INVOICE_STATUSES } from '../payments/payment-status';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalLine } from './entities/journal-line.entity';
import { LedgerAccount } from './entities/ledger-account.entity';
import { LedgerService, PostLineInput, PostResult } from './ledger.service';

export const LEDGER_SOURCE = {
  INVOICE: 'invoice',
  PAYMENT: 'payment',
  REFUND: 'refund',
  PAYOUT: 'stripe_payout',
  DISPUTE: 'dispute',
  MANUAL: 'manual',
  BANK_TRANSACTION: 'bank_transaction',
  CARD_TRANSACTION: 'card_transaction',
  BILL: 'bill',
} as const;

export interface PostingContext {
  actorId?: number | null;
  requestId?: string | null;
}

const ISSUANCE_EVENT_PREFIX = 'invoice.issued';

/**
 * Accounting rules: turns business events into balanced journal entries.
 * Accrual basis, single currency per entry. Every rule is exactly-once per
 * (source type, source id, source event). See FINANCE_ARCHITECTURE.md.
 *
 *   invoice issued      DR AR                     CR Revenue, CR Sales tax payable
 *   payment succeeded   DR Stripe clearing        CR AR
 *   Stripe fee          DR Merchant fees          CR Stripe clearing
 *   refund succeeded    DR Sales refunds (contra) CR Stripe clearing
 *   payout paid         DR Bank                   CR Stripe clearing
 *   dispute withdrawal  DR Disputed funds (+fee)  CR Stripe clearing
 *   dispute reinstated  DR Stripe clearing        CR Disputed funds
 *   dispute lost        DR Dispute losses         CR Disputed funds
 *
 * Revenue is recognized once, at issuance. Payment settles AR; payout moves
 * cash from clearing to bank. None of the later events touch revenue except a
 * refund, which reduces it through the contra account.
 */
@Injectable()
export class AccountingPostingService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly config: ConfigService,
  ) {}

  /** Invoices dated before this are assumed to be in imported opening balances. */
  ledgerStartDate(): string | null {
    const v = this.config.get<string>('ACCOUNTING_LEDGER_START_DATE');
    return isIsoDate(v) ? v : null;
  }

  private today(): string {
    return toBusinessDate(new Date());
  }

  /** Desired issuance lines for an invoice, or null when nothing should post. */
  invoiceIssuanceLines(invoice: Invoice): { currency: string; totalMinor: number; taxMinor: number; lines: PostLineInput[] } | null {
    const currency = normalizeCurrency(invoice.currency || 'CAD');
    const totalMinor = decimalToMinor(invoice.total ?? '0', currency);
    const taxMinor = decimalToMinor(invoice.taxTotal ?? '0', currency);
    if (totalMinor <= 0) return null;
    if (taxMinor < 0 || taxMinor > totalMinor) {
      throw new RangeError(`Invoice ${invoice.invoiceNumber}: tax total is outside 0..total`);
    }
    const revenueMinor = totalMinor - taxMinor;
    const lines: PostLineInput[] = [
      { accountKey: 'AR', debitMinor: totalMinor, customerId: invoice.customerId, description: `Invoice ${invoice.invoiceNumber}` },
    ];
    if (revenueMinor > 0) lines.push({ accountKey: 'REVENUE_SALES', creditMinor: revenueMinor, customerId: invoice.customerId });
    if (taxMinor > 0) lines.push({ accountKey: 'SALES_TAX_PAYABLE', creditMinor: taxMinor, description: invoice.taxLabel || 'Sales tax' });
    return { currency, totalMinor, taxMinor, lines };
  }

  async activeInvoiceIssuance(invoiceId: string, m: EntityManager): Promise<JournalEntry | null> {
    return m.getRepository(JournalEntry).findOne({
      where: {
        sourceType: LEDGER_SOURCE.INVOICE,
        sourceId: invoiceId,
        status: 'POSTED',
        reversalOf: IsNull(),
        sourceEvent: Like(`${ISSUANCE_EVENT_PREFIX}%`),
      },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Makes the ledger reflect the invoice's current issued amounts. No-op when
   * already correct; otherwise reverses the stale issuance and posts a new
   * revision. Idempotent.
   */
  async syncInvoiceIssued(
    invoice: Invoice,
    ctx: PostingContext,
    m: EntityManager,
  ): Promise<{ entry: JournalEntry | null; changed: boolean; skipped?: string }> {
    const start = this.ledgerStartDate();
    if (start && invoice.invoiceDate < start) return { entry: null, changed: false, skipped: 'before_ledger_start' };
    if (!isSupportedCurrency(invoice.currency || 'CAD')) return { entry: null, changed: false, skipped: 'unsupported_currency' };

    const status = (invoice.status || '').toLowerCase();
    const issued = status !== 'draft' && !NON_PAYABLE_INVOICE_STATUSES.includes(status);
    const desired = issued ? this.invoiceIssuanceLines(invoice) : null;
    const active = await this.activeInvoiceIssuance(invoice.id, m);

    if (active && desired && (await this.matchesIssuance(active, desired, invoice.customerId, m))) {
      return { entry: active, changed: false };
    }
    if (active) {
      await this.ledger.reverse(
        active.id,
        { entryDate: this.today(), reason: desired ? 'Invoice amounts changed' : `Invoice ${status}`, createdBy: ctx.actorId, requestId: ctx.requestId },
        m,
      );
    }
    if (!desired) return { entry: null, changed: !!active, skipped: issued ? 'zero_total' : 'not_issued' };

    const revisions = await m.getRepository(JournalEntry).count({
      where: { sourceType: LEDGER_SOURCE.INVOICE, sourceId: invoice.id, reversalOf: IsNull(), sourceEvent: Like(`${ISSUANCE_EVENT_PREFIX}%`) },
    });
    const result = await this.ledger.post(
      {
        entryDate: active ? this.today() : invoice.invoiceDate,
        description: `Invoice ${invoice.invoiceNumber} issued`,
        reference: invoice.invoiceNumber,
        currency: desired.currency,
        sourceType: LEDGER_SOURCE.INVOICE,
        sourceId: invoice.id,
        sourceEvent: revisions === 0 ? ISSUANCE_EVENT_PREFIX : `${ISSUANCE_EVENT_PREFIX}#${revisions + 1}`,
        lines: desired.lines,
        createdBy: ctx.actorId ?? null,
        requestId: ctx.requestId ?? null,
      },
      m,
    );
    return { entry: result.entry, changed: true };
  }

  private async matchesIssuance(
    entry: JournalEntry,
    desired: { currency: string; totalMinor: number; taxMinor: number },
    customerId: string | null,
    m: EntityManager,
  ): Promise<boolean> {
    if (entry.currency !== desired.currency) return false;
    const lines = await m.getRepository(JournalLine).find({ where: { entryId: entry.id } });
    const accounts = await m.getRepository(LedgerAccount).find({ where: { id: In(lines.map((l) => l.accountId)) } });
    const keyOf = new Map(accounts.map((a) => [a.id, a.systemKey]));
    let ar = 0;
    let tax = 0;
    let arCustomer: string | null = null;
    for (const l of lines) {
      const key = keyOf.get(l.accountId);
      if (key === 'AR') {
        ar += l.debitMinor - l.creditMinor;
        arCustomer = l.customerId;
      } else if (key === 'SALES_TAX_PAYABLE') {
        tax += l.creditMinor - l.debitMinor;
      }
    }
    return ar === desired.totalMinor && tax === desired.taxMinor && (arCustomer ?? null) === (customerId ?? null);
  }

  async postPaymentReceived(payment: Payment, invoice: Invoice, ctx: PostingContext, m: EntityManager): Promise<PostResult> {
    await this.syncInvoiceIssued(invoice, ctx, m);
    return this.ledger.post(
      {
        entryDate: toBusinessDate(payment.paidAt ?? new Date()),
        description: `Stripe payment for invoice ${invoice.invoiceNumber}`,
        reference: invoice.invoiceNumber,
        currency: payment.currency,
        sourceType: LEDGER_SOURCE.PAYMENT,
        sourceId: payment.id,
        sourceEvent: 'payment.succeeded',
        lines: [
          { accountKey: 'STRIPE_CLEARING', debitMinor: payment.amountMinor, description: payment.providerPaymentId },
          { accountKey: 'AR', creditMinor: payment.amountMinor, customerId: payment.customerId },
        ],
        createdBy: ctx.actorId ?? null,
        requestId: ctx.requestId ?? null,
        metadata: { providerPaymentId: payment.providerPaymentId },
      },
      m,
    );
  }

  async postProcessorFee(payment: Payment, feeMinor: number, balanceTxnId: string | null, ctx: PostingContext, m: EntityManager): Promise<PostResult | null> {
    if (!(feeMinor > 0)) return null;
    return this.ledger.post(
      {
        entryDate: toBusinessDate(payment.paidAt ?? new Date()),
        description: 'Stripe processing fee',
        reference: balanceTxnId,
        currency: payment.currency,
        sourceType: LEDGER_SOURCE.PAYMENT,
        sourceId: payment.id,
        sourceEvent: 'stripe.fee',
        lines: [
          { accountKey: 'MERCHANT_FEES', debitMinor: feeMinor },
          { accountKey: 'STRIPE_CLEARING', creditMinor: feeMinor },
        ],
        createdBy: ctx.actorId ?? null,
        requestId: ctx.requestId ?? null,
        metadata: { balanceTransactionId: balanceTxnId },
      },
      m,
    );
  }

  async postRefundSucceeded(refund: PaymentRefund, payment: Payment, invoice: Invoice | null, ctx: PostingContext, m: EntityManager): Promise<PostResult> {
    const taxReview = !!invoice && Number(invoice.taxTotal ?? 0) > 0;
    return this.ledger.post(
      {
        entryDate: toBusinessDate(refund.succeededAt ?? new Date()),
        description: `Refund${invoice ? ` for invoice ${invoice.invoiceNumber}` : ''}`,
        reference: invoice?.invoiceNumber ?? refund.providerRefundId,
        currency: refund.currency,
        sourceType: LEDGER_SOURCE.REFUND,
        sourceId: refund.id,
        sourceEvent: 'refund.succeeded',
        lines: [
          { accountKey: 'SALES_REFUNDS', debitMinor: refund.amountMinor, customerId: payment.customerId },
          { accountKey: 'STRIPE_CLEARING', creditMinor: refund.amountMinor, description: refund.providerRefundId },
        ],
        createdBy: ctx.actorId ?? null,
        requestId: ctx.requestId ?? null,
        // Sales tax on a refund is not auto-split; flagged for review.
        metadata: { paymentId: payment.id, salesTaxReviewRequired: taxReview },
      },
      m,
    );
  }

  async reverseRefund(refund: PaymentRefund, ctx: PostingContext, m: EntityManager): Promise<PostResult | null> {
    const entry = await this.ledger.findBySource(LEDGER_SOURCE.REFUND, refund.id, 'refund.succeeded', m);
    if (!entry || entry.status !== 'POSTED') return null;
    return this.ledger.reverse(
      entry.id,
      { entryDate: this.today(), reason: 'Refund failed after succeeding', sourceEvent: 'refund.failed', createdBy: ctx.actorId, requestId: ctx.requestId },
      m,
    );
  }

  async postPayoutPaid(
    payout: { providerPayoutId: string; amountMinor: number; currency: string; arrivalDate: Date | null },
    ctx: PostingContext,
    m: EntityManager,
  ): Promise<PostResult | null> {
    if (payout.amountMinor === 0 || !isSupportedCurrency(payout.currency)) return null;
    const amount = Math.abs(payout.amountMinor);
    const toBank = payout.amountMinor > 0;
    return this.ledger.post(
      {
        entryDate: toBusinessDate(payout.arrivalDate ?? new Date()),
        description: toBank ? 'Stripe payout to bank' : 'Stripe balance debit from bank',
        reference: payout.providerPayoutId,
        currency: payout.currency,
        sourceType: LEDGER_SOURCE.PAYOUT,
        sourceId: payout.providerPayoutId,
        sourceEvent: 'payout.paid',
        lines: toBank
          ? [
              { accountKey: 'BANK_OPERATING', debitMinor: amount },
              { accountKey: 'STRIPE_CLEARING', creditMinor: amount },
            ]
          : [
              { accountKey: 'STRIPE_CLEARING', debitMinor: amount },
              { accountKey: 'BANK_OPERATING', creditMinor: amount },
            ],
        createdBy: ctx.actorId ?? null,
        requestId: ctx.requestId ?? null,
      },
      m,
    );
  }

  async reversePayout(providerPayoutId: string, ctx: PostingContext, m: EntityManager): Promise<PostResult | null> {
    const entry = await this.ledger.findBySource(LEDGER_SOURCE.PAYOUT, providerPayoutId, 'payout.paid', m);
    if (!entry || entry.status !== 'POSTED') return null;
    return this.ledger.reverse(
      entry.id,
      { entryDate: this.today(), reason: 'Payout failed', sourceEvent: 'payout.failed', createdBy: ctx.actorId, requestId: ctx.requestId },
      m,
    );
  }

  /**
   * One dispute balance transaction. Negative amount = funds withdrawn from
   * Stripe balance into "disputed funds"; positive = reinstated. Fees may be
   * positive (charged) or negative (returned).
   */
  async postDisputeBalanceTransaction(
    p: { disputeId: string; balanceTxnId: string; amountMinor: number; feeMinor: number; currency: string; date: Date; customerId: string | null },
    ctx: PostingContext,
    m: EntityManager,
  ): Promise<PostResult | null> {
    if (p.amountMinor === 0 || !isSupportedCurrency(p.currency)) return null;
    const fee = p.feeMinor;
    const lines: PostLineInput[] = [];
    if (p.amountMinor < 0) {
      const amount = -p.amountMinor;
      lines.push({ accountKey: 'STRIPE_DISPUTES', debitMinor: amount, customerId: p.customerId });
      if (fee > 0) lines.push({ accountKey: 'MERCHANT_FEES', debitMinor: fee, description: 'Dispute fee' });
      if (fee < 0) lines.push({ accountKey: 'MERCHANT_FEES', creditMinor: -fee, description: 'Dispute fee returned' });
      lines.push({ accountKey: 'STRIPE_CLEARING', creditMinor: amount + fee });
    } else {
      const amount = p.amountMinor;
      const net = amount - fee;
      if (net > 0) lines.push({ accountKey: 'STRIPE_CLEARING', debitMinor: net });
      if (fee > 0) lines.push({ accountKey: 'MERCHANT_FEES', debitMinor: fee, description: 'Dispute fee' });
      if (fee < 0) lines.push({ accountKey: 'MERCHANT_FEES', creditMinor: -fee, description: 'Dispute fee returned' });
      lines.push({ accountKey: 'STRIPE_DISPUTES', creditMinor: amount, customerId: p.customerId });
    }
    return this.ledger.post(
      {
        entryDate: toBusinessDate(p.date),
        description: p.amountMinor < 0 ? 'Stripe dispute: funds withdrawn' : 'Stripe dispute: funds reinstated',
        reference: p.disputeId,
        currency: p.currency,
        sourceType: LEDGER_SOURCE.DISPUTE,
        sourceId: p.disputeId,
        sourceEvent: `balance_txn:${p.balanceTxnId}`,
        lines,
        createdBy: ctx.actorId ?? null,
        requestId: ctx.requestId ?? null,
      },
      m,
    );
  }

  async postDisputeLost(
    p: { disputeId: string; amountMinor: number; currency: string; date: Date; customerId: string | null },
    ctx: PostingContext,
    m: EntityManager,
  ): Promise<PostResult | null> {
    if (!(p.amountMinor > 0) || !isSupportedCurrency(p.currency)) return null;
    return this.ledger.post(
      {
        entryDate: toBusinessDate(p.date),
        description: 'Stripe dispute lost',
        reference: p.disputeId,
        currency: p.currency,
        sourceType: LEDGER_SOURCE.DISPUTE,
        sourceId: p.disputeId,
        sourceEvent: 'dispute.lost',
        lines: [
          { accountKey: 'DISPUTE_LOSSES', debitMinor: p.amountMinor, customerId: p.customerId },
          { accountKey: 'STRIPE_DISPUTES', creditMinor: p.amountMinor },
        ],
        createdBy: ctx.actorId ?? null,
        requestId: ctx.requestId ?? null,
      },
      m,
    );
  }
}
