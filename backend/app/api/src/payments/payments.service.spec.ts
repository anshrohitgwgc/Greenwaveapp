import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import * as crypto from 'crypto';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Invoice } from '../invoices/entities/invoice.entity';
import { WarehousesService } from '../warehouses/warehouses.service';
import { Payment } from './entities/payment.entity';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let paymentRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
  };
  let invoiceRepo: {
    findOne: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let auditService: { record: jest.Mock };
  let warehousesService: {
    assertWarehouseAccess: jest.Mock;
    getUserAuthorizedWarehouseIds: jest.Mock;
  };
  let configService: { get: jest.Mock };

  const webhookSecret = 'whsec_test_secret_for_unit_tests_only';

  beforeEach(async () => {
    paymentRepo = {
      create: jest.fn((dto: Record<string, unknown>) => ({
        ...dto,
        id: 'pay-uuid-1',
      })),
      save: jest.fn((p) => Promise.resolve(p)),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };
    invoiceRepo = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(),
    };
    auditService = { record: jest.fn().mockResolvedValue(undefined) };
    warehousesService = {
      assertWarehouseAccess: jest.fn().mockResolvedValue(undefined),
      getUserAuthorizedWarehouseIds: jest.fn().mockResolvedValue(['wh-cgy-1']),
    };
    configService = {
      get: jest.fn((k) =>
        k === 'STRIPE_WEBHOOK_SECRET' ? webhookSecret : null,
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken(Invoice), useValue: invoiceRepo },
        {
          provide: getDataSourceToken(),
          useValue: { createQueryBuilder: jest.fn() },
        },
        { provide: AuditService, useValue: auditService },
        { provide: WarehousesService, useValue: warehousesService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  describe('1. Secure Payment Token & Link Generation', () => {
    it('generates a 64-character hex token and payment URL for unpaid invoice', async () => {
      const mockInvoice = {
        id: 'inv-uuid-1',
        invoiceNumber: '1115',
        total: '10498.95',
        currency: 'CAD',
        paymentStatus: 'unpaid',
        status: 'final',
        warehouseId: 'wh-cgy-1',
        paymentToken: null,
      };
      invoiceRepo.findOne.mockResolvedValue(mockInvoice);

      const actor: AuthenticatedUser = {
        id: 1,
        email: 'admin@greenwave.test',
        role: 'admin',
        permissions: ['payments:manage'],
      };

      const result = await service.getOrCreatePaymentLink('inv-uuid-1', actor);

      expect(warehousesService.assertWarehouseAccess).toHaveBeenCalledWith(
        actor,
        'wh-cgy-1',
      );
      expect(result.invoiceNumber).toBe('1115');
      expect(result.amount).toBe(10498.95);
      expect(result.currency).toBe('CAD');
      expect(result.paymentToken).toBeDefined();
      expect(result.paymentToken.length).toBe(64);
      expect(result.paymentUrl).toBe(`/pay/${result.paymentToken}`);
      expect(invoiceRepo.update).toHaveBeenCalledWith('inv-uuid-1', {
        paymentToken: result.paymentToken,
      });
      expect(auditService.record).toHaveBeenCalled();
    });
  });

  describe('2. Public Invoice Sanitization (Zero Internal ID Leaks)', () => {
    it('returns sanitized invoice data without employee IDs or secrets', async () => {
      const mockInvoice = {
        id: 'internal-inv-uuid',
        invoiceNumber: '1115',
        invoiceDate: '2026-08-30',
        dueDate: '2026-09-15',
        billTo: 'Acme Scrap Corp\n123 Industrial Rd',
        shipTo: 'Acme Yard 4',
        poReference: 'PO-9921',
        subtotal: '9999.00',
        discountTotal: '0.00',
        taxLabel: 'GST @ 5%',
        taxRate: '5.000',
        taxTotal: '499.95',
        total: '10498.95',
        currency: 'CAD',
        paymentStatus: 'unpaid',
        paidAt: null,
        paymentInstructions: 'Interac e-Transfer or Online Credit Card',
        paymentToken:
          'valid_secure_token_64_characters_long_1234567890123456789012345678',
        createdBy: 99, // Internal user ID - must NOT be in public DTO
        warehouseId: 'secret-wh-uuid',
        items: [
          {
            description: 'Recycled Aluminum Ingot 6061',
            quantity: '5.000',
            unit: 'ton',
            unitPrice: '1999.8000',
            discount: '0.00',
            isRebate: false,
            lineTotal: '9999.00',
            sortOrder: 0,
          },
        ],
      };
      invoiceRepo.findOne.mockResolvedValue(mockInvoice);

      const publicData = await service.getPublicInvoiceByToken(
        'valid_secure_token_64_characters_long_1234567890123456789012345678',
      );

      expect(publicData.invoiceNumber).toBe('1115');
      expect(publicData.total).toBe(10498.95);
      expect(publicData.currency).toBe('CAD');
      expect(publicData.items.length).toBe(1);
      expect(publicData.items[0].description).toBe(
        'Recycled Aluminum Ingot 6061',
      );
      // Verify internal fields are not exposed
      const record = publicData as unknown as Record<string, unknown>;
      expect(record.id).toBeUndefined();
      expect(record.createdBy).toBeUndefined();
      expect(record.warehouseId).toBeUndefined();
    });

    it('throws NotFoundException on invalid payment token', async () => {
      invoiceRepo.findOne.mockResolvedValue(null);
      await expect(
        service.getPublicInvoiceByToken('invalid_token_1234567890'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('3. Payment Amount Integrity & Checkout Session', () => {
    it('creates checkout session strictly from DB invoice amount', async () => {
      const mockInvoice = {
        id: 'inv-uuid-1',
        invoiceNumber: '1115',
        total: '10498.95',
        currency: 'CAD',
        paymentStatus: 'unpaid',
        customerId: 'cust-1',
        warehouseId: 'wh-cgy-1',
        paymentToken: 'test_token_1234567890123456789012345678',
      };
      invoiceRepo.findOne.mockResolvedValue(mockInvoice);

      const session = await service.createCheckoutSession(
        'test_token_1234567890123456789012345678',
      );

      expect(session.amount).toBe(10498.95);
      expect(session.currency).toBe('CAD');
      expect(session.sessionId).toMatch(/^cs_test_/);
      expect(paymentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: '10498.95',
          currency: 'CAD',
          status: 'pending',
        }),
      );
    });

    it('rejects checkout session creation for already paid invoice (400 Bad Request)', async () => {
      const mockPaidInvoice = {
        id: 'inv-uuid-1',
        invoiceNumber: '1115',
        total: '10498.95',
        paymentStatus: 'paid',
        paymentToken: 'test_token_1234567890123456789012345678',
      };
      invoiceRepo.findOne.mockResolvedValue(mockPaidInvoice);

      await expect(
        service.createCheckoutSession(
          'test_token_1234567890123456789012345678',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('4. Webhook Cryptographic Signature Verification', () => {
    it('validates authentic HMAC-SHA256 signature with timestamp', () => {
      const rawBody = JSON.stringify({
        type: 'checkout.session.completed',
        data: {},
      });
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signedPayload = `${timestamp}.${rawBody}`;
      const v1Sig = crypto
        .createHmac('sha256', webhookSecret)
        .update(signedPayload)
        .digest('hex');

      const header = `t=${timestamp},v1=${v1Sig}`;
      const isValid = service.verifyWebhookSignature(
        header,
        rawBody,
        webhookSecret,
      );
      expect(isValid).toBe(true);
    });

    it('rejects tampered webhook signature (returns false)', () => {
      const rawBody = JSON.stringify({
        type: 'checkout.session.completed',
        data: {},
      });
      const header = `t=${Math.floor(Date.now() / 1000)},v1=deadbeef0123456789abcdef`;
      const isValid = service.verifyWebhookSignature(
        header,
        rawBody,
        webhookSecret,
      );
      expect(isValid).toBe(false);
    });

    it('rejects replayed webhooks with old timestamps (> 5 minutes)', () => {
      const rawBody = JSON.stringify({
        type: 'checkout.session.completed',
        data: {},
      });
      const oldTimestamp = (Math.floor(Date.now() / 1000) - 400).toString();
      const signedPayload = `${oldTimestamp}.${rawBody}`;
      const v1Sig = crypto
        .createHmac('sha256', webhookSecret)
        .update(signedPayload)
        .digest('hex');

      const header = `t=${oldTimestamp},v1=${v1Sig}`;
      const isValid = service.verifyWebhookSignature(
        header,
        rawBody,
        webhookSecret,
      );
      expect(isValid).toBe(false);
    });
  });

  describe('5. Webhook Idempotency & Transition to PAID', () => {
    it('processes successful payment webhook and authoritatively updates invoice to PAID', async () => {
      const invoice = {
        id: 'inv-uuid-1',
        invoiceNumber: '1115',
        total: '10498.95',
        currency: 'CAD',
        paymentStatus: 'pending',
        warehouseId: 'wh-cgy-1',
      };
      invoiceRepo.findOne.mockResolvedValue(invoice);
      paymentRepo.findOne.mockResolvedValue({
        id: 'pay-1',
        invoiceId: 'inv-uuid-1',
        status: 'pending',
      });

      const payload = {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_session_999',
            payment_intent: 'pi_test_intent_999',
            amount_total: 1049895, // in cents
            metadata: { invoiceNumber: '1115' },
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const sig = crypto
        .createHmac('sha256', webhookSecret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');

      const result = await service.handleWebhook(
        `t=${timestamp},v1=${sig}`,
        rawBody,
        payload,
      );

      expect(result.status).toBe('paid');
      expect(invoiceRepo.update).toHaveBeenCalledWith(
        'inv-uuid-1',
        expect.objectContaining({
          paymentStatus: 'paid',
          status: 'paid',
          paymentProvider: 'stripe',
          paymentReference: 'pi_test_intent_999',
        }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'invoice.paid',
        }),
      );
    });

    it('guarantees idempotency on duplicate webhook receipts (no duplicate recording)', async () => {
      const alreadyPaidInvoice = {
        id: 'inv-uuid-1',
        invoiceNumber: '1115',
        total: '10498.95',
        currency: 'CAD',
        paymentStatus: 'paid',
      };
      invoiceRepo.findOne.mockResolvedValue(alreadyPaidInvoice);

      const payload = {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_session_999',
            metadata: { invoiceNumber: '1115' },
          },
        },
      };
      const rawBody = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const sig = crypto
        .createHmac('sha256', webhookSecret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');

      const result = await service.handleWebhook(
        `t=${timestamp},v1=${sig}`,
        rawBody,
        payload,
      );

      expect(result.idempotent).toBe(true);
      expect(invoiceRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('6. Refunds', () => {
    it('allows admin to refund payment', async () => {
      paymentRepo.findOne.mockResolvedValue({
        id: 'pay-1',
        invoiceId: 'inv-1',
        amount: '10498.95',
        currency: 'CAD',
        status: 'paid',
        warehouseId: 'wh-cgy-1',
      });

      const actor: AuthenticatedUser = {
        id: 1,
        email: 'admin@greenwave.test',
        role: 'admin',
        permissions: ['payments:refund'],
      };

      const res = await service.refundPayment('pay-1', actor, {
        reason: 'Customer returned commodity batch',
      });

      expect(res.status).toBe('refunded');
      expect(invoiceRepo.update).toHaveBeenCalledWith('inv-1', {
        paymentStatus: 'refunded',
        status: 'refunded',
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'payment.refunded',
        }),
      );
    });
  });
});
