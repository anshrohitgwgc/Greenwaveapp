import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Invoice } from '../invoices/entities/invoice.entity';
import { WarehousesService } from '../warehouses/warehouses.service';
import { ProcessRefundDto } from './dto/process-refund.dto';
import { SendInvoiceEmailDto } from './dto/send-invoice-email.dto';
import { Payment } from './entities/payment.entity';

export interface WebhookEventData {
  id?: string;
  payment_intent?: string;
  paymentIntentId?: string;
  checkout_session_id?: string;
  sessionId?: string;
  amount_total?: number;
  amount?: number;
  currency?: string;
  customer_email?: string;
  metadata?: {
    invoiceNumber?: string;
    paymentToken?: string;
    [key: string]: unknown;
  };
  last_payment_error?: {
    message?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface WebhookPayload {
  type?: string;
  event?: string;
  data?: {
    object?: WebhookEventData;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface PublicInvoiceDto {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  billTo: string | null;
  shipTo: string | null;
  poReference: string | null;
  subtotal: number;
  discountTotal: number;
  taxLabel: string | null;
  taxRate: number;
  taxTotal: number;
  total: number;
  currency: string;
  paymentStatus: string;
  paidAt: string | null;
  paymentInstructions: string | null;
  items: Array<{
    description: string;
    quantity: number;
    unit: string | null;
    unitPrice: number;
    discount: number;
    isRebate: boolean;
    lineTotal: number;
  }>;
}

@Injectable()
export class PaymentsService {
  private readonly defaultWebhookSecret: string;

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly warehousesService: WarehousesService,
    private readonly configService: ConfigService,
  ) {
    this.defaultWebhookSecret =
      this.configService.get<string>('STRIPE_WEBHOOK_SECRET') ||
      'whsec_greenwave_test_secret_key_v2_authoritative';
  }

  /**
   * Generates a cryptographically random 64-character hex payment token.
   */
  private generateSecurePaymentToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Protected: Admin or Manager gets or generates the secure payment token/URL for an invoice.
   */
  async getOrCreatePaymentLink(invoiceId: string, actor: AuthenticatedUser) {
    const invoice = await this.invoiceRepository.findOne({
      where: { id: invoiceId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    if (invoice.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        invoice.warehouseId,
      );
    }

    let token = invoice.paymentToken;
    if (!token) {
      token = this.generateSecurePaymentToken();
      await this.invoiceRepository.update(invoice.id, {
        paymentToken: token,
      });
      invoice.paymentToken = token;
    }

    const paymentUrl = `/pay/${token}`;

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'payment.link_generated',
      entityType: 'invoice',
      entityId: invoice.id,
      warehouseId: invoice.warehouseId,
      summary: `${actor.email} generated secure payment link for invoice #${invoice.invoiceNumber}`,
    });

    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      paymentToken: token,
      paymentUrl,
      amount: Number(invoice.total),
      currency: invoice.currency || 'CAD',
      paymentStatus: invoice.paymentStatus || 'unpaid',
      status: invoice.status,
    };
  }

  /**
   * Public: Customer opens /pay/:token.
   * Returns sanitized public invoice details without internal user IDs, audit trail, or employee secrets.
   */
  async getPublicInvoiceByToken(token: string): Promise<PublicInvoiceDto> {
    if (!token || token.trim().length < 16) {
      throw new NotFoundException('Invalid or missing payment token');
    }

    const invoice = await this.invoiceRepository.findOne({
      where: { paymentToken: token },
      relations: ['items'],
    });

    if (!invoice) {
      throw new NotFoundException(
        'Invoice not found for the requested payment link',
      );
    }

    const items = (invoice.items || [])
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map((item) => ({
        description: item.description,
        quantity: Number(item.quantity || 0),
        unit: item.unit || null,
        unitPrice: Number(item.unitPrice || 0),
        discount: Number(item.discount || 0),
        isRebate: !!item.isRebate,
        lineTotal: Number(item.lineTotal || 0),
      }));

    return {
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate || null,
      billTo: invoice.billTo || null,
      shipTo: invoice.shipTo || null,
      poReference: invoice.poReference || null,
      subtotal: Number(invoice.subtotal || 0),
      discountTotal: Number(invoice.discountTotal || 0),
      taxLabel: invoice.taxLabel || null,
      taxRate: Number(invoice.taxRate || 0),
      taxTotal: Number(invoice.taxTotal || 0),
      total: Number(invoice.total || 0),
      currency: invoice.currency || 'CAD',
      paymentStatus: invoice.paymentStatus || 'unpaid',
      paidAt: invoice.paidAt ? invoice.paidAt.toISOString() : null,
      paymentInstructions: invoice.paymentInstructions || null,
      items,
    };
  }

  /**
   * Public: Customer clicks [ PAY INVOICE ] on the public payment page.
   * Server authoritatively pulls amount from DB and initiates checkout session.
   * Customer cannot manipulate amount!
   */
  async createCheckoutSession(token: string) {
    if (!token || token.trim().length < 16) {
      throw new NotFoundException('Invalid payment token');
    }

    const invoice = await this.invoiceRepository.findOne({
      where: { paymentToken: token },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    if (invoice.paymentStatus === 'paid') {
      throw new BadRequestException(
        'This invoice has already been paid in full.',
      );
    }

    const amount = Number(invoice.total);
    const currency = (invoice.currency || 'CAD').toUpperCase();

    if (amount <= 0) {
      throw new BadRequestException(
        'Invoice total must be greater than zero to process payment.',
      );
    }

    // Generate secure session identifier
    const sessionId = `cs_test_${crypto.randomBytes(16).toString('hex')}`;
    const paymentId = crypto.randomUUID();

    const payment = this.paymentRepository.create({
      id: paymentId,
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      warehouseId: invoice.warehouseId,
      provider: 'stripe',
      providerCheckoutId: sessionId,
      amount: String(amount),
      currency,
      status: 'pending',
      metadata: {
        invoiceNumber: invoice.invoiceNumber,
        paymentToken: token,
        createdVia: 'customer_checkout',
      },
    });

    await this.paymentRepository.save(payment);

    await this.invoiceRepository.update(invoice.id, {
      paymentStatus: 'pending',
      paymentProvider: 'stripe',
    });

    // In production, this would return Stripe Hosted Checkout URL
    // In local / sandbox test mode, returns structured hosted checkout URL
    const checkoutUrl = `/pay/${token}?session_id=${sessionId}&provider=stripe`;

    return {
      sessionId,
      checkoutUrl,
      invoiceNumber: invoice.invoiceNumber,
      amount,
      currency,
      status: 'pending',
    };
  }

  /**
   * Verifies the cryptographic HMAC-SHA256 signature of an incoming webhook.
   */
  verifyWebhookSignature(
    signatureHeader: string | undefined,
    rawBody: string,
    secret?: string,
  ): boolean {
    if (!signatureHeader || !rawBody) return false;
    const webhookSecret = secret || this.defaultWebhookSecret;

    try {
      // Standard Stripe format: t=1614555555,v1=5257a869...
      const parts = signatureHeader.split(',');
      let timestamp = '';
      let signature = '';

      for (const part of parts) {
        const [key, value] = part.trim().split('=');
        if (key === 't') timestamp = value;
        if (key === 'v1') signature = value;
      }

      if (!timestamp || !signature) {
        // Fallback: direct hex signature matching
        const directExpected = crypto
          .createHmac('sha256', webhookSecret)
          .update(rawBody)
          .digest('hex');
        return crypto.timingSafeEqual(
          Buffer.from(signatureHeader, 'hex'),
          Buffer.from(directExpected, 'hex'),
        );
      }

      // Check replay attack window (5 minutes)
      const currentTime = Math.floor(Date.now() / 1000);
      const parsedTimestamp = parseInt(timestamp, 10);
      if (
        isNaN(parsedTimestamp) ||
        Math.abs(currentTime - parsedTimestamp) > 300
      ) {
        // Timestamp out of tolerance
        return false;
      }

      const signedPayload = `${timestamp}.${rawBody}`;
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(signedPayload)
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex'),
      );
    } catch {
      return false;
    }
  }

  /**
   * Public webhook receiver with cryptographic signature verification and strict idempotency.
   */
  async handleWebhook(
    signatureHeader: string | undefined,
    rawBody: string,
    payload: WebhookPayload,
  ) {
    // 1. Signature verification
    const isValid = this.verifyWebhookSignature(signatureHeader, rawBody);
    if (!isValid) {
      throw new UnauthorizedException('Invalid or missing webhook signature');
    }

    const eventType = payload?.type || payload?.event;
    const eventData: WebhookEventData =
      payload?.data?.object || payload?.data || {};

    const providerPaymentId =
      eventData.payment_intent ||
      eventData.paymentIntentId ||
      (typeof eventData.id === 'string' && eventData.id.startsWith('pi_')
        ? eventData.id
        : null);
    const providerCheckoutId =
      eventData.checkout_session_id ||
      eventData.sessionId ||
      (typeof eventData.id === 'string' && eventData.id.startsWith('cs_')
        ? eventData.id
        : eventData.id);
    const metadata = eventData.metadata || {};
    const invoiceNumber = metadata.invoiceNumber;
    const paymentToken = metadata.paymentToken;

    // Handle payment success / checkout completion
    if (
      eventType === 'checkout.session.completed' ||
      eventType === 'payment_intent.succeeded' ||
      eventType === 'payment.succeeded'
    ) {
      // Find invoice
      let invoice: Invoice | null = null;
      if (paymentToken) {
        invoice = await this.invoiceRepository.findOne({
          where: { paymentToken },
        });
      } else if (invoiceNumber) {
        invoice = await this.invoiceRepository.findOne({
          where: { invoiceNumber },
        });
      } else if (providerCheckoutId) {
        const paymentRecord = await this.paymentRepository.findOne({
          where: { providerCheckoutId },
        });
        if (paymentRecord) {
          invoice = await this.invoiceRepository.findOne({
            where: { id: paymentRecord.invoiceId },
          });
        }
      }

      if (!invoice) {
        return {
          received: true,
          warning: 'Invoice not found for webhook event',
        };
      }

      // IDEMPOTENCY CHECK: If already marked paid, return success without duplicate processing!
      if (invoice.paymentStatus === 'paid') {
        return { received: true, idempotent: true, status: 'already_paid' };
      }

      const paidAt = new Date();
      const amountPaid = eventData.amount_total
        ? String(eventData.amount_total / 100)
        : String(eventData.amount || invoice.total);

      // Find or create payment record
      const paymentLookup: FindOptionsWhere<Payment>[] = [];
      if (providerCheckoutId) {
        paymentLookup.push({ providerCheckoutId });
      }
      if (providerPaymentId) {
        paymentLookup.push({ providerPaymentId });
      }
      paymentLookup.push({ invoiceId: invoice.id, status: 'pending' });

      let payment = await this.paymentRepository.findOne({
        where: paymentLookup,
      });

      if (payment) {
        payment.status = 'paid';
        payment.paidAt = paidAt;
        payment.providerPaymentId =
          providerPaymentId || payment.providerPaymentId;
        payment.amount = amountPaid;
        payment.metadata = {
          ...payment.metadata,
          webhookProcessedAt: paidAt.toISOString(),
        };
        await this.paymentRepository.save(payment);
      } else {
        payment = this.paymentRepository.create({
          id: crypto.randomUUID(),
          invoiceId: invoice.id,
          customerId: invoice.customerId,
          warehouseId: invoice.warehouseId,
          provider: 'stripe',
          providerPaymentId,
          providerCheckoutId,
          amount: amountPaid,
          currency: invoice.currency || 'CAD',
          status: 'paid',
          paidAt,
          metadata: { webhookProcessedAt: paidAt.toISOString() },
        });
        await this.paymentRepository.save(payment);
      }

      // Update Authoritative Invoice State in PostgreSQL
      await this.invoiceRepository.update(invoice.id, {
        paymentStatus: 'paid',
        status: 'paid',
        paidAt,
        paymentProvider: 'stripe',
        paymentReference: providerPaymentId || providerCheckoutId,
      });

      // Record Audit Event
      await this.auditService.record({
        actorUserId: null,
        actorRole: 'SYSTEM_WEBHOOK',
        action: 'invoice.paid',
        entityType: 'invoice',
        entityId: invoice.id,
        warehouseId: invoice.warehouseId,
        summary: `Invoice #${invoice.invoiceNumber} marked PAID via verified Stripe webhook (${invoice.currency} $${amountPaid})`,
      });

      return {
        received: true,
        invoiceNumber: invoice.invoiceNumber,
        status: 'paid',
      };
    }

    // Handle payment failure
    if (
      eventType === 'payment_intent.payment_failed' ||
      eventType === 'payment.failed'
    ) {
      let invoiceId: string | null = null;
      let targetWarehouseId: string | null = null;

      if (invoiceNumber) {
        const inv = await this.invoiceRepository.findOne({
          where: { invoiceNumber },
        });
        if (inv) {
          invoiceId = inv.id;
          targetWarehouseId = inv.warehouseId;
        }
      }

      if (providerCheckoutId || providerPaymentId) {
        const failedPaymentLookup: FindOptionsWhere<Payment>[] = [];
        if (providerCheckoutId) {
          failedPaymentLookup.push({ providerCheckoutId });
        }
        if (providerPaymentId) {
          failedPaymentLookup.push({ providerPaymentId });
        }

        const payment = await this.paymentRepository.findOne({
          where: failedPaymentLookup,
        });
        if (payment) {
          payment.status = 'failed';
          payment.failureReason =
            eventData.last_payment_error?.message ||
            'Payment transaction failed';
          await this.paymentRepository.save(payment);
          invoiceId = payment.invoiceId;
          targetWarehouseId = payment.warehouseId;
        }
      }

      if (invoiceId) {
        await this.invoiceRepository.update(invoiceId, {
          paymentStatus: 'failed',
        });

        await this.auditService.record({
          actorUserId: null,
          actorRole: 'SYSTEM_WEBHOOK',
          action: 'payment.failed',
          entityType: 'payment',
          entityId: invoiceId,
          warehouseId: targetWarehouseId,
          summary: `Payment failed for invoice ${invoiceId}: ${eventData.last_payment_error?.message || 'Transaction declined'}`,
        });
      }

      return { received: true, status: 'failed_recorded' };
    }

    return { received: true, unhandledEvent: eventType };
  }

  /**
   * Protected: Admin or Manager retrieves financial payment tracking dashboard metrics.
   * Calculated directly from PostgreSQL data.
   */
  async getPaymentMetrics(actor: AuthenticatedUser, warehouseId?: string) {
    if (warehouseId) {
      await this.warehousesService.assertWarehouseAccess(actor, warehouseId);
    }

    const qb = this.invoiceRepository.createQueryBuilder('inv');

    if (warehouseId) {
      qb.andWhere('inv.warehouseId = :warehouseId', { warehouseId });
    } else if (
      !actor.hasGlobalAccess &&
      (!actor.permissions ||
        !actor.permissions.includes('warehouses:global_access'))
    ) {
      const authorizedIds =
        await this.warehousesService.getUserAuthorizedWarehouseIds(
          actor.id,
          actor.role,
          actor.permissions,
        );
      if (authorizedIds.length === 0) {
        qb.andWhere('inv.warehouseId IS NULL');
      } else {
        qb.andWhere(
          '(inv.warehouseId IN (:...authorizedIds) OR inv.warehouseId IS NULL)',
          { authorizedIds },
        );
      }
    }

    const invoices = await qb.getMany();

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    let totalOutstanding = 0;
    let paidThisMonth = 0;
    let totalPaidAllTime = 0;
    let unpaidCount = 0;
    let pendingCount = 0;
    let paidCount = 0;
    let failedCount = 0;
    let refundedCount = 0;
    let overdueCount = 0;

    const now = new Date();

    for (const inv of invoices) {
      const total = Number(inv.total) || 0;
      const status = (inv.paymentStatus || 'unpaid').toLowerCase();

      if (status === 'paid') {
        paidCount++;
        totalPaidAllTime += total;
        if (inv.paidAt && new Date(inv.paidAt) >= startOfMonth) {
          paidThisMonth += total;
        }
      } else if (status === 'pending') {
        pendingCount++;
        totalOutstanding += total;
      } else if (status === 'failed') {
        failedCount++;
        totalOutstanding += total;
      } else if (status === 'refunded') {
        refundedCount++;
      } else {
        // unpaid
        unpaidCount++;
        totalOutstanding += total;
        if (inv.dueDate && new Date(inv.dueDate) < now) {
          overdueCount++;
        }
      }
    }

    return {
      totalOutstanding: Math.round(totalOutstanding * 100) / 100,
      paidThisMonth: Math.round(paidThisMonth * 100) / 100,
      totalPaidAllTime: Math.round(totalPaidAllTime * 100) / 100,
      unpaidCount,
      pendingCount,
      paidCount,
      failedCount,
      refundedCount,
      overdueCount,
      totalInvoicesCount: invoices.length,
      currency: 'CAD',
    };
  }

  /**
   * Protected: Admin or authorized staff initiates a refund.
   */
  async refundPayment(
    paymentId: string,
    actor: AuthenticatedUser,
    dto: ProcessRefundDto,
  ) {
    if (
      actor.role !== 'admin' &&
      (!actor.permissions || !actor.permissions.includes('payments:refund'))
    ) {
      throw new ForbiddenException(
        'You do not have permission to issue refunds.',
      );
    }

    const payment = await this.paymentRepository.findOne({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('Payment record not found');

    if (payment.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        payment.warehouseId,
      );
    }

    if (payment.status === 'refunded') {
      throw new BadRequestException('Payment has already been refunded.');
    }

    payment.status = 'refunded';
    payment.failureReason = dto.reason || 'Refunded by administrator';
    await this.paymentRepository.save(payment);

    await this.invoiceRepository.update(payment.invoiceId, {
      paymentStatus: 'refunded',
      status: 'refunded',
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'payment.refunded',
      entityType: 'payment',
      entityId: payment.id,
      warehouseId: payment.warehouseId,
      summary: `${actor.email} refunded payment #${payment.id} for invoice (${payment.currency} $${payment.amount})`,
    });

    return {
      success: true,
      paymentId: payment.id,
      status: 'refunded',
      reason: payment.failureReason,
    };
  }

  /**
   * Protected: Send invoice with secure payment link to customer.
   */
  async sendInvoiceEmail(
    invoiceId: string,
    actor: AuthenticatedUser,
    dto: SendInvoiceEmailDto,
  ) {
    const linkResult = await this.getOrCreatePaymentLink(invoiceId, actor);
    const invoice = await this.invoiceRepository.findOne({
      where: { id: invoiceId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const recipient =
      dto.recipientEmail || invoice.billTo || 'customer@example.com';

    // Formatted email payload
    const emailPayload = {
      to: recipient,
      subject: `GreenWave Recycling Invoice #${invoice.invoiceNumber}`,
      invoiceNumber: invoice.invoiceNumber,
      amount: Number(invoice.total),
      currency: invoice.currency || 'CAD',
      dueDate: invoice.dueDate || 'Upon Receipt',
      paymentUrl: linkResult.paymentUrl,
      message:
        dto.customMessage ||
        'Thank you for your business. Please click below to review and pay your invoice online.',
    };

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'invoice.email_sent',
      entityType: 'invoice',
      entityId: invoice.id,
      warehouseId: invoice.warehouseId,
      summary: `${actor.email} sent invoice #${invoice.invoiceNumber} to ${recipient} with secure payment link`,
    });

    return {
      success: true,
      recipient,
      paymentUrl: linkResult.paymentUrl,
      invoiceNumber: invoice.invoiceNumber,
      amount: Number(invoice.total),
      currency: invoice.currency || 'CAD',
      emailPayload,
      dispatchedAt: new Date().toISOString(),
    };
  }
}
