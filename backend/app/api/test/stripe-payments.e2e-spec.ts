import { gateDatabase } from './gate-database';
/* eslint-disable */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import Stripe from 'stripe';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { ACCOUNTING_ENTITIES } from '../src/accounting/accounting.module';
import { JournalEntry } from '../src/accounting/entities/journal-entry.entity';
import { JournalLine } from '../src/accounting/entities/journal-line.entity';
import { LedgerAccount } from '../src/accounting/entities/ledger-account.entity';
import { LedgerService } from '../src/accounting/ledger.service';
import { AuditModule } from '../src/audit/audit.module';
import { AuditEvent } from '../src/audit/entities/audit-event.entity';
import { AuthModule } from '../src/auth/auth.module';
import { Customer } from '../src/customers/entities/customer.entity';
import { UserDivision } from '../src/divisions/entities/user-division.entity';
import { InvoiceItem } from '../src/invoices/entities/invoice-item.entity';
import { Invoice } from '../src/invoices/entities/invoice.entity';
import { InvoicesModule } from '../src/invoices/invoices.module';
import { InvoicesService } from '../src/invoices/invoices.service';
import { EmailOutbox } from '../src/mail/entities/email-outbox.entity';
import { MAIL_TRANSPORT, OutboundMessage } from '../src/mail/mail.service';
import { MailModule } from '../src/mail/mail.module';
import { PaymentRefund } from '../src/payments/entities/payment-refund.entity';
import { Payment } from '../src/payments/entities/payment.entity';
import { ProviderEvent } from '../src/payments/entities/provider-event.entity';
import { PAYMENT_ENTITIES, PaymentsModule } from '../src/payments/payments.module';
import { RedisService } from '../src/redis/redis.service';
import { Permission } from '../src/roles/entities/permission.entity';
import { RolePermission } from '../src/roles/entities/role-permission.entity';
import { Role } from '../src/roles/entities/role.entity';
import { UserRole } from '../src/roles/entities/user-role.entity';
import { RolesModule } from '../src/roles/roles.module';
import { STRIPE_CLIENT } from '../src/stripe/stripe.service';
import { User } from '../src/users/entities/user.entity';
import { UsersModule } from '../src/users/users.module';
import { UserWarehouse } from '../src/warehouses/entities/user-warehouse.entity';
import { Warehouse } from '../src/warehouses/entities/warehouse.entity';
import { WarehousesModule } from '../src/warehouses/warehouses.module';
import { grantDivisions } from './fixtures/divisions-test.helper';

/**
 * Real HTTP + real Stripe signature verification + real ledger, against sqlite.
 * Only the Stripe *API* (network) and SMTP delivery are faked.
 */
describe('E2E: Stripe payments, webhooks, refunds, ledger', () => {
  jest.setTimeout(60000);

  const WEBHOOK_SECRET = 'whsec_' + randomUUID().replace(/-/g, '');
  const WH = '22222222-2222-4222-8222-222222222222';
  const CUSTOMER = 'cccccccc-0001-4ccc-8ccc-cccccccccccc';

  let app: INestApplication;
  let ds: DataSource;
  let server: any;
  let adminToken: string;
  let managerToken: string;
  let staffToken: string;

  // ---- fake Stripe API --------------------------------------------------------
  const intents = new Map<string, any>();
  let seq = 0;
  const fake = {
    paymentIntents: {
      create: jest.fn(async (params: any, opts: any) => {
        const id = `pi_test_${++seq}`;
        const pi = {
          id, object: 'payment_intent', amount: params.amount, currency: params.currency,
          status: 'requires_payment_method', client_secret: `${id}_secret_abc`, metadata: params.metadata,
          latest_charge: null, amount_received: 0, customer: null, _idem: opts?.idempotencyKey,
        };
        intents.set(id, pi);
        return pi;
      }),
      retrieve: jest.fn(async (id: string) => {
        const pi = intents.get(id);
        if (!pi) throw Object.assign(new Error('missing'), { type: 'StripeInvalidRequestError', code: 'resource_missing' });
        return pi;
      }),
      cancel: jest.fn(async (id: string) => {
        const pi = intents.get(id);
        pi.status = 'canceled';
        return pi;
      }),
    },
    refunds: {
      create: jest.fn(async (params: any, opts: any) => ({
        id: `re_test_${++seq}`, object: 'refund', amount: params.amount, currency: 'cad', status: 'pending',
        payment_intent: params.payment_intent, metadata: params.metadata, _idem: opts?.idempotencyKey,
      })),
    },
    balanceTransactions: { retrieve: jest.fn(), list: jest.fn() },
    balance: { retrieve: jest.fn(async () => ({ available: [{ amount: 12345, currency: 'cad' }], pending: [] })) },
    payouts: { list: jest.fn() },
    charges: { retrieve: jest.fn() },
  };

  const sentMail: OutboundMessage[] = [];

  const now = () => Math.floor(Date.now() / 1000);

  function succeedIntent(id: string, overrides: { amountReceived?: number; fee?: number } = {}) {
    const pi = intents.get(id);
    const amount = overrides.amountReceived ?? pi.amount;
    const fee = overrides.fee ?? 330;
    pi.status = 'succeeded';
    pi.amount_received = amount;
    pi.latest_charge = {
      id: `ch_for_${id}`, object: 'charge', created: now(), payment_intent: id,
      payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242' } },
      balance_transaction: {
        id: `txn_for_${id}`, object: 'balance_transaction', amount, fee, net: amount - fee, currency: 'cad',
        status: 'pending', type: 'charge', reporting_category: 'charge', source: `ch_for_${id}`,
        created: now(), available_on: now() + 86400, description: null,
      },
    };
    return pi;
  }

  function event(type: string, object: any, created = now()) {
    return {
      id: `evt_${randomUUID().replace(/-/g, '')}`, object: 'event', type, created, livemode: false,
      api_version: '2025-08-27.basil', data: { object }, pending_webhooks: 1, request: { id: null, idempotency_key: null },
    };
  }

  function deliver(evt: any, secret = WEBHOOK_SECRET) {
    const payload = JSON.stringify(evt);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    return request(server).post('/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', header).send(payload);
  }

  async function seedInvoice(number: string, subtotal: string, tax: string, total: string, status = 'draft') {
    const id = randomUUID();
    await ds.getRepository(Invoice).save({
      id, invoiceNumber: number, invoiceDate: '2026-09-01', dueDate: '2026-09-30', customerId: CUSTOMER,
      billTo: 'Acme Metals Ltd\n123 Private Road', subtotal, discountTotal: '0', taxLabel: 'GST', taxRate: '5',
      taxTotal: tax, total, status, paymentStatus: 'unpaid', currency: 'CAD', warehouseId: WH,
      division: 'recycling', createdBy: 1, updatedBy: 1, notes: 'internal note', items: [],
    } as any);
    await ds.getRepository(InvoiceItem).save({ id: randomUUID(), invoiceId: id, description: 'Copper scrap', quantity: '1', unitPrice: subtotal, discount: '0', lineTotal: subtotal, isRebate: false, sortOrder: 0 } as any);
    return id;
  }

  async function ledgerBalanced() {
    const rows = await ds.getRepository(JournalLine).createQueryBuilder('l')
      .select('l.entryId', 'entryId').addSelect('SUM(l.debitMinor)', 'd').addSelect('SUM(l.creditMinor)', 'c')
      .groupBy('l.entryId').getRawMany();
    for (const r of rows) expect({ entry: r.entryId, d: Number(r.d) }).toEqual({ entry: r.entryId, d: Number(r.c) });
    return rows.length;
  }

  async function accountBalance(systemKey: string) {
    const acct = await ds.getRepository(LedgerAccount).findOneByOrFail({ systemKey });
    const r = await ds.getRepository(JournalLine).createQueryBuilder('l')
      .select('COALESCE(SUM(l.debitMinor),0)', 'd').addSelect('COALESCE(SUM(l.creditMinor),0)', 'c')
      .where('l.accountId = :id', { id: acct.id }).getRawOne();
    return Number(r.d) - Number(r.c);
  }

  const tokenFromUrl = (url: string) => url.split('/p/')[1];

  beforeAll(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_greenwave_e2e';
    process.env.PAYMENT_LINK_SECRET = 'e2e-payment-link-secret-' + randomUUID();
    delete process.env.STRIPE_SECRET_KEY;

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        TypeOrmModule.forRoot({
          ...gateDatabase('stripe'),
          entities: [User, AuditEvent, Warehouse, UserWarehouse, UserDivision, Customer, Invoice, InvoiceItem,
            Role, Permission, RolePermission, UserRole, EmailOutbox, ...PAYMENT_ENTITIES, ...ACCOUNTING_ENTITIES],
        }),
        AuditModule, MailModule, AuthModule, UsersModule, WarehousesModule, RolesModule, InvoicesModule, PaymentsModule,
      ],
    })
      .overrideProvider(RedisService)
      .useValue({ onModuleInit: jest.fn(), getClient: jest.fn().mockReturnValue({}) })
      .overrideProvider(STRIPE_CLIENT)
      .useValue(fake)
      .overrideProvider(MAIL_TRANSPORT)
      .useValue({ send: async (m: OutboundMessage) => { sentMail.push(m); return { messageId: `m${sentMail.length}` }; } })
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    server = app.getHttpServer();
    ds = moduleRef.get(DataSource);
    await moduleRef.get(LedgerService).ensureDefaultChart();
    jest.spyOn(moduleRef.get(InvoicesService), 'generatePdf').mockResolvedValue(Buffer.from('%PDF-1.4 test'));

    await ds.query('CREATE TABLE IF NOT EXISTS invoice_number_counter (id INT PRIMARY KEY, next_value BIGINT)');
    await ds.getRepository(Warehouse).save({ id: WH, name: 'Calgary', code: 'CGY', active: true } as any);
    await ds.getRepository(Customer).save({ id: CUSTOMER, name: 'Acme Metals Ltd', email: 'ap@acme.example', division: 'recycling', warehouseId: WH } as any);

    const keys = ['warehouses:global_access', 'invoices:manage', 'payments:manage', 'payments:read_all', 'payments:refund', 'payments:sync', 'accounting:read'];
    const perms = await ds.getRepository(Permission).save(keys.map((key, i) => ({ id: randomUUID(), key, description: key })));
    const admin = await ds.getRepository(Role).save({ id: randomUUID(), name: 'admin' });
    const manager = await ds.getRepository(Role).save({ id: randomUUID(), name: 'manager' });
    await ds.getRepository(Role).save({ id: randomUUID(), name: 'staff' });
    await ds.getRepository(RolePermission).save([
      ...perms.map((p) => ({ roleId: admin.id, permissionId: p.id })),
      ...perms.filter((p) => ['invoices:manage', 'payments:manage', 'payments:read_all'].includes(p.key)).map((p) => ({ roleId: manager.id, permissionId: p.id })),
    ]);

    const password = await bcrypt.hash('TestPass123!', 10);
    const users = await ds.getRepository(User).save([
      { fullName: 'Admin', email: 'admin@gw.test', password, role: 'admin', status: 'active' },
      { fullName: 'Manager', email: 'manager@gw.test', password, role: 'manager', status: 'active' },
      { fullName: 'Staff', email: 'staff@gw.test', password, role: 'staff', status: 'active' },
    ] as any);
    await ds.getRepository(UserWarehouse).save(users.slice(1).map((u: any, i: number) => ({ id: randomUUID(), userId: u.id, warehouseId: WH })) as any);
    await grantDivisions(ds, users.map((u: any) => u.id), ['greenwave']);

    const login = async (email: string) => (await request(server).post('/auth/login').send({ email, password: 'TestPass123!' })).body.access_token;
    adminToken = await login('admin@gw.test');
    managerToken = await login('manager@gw.test');
    staffToken = await login('staff@gw.test');
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  let invoiceId: string;
  let payUrl: string;
  let paymentId: string;
  let intentId: string;

  describe('payment links', () => {
    it('rejects unauthenticated, unauthorized, malformed and missing', async () => {
      invoiceId = await seedInvoice('INV-0125', '4619.05', '230.95', '4850.00');
      await request(server).post(`/payments/invoices/${invoiceId}/link`).expect(401);
      await request(server).post(`/payments/invoices/${invoiceId}/link`).set('Authorization', `Bearer ${staffToken}`).expect(403);
      await request(server).post('/payments/invoices/not-a-uuid/link').set('Authorization', `Bearer ${managerToken}`).expect(400);
      await request(server).post(`/payments/invoices/${randomUUID()}/link`).set('Authorization', `Bearer ${managerToken}`).expect(404);
    });

    it('issues the invoice, posts AR once, and returns an opaque stable link', async () => {
      const res = await request(server).post(`/payments/invoices/${invoiceId}/link`).set('Authorization', `Bearer ${managerToken}`).expect(201);
      payUrl = res.body.paymentUrl;
      const token = tokenFromUrl(payUrl);
      expect(payUrl.startsWith('https://pay.gwgcservers.ca/p/')).toBe(true);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      for (const leak of [invoiceId, invoiceId.replace(/-/g, ''), 'INV-0125', '0125', '485000', '4850', CUSTOMER]) expect(token).not.toContain(leak);

      const again = await request(server).post(`/payments/invoices/${invoiceId}/link`).set('Authorization', `Bearer ${managerToken}`).expect(201);
      expect(again.body.paymentUrl).toBe(payUrl);
      expect(again.body.created).toBe(false);

      const inv = await ds.getRepository(Invoice).findOneByOrFail({ id: invoiceId });
      expect(inv.status).toBe('final');
      expect(inv.paymentToken).toBeNull();
      expect(inv.paymentTokenHash).toHaveLength(64);
      expect(inv.paymentTokenHash).not.toContain(token);

      const issued = await ds.getRepository(JournalEntry).find({ where: { sourceType: 'invoice', sourceId: invoiceId } });
      expect(issued).toHaveLength(1);
      expect(await accountBalance('AR')).toBe(485000);
      expect(await accountBalance('REVENUE_SALES')).toBe(-461905);
      expect(await accountBalance('SALES_TAX_PAYABLE')).toBe(-23095);
      await ledgerBalanced();
    });
  });

  describe('public payment page', () => {
    it('shows only the minimum invoice data', async () => {
      const res = await request(server).get(`/public/pay/${tokenFromUrl(payUrl)}`).expect(200);
      expect(res.body).toMatchObject({
        invoiceNumber: 'INV-0125', customerName: 'Acme Metals Ltd', currency: 'CAD', amountDueMinor: 485000,
        amountDue: '4850.00', state: 'payable', onlinePaymentsAvailable: true, publishableKey: 'pk_test_greenwave_e2e',
      });
      const body = JSON.stringify(res.body);
      for (const leak of [invoiceId, CUSTOMER, WH, 'Private Road', 'internal note', 'Copper scrap', 'whsec_', 'sk_']) expect(body).not.toContain(leak);
      expect(res.headers['x-robots-tag']).toContain('noindex');
    });

    it('returns an identical 404 for malformed and unknown tokens', async () => {
      const a = await request(server).get('/public/pay/short').expect(404);
      const b = await request(server).get(`/public/pay/${'A'.repeat(43)}`).expect(404);
      expect(a.body.message).toBe(b.body.message);
    });

    it('creates a PaymentIntent for exactly the server-side amount, ignoring client input', async () => {
      const res = await request(server).post(`/public/pay/${tokenFromUrl(payUrl)}/intent`).send({ amount: 100, currency: 'usd' }).expect(200);
      expect(res.body.state).toBe('ready');
      expect(res.body.amountMinor).toBe(485000);
      expect(res.body.clientSecret).toMatch(/_secret_/);
      paymentId = res.body.paymentReference;
      const call = fake.paymentIntents.create.mock.calls[0];
      expect(call[0]).toMatchObject({ amount: 485000, currency: 'cad', automatic_payment_methods: { enabled: true } });
      expect(call[0].metadata).toMatchObject({ greenwave_payment_id: paymentId, greenwave_invoice_id: invoiceId });
      expect(call[1]).toEqual({ idempotencyKey: `gw-pi-${paymentId}` });
      intentId = [...intents.keys()][0];
    });

    it('resumes the same intent instead of creating a second one', async () => {
      const res = await request(server).post(`/public/pay/${tokenFromUrl(payUrl)}/intent`).expect(200);
      expect(res.body.clientSecret).toBe(`${intentId}_secret_abc`);
      expect(fake.paymentIntents.create).toHaveBeenCalledTimes(1);
      expect(await ds.getRepository(Payment).count({ where: { invoiceId } })).toBe(1);
    });
  });

  describe('webhooks', () => {
    it('rejects missing, forged and wrong-secret signatures before any processing', async () => {
      const evt = event('payment_intent.succeeded', intents.get(intentId));
      await request(server).post('/webhooks/stripe').set('Content-Type', 'application/json').send(JSON.stringify(evt)).expect(400);
      await request(server).post('/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', `t=${now()},v1=${'0'.repeat(64)}`).send(JSON.stringify(evt)).expect(400);
      await deliver(evt, 'whsec_attacker_secret').expect(400);
      // Body tampered after signing.
      const payload = JSON.stringify(evt);
      const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
      await request(server).post('/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', header).send(payload.replace('485000', '100')).expect(400);
      expect(await ds.getRepository(ProviderEvent).count()).toBe(0);
      expect((await ds.getRepository(Invoice).findOneByOrFail({ id: invoiceId })).paymentStatus).toBe('unpaid');
    });

    it('records and ignores unsubscribed event types', async () => {
      const res = await deliver(event('customer.created', { id: 'cus_1', object: 'customer' })).expect(200);
      expect(res.body.status).toBe('IGNORED');
    });

    it('applies processing', async () => {
      intents.get(intentId).status = 'processing';
      await deliver(event('payment_intent.processing', intents.get(intentId), now() - 5)).expect(200);
      expect((await ds.getRepository(Payment).findOneByOrFail({ id: paymentId })).status).toBe('PROCESSING');
      expect((await ds.getRepository(Invoice).findOneByOrFail({ id: invoiceId })).paymentStatus).toBe('processing');
    });

    let succeededEvent: any;
    it('settles on verified success: invoice PAID, payment SUCCEEDED, ledger + fee, emails', async () => {
      succeededEvent = event('payment_intent.succeeded', succeedIntent(intentId));
      const res = await deliver(succeededEvent).expect(200);
      expect(res.body.status).toBe('PROCESSED');

      const inv = await ds.getRepository(Invoice).findOneByOrFail({ id: invoiceId });
      expect(inv).toMatchObject({ status: 'paid', paymentStatus: 'paid', paymentReference: paymentId, paymentProvider: 'stripe' });
      const p = await ds.getRepository(Payment).findOneByOrFail({ id: paymentId });
      expect(p).toMatchObject({ status: 'SUCCEEDED', amountMinor: 485000, feeMinor: 330, netMinor: 484670, paymentMethodDisplay: 'Visa •••• 4242', providerChargeId: `ch_for_${intentId}` });

      expect(await accountBalance('AR')).toBe(0);
      expect(await accountBalance('STRIPE_CLEARING')).toBe(484670);
      expect(await accountBalance('MERCHANT_FEES')).toBe(330);
      await ledgerBalanced();

      expect(sentMail.map((m) => m.to).sort()).toEqual(['ap@acme.example', 'sales@greenwaverecycling.ca']);
      expect(sentMail.every((m) => m.from.includes('sales@greenwaverecycling.ca'))).toBe(true);
      expect(sentMail.map((m) => m.subject).join('|')).toContain('INV-0125');
    });

    it('is idempotent for duplicate delivery: no second posting or email', async () => {
      const entries = await ds.getRepository(JournalEntry).count();
      const res = await deliver(succeededEvent).expect(200);
      expect(res.body.duplicate).toBe(true);
      expect(await ds.getRepository(JournalEntry).count()).toBe(entries);
      expect(sentMail).toHaveLength(2);
      expect(await ds.getRepository(ProviderEvent).count({ where: { providerEventId: succeededEvent.id } })).toBe(1);
    });

    it('is idempotent across different event ids for the same success', async () => {
      const entries = await ds.getRepository(JournalEntry).count();
      const res = await deliver(event('payment_intent.succeeded', intents.get(intentId))).expect(200);
      expect(res.body.status).toBe('IGNORED');
      expect(await ds.getRepository(JournalEntry).count()).toBe(entries);
      expect(sentMail).toHaveLength(2);
    });

    it('never regresses a settled payment on late failure/cancel events', async () => {
      await deliver(event('payment_intent.payment_failed', { ...intents.get(intentId), status: 'requires_payment_method' }, now() - 60)).expect(200);
      await deliver(event('payment_intent.canceled', { ...intents.get(intentId), status: 'canceled' })).expect(200);
      expect((await ds.getRepository(Payment).findOneByOrFail({ id: paymentId })).status).toBe('SUCCEEDED');
      expect((await ds.getRepository(Invoice).findOneByOrFail({ id: invoiceId })).paymentStatus).toBe('paid');
    });

    it('refuses a new payment attempt on a paid invoice', async () => {
      const res = await request(server).post(`/public/pay/${tokenFromUrl(payUrl)}/intent`).expect(200);
      expect(res.body.state).toBe('paid');
      expect(fake.paymentIntents.create).toHaveBeenCalledTimes(1);
      expect((await request(server).get(`/public/pay/${tokenFromUrl(payUrl)}`)).body).toMatchObject({ state: 'paid', amountDueMinor: 0, publishableKey: null });
    });
  });

  describe('invoice integrity once money exists', () => {
    it('ignores client paymentStatus and refuses client-set paid / amount changes', async () => {
      const other = await seedInvoice('INV-0126', '100.00', '5.00', '105.00', 'final');
      const r1 = await request(server).patch(`/invoices/${other}`).set('Authorization', `Bearer ${managerToken}`).send({ paymentStatus: 'paid' }).expect(200);
      expect((await ds.getRepository(Invoice).findOneByOrFail({ id: other })).paymentStatus).toBe('unpaid');
      await request(server).patch(`/invoices/${other}`).set('Authorization', `Bearer ${managerToken}`).send({ status: 'paid' }).expect(400);
      await request(server).patch(`/invoices/${invoiceId}`).set('Authorization', `Bearer ${managerToken}`).send({ status: 'void' }).expect(409);
      await request(server).patch(`/invoices/${invoiceId}`).set('Authorization', `Bearer ${managerToken}`).send({ taxRate: 13 }).expect(409);
      expect(r1.body).toBeDefined();
    });
  });

  describe('refunds', () => {
    let refundId: string;
    it('enforces admin permission, idempotency key, and eligible amount', async () => {
      await request(server).post(`/payments/${paymentId}/refunds`).send({}).expect(401);
      await request(server).post(`/payments/${paymentId}/refunds`).set('Authorization', `Bearer ${managerToken}`).set('Idempotency-Key', 'mgr-key-123456').send({}).expect(403);
      await request(server).post(`/payments/${paymentId}/refunds`).set('Authorization', `Bearer ${adminToken}`).send({}).expect(400);
      await request(server).post(`/payments/${paymentId}/refunds`).set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', 'too-much-123456').send({ amountMinor: 485001 }).expect(400);
      await request(server).post(`/payments/${paymentId}/refunds`).set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', 'bad-amount-1234').send({ amountMinor: -5 }).expect(400);
      expect(fake.refunds.create).not.toHaveBeenCalled();
    });

    it('submits a partial refund to Stripe exactly once per idempotency key', async () => {
      const first = await request(server).post(`/payments/${paymentId}/refunds`).set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', 'refund-key-000001').send({ amountMinor: 50000, reason: 'requested_by_customer' }).expect(201);
      const second = await request(server).post(`/payments/${paymentId}/refunds`).set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', 'refund-key-000001').send({ amountMinor: 50000 }).expect(201);
      refundId = first.body.refund.id;
      expect(first.body.refund.status).toBe('PENDING');
      expect(second.body.duplicate).toBe(true);
      expect(second.body.refund.id).toBe(refundId);
      expect(fake.refunds.create).toHaveBeenCalledTimes(1);
      expect(fake.refunds.create.mock.calls[0][0]).toMatchObject({ payment_intent: intentId, amount: 50000, metadata: { greenwave_refund_id: refundId } });
      expect(fake.refunds.create.mock.calls[0][1]).toEqual({ idempotencyKey: `gw-refund-${refundId}` });
      // The API response is not final truth: nothing refunded yet.
      expect((await ds.getRepository(Payment).findOneByOrFail({ id: paymentId })).refundedMinor).toBe(0);
      // Pending refund reduces what may still be requested.
      await request(server).post(`/payments/${paymentId}/refunds`).set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', 'refund-key-000002').send({ amountMinor: 435001 }).expect(400);
    });

    it('applies the refund from the webhook: payment, invoice, contra-revenue, once', async () => {
      const r = await ds.getRepository(PaymentRefund).findOneByOrFail({ id: refundId });
      const succeeded = event('refund.updated', { id: r.providerRefundId, object: 'refund', amount: 50000, currency: 'cad', status: 'succeeded', payment_intent: intentId, metadata: { greenwave_refund_id: refundId } });
      await deliver(succeeded).expect(200);
      await deliver(succeeded).expect(200);
      await deliver(event('refund.updated', { id: r.providerRefundId, object: 'refund', amount: 50000, currency: 'cad', status: 'pending', payment_intent: intentId, metadata: {} }, now() - 100)).expect(200);

      const p = await ds.getRepository(Payment).findOneByOrFail({ id: paymentId });
      expect(p).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedMinor: 50000 });
      expect((await ds.getRepository(PaymentRefund).findOneByOrFail({ id: refundId })).status).toBe('SUCCEEDED');
      expect((await ds.getRepository(Invoice).findOneByOrFail({ id: invoiceId })).paymentStatus).toBe('partially_refunded');
      expect(await ds.getRepository(JournalEntry).count({ where: { sourceType: 'refund', sourceId: refundId } })).toBe(1);
      expect(await accountBalance('SALES_REFUNDS')).toBe(50000);
      expect(await accountBalance('STRIPE_CLEARING')).toBe(434670);
      await ledgerBalanced();
    });

    it('records a refund made in the Stripe Dashboard', async () => {
      await deliver(event('refund.created', { id: 're_dashboard_1', object: 'refund', amount: 10000, currency: 'cad', status: 'succeeded', payment_intent: intentId, metadata: {} })).expect(200);
      const p = await ds.getRepository(Payment).findOneByOrFail({ id: paymentId });
      expect(p.refundedMinor).toBe(60000);
      expect(await ds.getRepository(PaymentRefund).count({ where: { paymentId } })).toBe(2);
    });
  });

  describe('verification failures and payouts', () => {
    it('captured amount mismatch is recorded but the invoice is NOT marked paid', async () => {
      const id = await seedInvoice('INV-0127', '200.00', '10.00', '210.00', 'final');
      const link = await request(server).post(`/payments/invoices/${id}/link`).set('Authorization', `Bearer ${managerToken}`).expect(201);
      const intent = await request(server).post(`/public/pay/${tokenFromUrl(link.body.paymentUrl)}/intent`).expect(200);
      const pi = [...intents.values()].find((x) => x.metadata.greenwave_invoice_id === id);
      succeedIntent(pi.id, { amountReceived: 100 });
      await deliver(event('payment_intent.succeeded', pi)).expect(200);

      const p = await ds.getRepository(Payment).findOneByOrFail({ id: intent.body.paymentReference });
      expect(p.status).toBe('SUCCEEDED');
      expect(p.metadata?.reviewRequired).toBe(true);
      expect((await ds.getRepository(Invoice).findOneByOrFail({ id })).paymentStatus).not.toBe('paid');
      expect(sentMail.some((m) => m.subject.includes('REVIEW REQUIRED'))).toBe(true);
      expect(sentMail.some((m) => m.to === 'ap@acme.example' && m.subject.includes('INV-0127'))).toBe(false);
      await ledgerBalanced();
    });

    it('posts a payout once and reverses it on failure; a stale paid event cannot repost', async () => {
      const po = { id: 'po_test_1', object: 'payout', amount: 400000, currency: 'cad', status: 'paid', arrival_date: now(), created: now() - 50, method: 'standard', failure_code: null };
      await deliver(event('payout.paid', po, now() - 10)).expect(200);
      await deliver(event('payout.paid', po, now() - 10)).expect(200);
      expect(await accountBalance('BANK_OPERATING')).toBe(400000);

      await deliver(event('payout.failed', { ...po, status: 'failed', failure_code: 'account_closed' }, now())).expect(200);
      expect(await accountBalance('BANK_OPERATING')).toBe(0);
      await deliver(event('payout.updated', po, now() - 5)).expect(200);
      expect(await accountBalance('BANK_OPERATING')).toBe(0);
      await ledgerBalanced();
    });
  });

  describe('manager payments views', () => {
    it('lists with search, filter, pagination; enforces auth', async () => {
      await request(server).get('/payments').expect(401);
      await request(server).get('/payments').set('Authorization', `Bearer ${staffToken}`).expect(403);
      await request(server).get('/payments?pageSize=500').set('Authorization', `Bearer ${managerToken}`).expect(400);
      await request(server).get('/payments?status=HACKED').set('Authorization', `Bearer ${managerToken}`).expect(400);

      const all = await request(server).get('/payments').set('Authorization', `Bearer ${managerToken}`).expect(200);
      expect(all.body.total).toBeGreaterThanOrEqual(2);
      const byNumber = await request(server).get('/payments?q=inv-0125').set('Authorization', `Bearer ${managerToken}`).expect(200);
      expect(byNumber.body.items).toHaveLength(1);
      expect(byNumber.body.items[0]).toMatchObject({ id: paymentId, invoiceNumber: 'INV-0125', customerName: 'Acme Metals Ltd', feeMinor: 330, status: 'PARTIALLY_REFUNDED' });
      const byStripeId = await request(server).get(`/payments?q=${intentId}`).set('Authorization', `Bearer ${managerToken}`).expect(200);
      expect(byStripeId.body.items[0].id).toBe(paymentId);
      const page = await request(server).get('/payments?pageSize=1&page=2').set('Authorization', `Bearer ${managerToken}`).expect(200);
      expect(page.body.items).toHaveLength(1);
    });

    it('shows payment detail with refunds, events and journal entries', async () => {
      await request(server).get(`/payments/${randomUUID()}`).set('Authorization', `Bearer ${managerToken}`).expect(404);
      const res = await request(server).get(`/payments/${paymentId}`).set('Authorization', `Bearer ${managerToken}`).expect(200);
      expect(res.body.payment.refundableMinor).toBe(425000);
      expect(res.body.refunds).toHaveLength(2);
      expect(res.body.providerEvents.length).toBeGreaterThan(0);
      expect(res.body.journalEntries.map((e: any) => e.sourceEvent)).toEqual(expect.arrayContaining(['invoice.issued', 'payment.succeeded', 'stripe.fee']));
      expect(JSON.stringify(res.body)).not.toMatch(/secret|whsec_|sk_(test|live)_/);
    });

    it('summarizes collected, fees, refunds from GreenWave data', async () => {
      const res = await request(server).get('/payments/summary?currency=CAD').set('Authorization', `Bearer ${managerToken}`).expect(200);
      expect(res.body).toMatchObject({ collectedMinor: 485100, refundedMinor: 60000 });
    });

    it('restricts Stripe sync to admins', async () => {
      await request(server).post('/payments/stripe/sync').set('Authorization', `Bearer ${managerToken}`).expect(403);
    });
  });
});
