import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { toBusinessDate } from '../common/dates';
import { formatMinor } from '../common/money';
import { Customer } from '../customers/entities/customer.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { isDeliverableAddress, MailService } from '../mail/mail.service';
import { paymentReceiptEmail, refundReceiptEmail, salesPaymentNotice } from '../mail/mail.templates';
import { PaymentRefund } from './entities/payment-refund.entity';
import { Payment } from './entities/payment.entity';

/**
 * Payment-lifecycle emails. Every send goes through MailService.sendOnce with a
 * dedupe key derived from the business object, so a duplicate or retried
 * webhook can never produce a second email.
 */
@Injectable()
export class PaymentNotificationsService {
  private readonly logger = new Logger(PaymentNotificationsService.name);

  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(PaymentRefund) private readonly refunds: Repository<PaymentRefund>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    private readonly mail: MailService,
  ) {}

  private async load(paymentId: string) {
    const payment = await this.payments.findOne({ where: { id: paymentId } });
    if (!payment) return null;
    const invoice = await this.invoices.findOne({ where: { id: payment.invoiceId } });
    if (!invoice) return null;
    const customer = invoice.customerId ? await this.customers.findOne({ where: { id: invoice.customerId } }) : null;
    const customerName = customer?.name ?? (invoice.billTo || '').split('\n')[0].trim() ?? null;
    const recipient = invoice.recipientEmail ?? customer?.email ?? null;
    return {
      payment,
      invoice,
      customerName: customerName || null,
      recipient: isDeliverableAddress(recipient) ? recipient : null,
    };
  }

  async sendPaymentConfirmation(paymentId: string): Promise<void> {
    const ctx = await this.load(paymentId);
    if (!ctx) return;
    const { payment: p, invoice, customerName, recipient } = ctx;
    const amountDisplay = formatMinor(p.amountMinor, p.currency);
    const paidAt = toBusinessDate(p.paidAt ?? new Date());

    if (recipient) {
      const email = paymentReceiptEmail({
        invoiceNumber: invoice.invoiceNumber,
        customerName,
        amountDisplay,
        paymentReference: p.id,
        paidAt,
        methodDisplay: p.paymentMethodDisplay,
      });
      await this.mail.sendOnce({ dedupeKey: `payment-receipt:${p.id}`, template: 'payment_receipt', to: recipient, ...email, entityType: 'payment', entityId: p.id });
    } else {
      this.logger.warn(`Payment ${p.id}: no deliverable customer email on file; receipt not sent`);
    }

    const notice = salesPaymentNotice({
      invoiceNumber: invoice.invoiceNumber,
      customerName,
      amountDisplay,
      status: 'SUCCEEDED',
      paymentReference: p.id,
      providerReference: p.providerPaymentId,
      paidAt,
      methodDisplay: p.paymentMethodDisplay,
    });
    await this.mail.sendOnce({ dedupeKey: `payment-sales:${p.id}`, template: 'payment_sales_notice', to: this.mail.salesAddress(), ...notice, entityType: 'payment', entityId: p.id });
  }

  async sendReviewNotice(paymentId: string, problems: string[]): Promise<void> {
    const ctx = await this.load(paymentId);
    if (!ctx) return;
    const { payment: p, invoice, customerName } = ctx;
    const notice = salesPaymentNotice({
      invoiceNumber: invoice.invoiceNumber,
      customerName,
      amountDisplay: formatMinor(p.amountMinor, p.currency),
      status: `REVIEW REQUIRED (${problems.join(', ')})`,
      paymentReference: p.id,
      providerReference: p.providerPaymentId,
      paidAt: toBusinessDate(p.paidAt ?? new Date()),
      methodDisplay: p.paymentMethodDisplay,
    });
    await this.mail.sendOnce({ dedupeKey: `payment-review:${p.id}`, template: 'payment_review_notice', to: this.mail.salesAddress(), ...notice, entityType: 'payment', entityId: p.id });
  }

  async sendRefundNotice(refundId: string): Promise<void> {
    const refund = await this.refunds.findOne({ where: { id: refundId } });
    if (!refund) return;
    const ctx = await this.load(refund.paymentId);
    if (!ctx) return;
    const { invoice, customerName, recipient } = ctx;
    const amountDisplay = formatMinor(refund.amountMinor, refund.currency);
    const when = toBusinessDate(refund.succeededAt ?? new Date());

    const notice = salesPaymentNotice({
      invoiceNumber: invoice.invoiceNumber,
      customerName,
      amountDisplay,
      status: `REFUND ${refund.status}`,
      paymentReference: refund.id,
      providerReference: refund.providerRefundId,
      paidAt: when,
      methodDisplay: null,
    });
    await this.mail.sendOnce({ dedupeKey: `refund-sales:${refund.id}:${refund.status}`, template: 'refund_sales_notice', to: this.mail.salesAddress(), ...notice, entityType: 'payment_refund', entityId: refund.id });

    if (refund.status === 'SUCCEEDED' && recipient) {
      const email = refundReceiptEmail({ invoiceNumber: invoice.invoiceNumber, customerName, amountDisplay, refundReference: refund.id, refundedAt: when });
      await this.mail.sendOnce({ dedupeKey: `refund-customer:${refund.id}`, template: 'refund_receipt', to: recipient, ...email, entityType: 'payment_refund', entityId: refund.id });
    }
  }

  async sendDisputeNotice(providerDisputeId: string, paymentId: string, status: string): Promise<void> {
    const ctx = await this.load(paymentId);
    if (!ctx) return;
    const { payment: p, invoice, customerName } = ctx;
    const notice = salesPaymentNotice({
      invoiceNumber: invoice.invoiceNumber,
      customerName,
      amountDisplay: formatMinor(p.amountMinor, p.currency),
      status: `DISPUTE ${status.toUpperCase()}`,
      paymentReference: p.id,
      providerReference: providerDisputeId,
      paidAt: toBusinessDate(new Date()),
      methodDisplay: p.paymentMethodDisplay,
    });
    await this.mail.sendOnce({ dedupeKey: `dispute-sales:${providerDisputeId}:${status}`, template: 'dispute_sales_notice', to: this.mail.salesAddress(), ...notice, entityType: 'payment', entityId: p.id });
  }
}
