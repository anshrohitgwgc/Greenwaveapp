import { gateDatabase } from './gate-database';
/* eslint-disable */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { ACCOUNTING_ENTITIES, AccountingModule } from '../src/accounting/accounting.module';
import { AuditModule } from '../src/audit/audit.module';
import { AuditEvent } from '../src/audit/entities/audit-event.entity';
import { AuthModule } from '../src/auth/auth.module';
import { LedgerService } from '../src/accounting/ledger.service';
import { Customer } from '../src/customers/entities/customer.entity';
import { CustomersModule } from '../src/customers/customers.module';
import { DivisionsModule } from '../src/divisions/divisions.module';
import { UserDivision } from '../src/divisions/entities/user-division.entity';
import { InvoiceItem } from '../src/invoices/entities/invoice-item.entity';
import { Invoice } from '../src/invoices/entities/invoice.entity';
import { InvoicesModule } from '../src/invoices/invoices.module';
import { InvoicesService } from '../src/invoices/invoices.service';
import { EmailOutbox } from '../src/mail/entities/email-outbox.entity';
import { MailModule } from '../src/mail/mail.module';
import { Payment } from '../src/payments/entities/payment.entity';
import { PAYMENT_ENTITIES, PaymentsModule } from '../src/payments/payments.module';
import { PurchaseOrderItem } from '../src/purchase-orders/entities/purchase-order-item.entity';
import { PurchaseOrder } from '../src/purchase-orders/entities/purchase-order.entity';
import { PurchaseOrdersModule } from '../src/purchase-orders/purchase-orders.module';
import { PurchaseOrdersService } from '../src/purchase-orders/purchase-orders.service';
import { RedisService } from '../src/redis/redis.service';
import { Permission } from '../src/roles/entities/permission.entity';
import { Role } from '../src/roles/entities/role.entity';
import { RolePermission } from '../src/roles/entities/role-permission.entity';
import { UserRole } from '../src/roles/entities/user-role.entity';
import { RolesModule } from '../src/roles/roles.module';
import { StripeService } from '../src/stripe/stripe.service';
import { User } from '../src/users/entities/user.entity';
import { UsersModule } from '../src/users/users.module';
import { UserWarehouse } from '../src/warehouses/entities/user-warehouse.entity';
import { Warehouse } from '../src/warehouses/entities/warehouse.entity';
import { WarehousesModule } from '../src/warehouses/warehouses.module';

/**
 * Invoices and Purchase Orders are GreenWave Recycling records.
 *
 * RecyclingFinanceGuard is the division boundary on both controllers, layered
 * on top of the existing role and warehouse checks. Every request here is
 * hand-made against the API — the UI hiding these screens in Healthcare is a
 * convenience, not the control being tested.
 */
describe('E2E Security: Invoice & Purchase Order APIs restricted to GreenWave Recycling', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let dataSource: DataSource;
  let invoicePdf: jest.SpyInstance;
  let poPdf: jest.SpyInstance;

  const WH_MR = '11111111-1111-4111-8111-111111111111';
  const WH_OTHER = '33333333-3333-4333-8333-333333333333';
  const PW = 'Password123!';

  const tokens: Record<string, string> = {};
  let invoiceId: string;
  let otherWhInvoiceId: string;
  let poId: string;

  const server = () => app.getHttpServer();

  /** Actor + optional X-Division header. `undefined` division = header omitted. */
  type Actor = { name: string; token: () => string; division?: string };
  const as = (req: request.Test, actor: Actor) => {
    req.set('Authorization', `Bearer ${actor.token()}`);
    if (actor.division !== undefined) req.set('X-Division', actor.division);
    return req;
  };

  const DENIED: Actor[] = [
    { name: 'Healthcare-only admin (no header)', token: () => tokens.hcAdmin },
    { name: 'Healthcare-only admin in Healthcare context', token: () => tokens.hcAdmin, division: 'healthcare' },
    { name: 'Healthcare-only admin spoofing X-Division: recycling', token: () => tokens.hcAdmin, division: 'recycling' },
    { name: 'Healthcare-only admin spoofing X-Division: greenwave', token: () => tokens.hcAdmin, division: 'greenwave' },
    { name: 'Healthcare-only manager spoofing X-Division: recycling', token: () => tokens.hcManager, division: 'recycling' },
    { name: 'dual-division admin in Healthcare context', token: () => tokens.dualAdmin, division: 'healthcare' },
    { name: 'dual-division admin with missing context', token: () => tokens.dualAdmin },
    { name: 'dual-division admin with empty context', token: () => tokens.dualAdmin, division: '' },
    { name: 'dual-division admin with invalid context', token: () => tokens.dualAdmin, division: 'finance' },
  ];

  const invoicePayload = () => ({
    invoiceDate: '2026-09-18',
    division: 'greenwave',
    warehouseId: WH_MR,
    taxRate: 5,
    items: [{ description: 'Division test line', quantity: 1, unitPrice: 100 }],
  });

  const poPayload = () => ({
    orderDate: '2026-09-18',
    currency: 'CAD',
    supplierName: 'Division Test Supplier',
    division: 'greenwave',
    warehouseId: WH_MR,
    items: [{ description: 'PE100 REPRO', quantity: 10, unit: 'lbs', unitPrice: 1 }],
  });

  /** Every Invoice route, plus the invoice-scoped payment actions. */
  const invoiceRoutes = (): Array<[string, () => request.Test]> => [
    ['GET /invoices (list)', () => request(server()).get('/api/invoices')],
    ['GET /invoices?division=greenwave (list, query filter)', () => request(server()).get('/api/invoices?division=greenwave')],
    ['GET /invoices/next-number', () => request(server()).get('/api/invoices/next-number')],
    ['GET /invoices/:id (direct UUID)', () => request(server()).get(`/api/invoices/${invoiceId}`)],
    ['POST /invoices (create)', () => request(server()).post('/api/invoices').send(invoicePayload())],
    ['PATCH /invoices/:id (update)', () => request(server()).patch(`/api/invoices/${invoiceId}`).send({ notes: 'hijacked' })],
    ['PATCH /invoices/:id (finalize)', () => request(server()).patch(`/api/invoices/${invoiceId}`).send({ status: 'final' })],
    ['POST /invoices/:id/duplicate', () => request(server()).post(`/api/invoices/${invoiceId}/duplicate`)],
    ['POST /invoices/render-pdf', () => request(server()).post('/api/invoices/render-pdf').send({ html: '<p>x</p>', invoiceNumber: '1' })],
    ['POST /payments/invoices/:id/link', () => request(server()).post(`/api/payments/invoices/${invoiceId}/link`).send({})],
    ['POST /payments/invoices/:id/send', () => request(server()).post(`/api/payments/invoices/${invoiceId}/send`).send({})],
  ];

  /** Every Purchase Order route. */
  const poRoutes = (): Array<[string, () => request.Test]> => [
    ['GET /purchase-orders (list)', () => request(server()).get('/api/purchase-orders')],
    ['GET /purchase-orders/next-number', () => request(server()).get('/api/purchase-orders/next-number')],
    ['GET /purchase-orders/:id (direct UUID)', () => request(server()).get(`/api/purchase-orders/${poId}`)],
    ['POST /purchase-orders (create)', () => request(server()).post('/api/purchase-orders').send(poPayload())],
    ['PATCH /purchase-orders/:id (update)', () => request(server()).patch(`/api/purchase-orders/${poId}`).send({ notes: 'hijacked' })],
    ['PATCH /purchase-orders/:id (status change)', () => request(server()).patch(`/api/purchase-orders/${poId}`).send({ status: 'issued' })],
    ['DELETE /purchase-orders/:id', () => request(server()).delete(`/api/purchase-orders/${poId}`)],
    ['POST /purchase-orders/render-pdf (document)', () => request(server()).post('/api/purchase-orders/render-pdf').send({ html: '<p>x</p>', poNumber: 'PO-1' })],
  ];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        TypeOrmModule.forRoot({
          ...gateDatabase('invoice_po_division'),
          entities: [
            ...PAYMENT_ENTITIES,
            ...ACCOUNTING_ENTITIES,
            EmailOutbox,
            User,
            AuditEvent,
            Warehouse,
            UserWarehouse,
            UserDivision,
            Customer,
            Invoice,
            InvoiceItem,
            PurchaseOrder,
            PurchaseOrderItem,
            Role,
            Permission,
            RolePermission,
            UserRole,
          ],
        }),
        AuthModule,
        UsersModule,
        WarehousesModule,
        DivisionsModule,
        RolesModule,
        CustomersModule,
        InvoicesModule,
        PurchaseOrdersModule,
        MailModule,
        AccountingModule,
        PaymentsModule,
        AuditModule,
      ],
    })
      .overrideProvider(RedisService)
      .useValue({
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
        publish: jest.fn(),
        subscribe: jest.fn(),
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
      })
      .overrideProvider(StripeService)
      .useValue({ isPaymentsConfigured: () => false, retrieveBalance: jest.fn() })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    dataSource = moduleRef.get(DataSource);

    // Chromium rendering is proven separately against a clean production-style
    // install; here only the authorization boundary is under test.
    invoicePdf = jest.spyOn(moduleRef.get(InvoicesService), 'generatePdf').mockResolvedValue(Buffer.from('%PDF-1.4 test'));
    poPdf = jest.spyOn(moduleRef.get(PurchaseOrdersService), 'generatePdf').mockResolvedValue(Buffer.from('%PDF-1.4 test'));

    // Non-PostgreSQL numbering fallbacks (see the services' allocate helpers).
    await dataSource.query(`CREATE TABLE IF NOT EXISTS invoice_number_counter (id INT PRIMARY KEY, next_value BIGINT)`);
    await dataSource.query(`CREATE TABLE IF NOT EXISTS purchase_order_number_counter (id INT PRIMARY KEY, next_value BIGINT)`);

    await dataSource.getRepository(Warehouse).save([
      { id: WH_MR, name: 'Maple Ridge, BC', code: 'MR', active: true },
      { id: WH_OTHER, name: 'Other Recycling Yard', code: 'OT', active: true },
    ]);

    const hash = await bcrypt.hash(PW, 8);
    const users: Array<[number, string, string, string[], string[]]> = [
      [1, 'gw-admin@test.local', 'admin', ['greenwave'], []],
      [2, 'gw-mgr@test.local', 'manager', ['greenwave'], [WH_MR]],
      [3, 'gw-staff@test.local', 'staff', ['greenwave'], [WH_MR]],
      [4, 'hc-admin@test.local', 'admin', ['healthcare'], []],
      [5, 'hc-mgr@test.local', 'manager', ['healthcare'], [WH_MR]],
      [6, 'dual-admin@test.local', 'admin', ['greenwave', 'healthcare'], []],
    ];
    for (const [id, email, role, divisions, warehouses] of users) {
      await dataSource.getRepository(User).save({ id, email, fullName: email, password: hash, role, status: 'active' });
      for (const division of divisions) await dataSource.getRepository(UserDivision).save({ userId: id, division });
      for (const warehouseId of warehouses) await dataSource.getRepository(UserWarehouse).save({ userId: id, warehouseId });
    }

    const login = async (email: string) => {
      const res = await request(server()).post('/api/auth/login').send({ email, password: PW });
      if (!res.body?.access_token) throw new Error(`login failed for ${email}: ${res.status}`);
      return res.body.access_token as string;
    };
    tokens.gwAdmin = await login('gw-admin@test.local');
    tokens.gwManager = await login('gw-mgr@test.local');
    tokens.gwStaff = await login('gw-staff@test.local');
    tokens.hcAdmin = await login('hc-admin@test.local');
    tokens.hcManager = await login('hc-mgr@test.local');
    tokens.dualAdmin = await login('dual-admin@test.local');

    // Recycling fixtures created through the API by an authorized Recycling admin.
    const inv = await as(request(server()).post('/api/invoices').send(invoicePayload()), { name: 'gw', token: () => tokens.gwAdmin }).expect(201);
    invoiceId = inv.body.id;
    const other = await as(
      request(server()).post('/api/invoices').send({ ...invoicePayload(), warehouseId: WH_OTHER }),
      { name: 'gw', token: () => tokens.gwAdmin },
    ).expect(201);
    otherWhInvoiceId = other.body.id;
    const po = await as(request(server()).post('/api/purchase-orders').send(poPayload()), { name: 'gw', token: () => tokens.gwAdmin }).expect(201);
    poId = po.body.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  const snapshot = async () => ({
    invoices: await dataSource.getRepository(Invoice).count(),
    pos: await dataSource.getRepository(PurchaseOrder).count(),
    invoice: await dataSource.getRepository(Invoice).findOneBy({ id: invoiceId }),
    po: await dataSource.getRepository(PurchaseOrder).findOneBy({ id: poId }),
  });

  // ==========================================================================
  describe('Invoice: every route is refused outside an authorized Recycling context', () => {
    for (const actor of DENIED) {
      it(`${actor.name} → 403 on every Invoice route, nothing changes`, async () => {
        const before = await snapshot();
        invoicePdf.mockClear();
        for (const [label, make] of invoiceRoutes()) {
          const res = await as(make(), actor);
          if (res.status !== 403) throw new Error(`${label}: expected 403, got ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
        }
        expect(invoicePdf).not.toHaveBeenCalled();
        expect(await snapshot()).toEqual(before);
      });
    }
  });

  describe('Purchase Order: every route is refused outside an authorized Recycling context', () => {
    for (const actor of DENIED) {
      it(`${actor.name} → 403 on every PO route, nothing changes`, async () => {
        const before = await snapshot();
        poPdf.mockClear();
        for (const [label, make] of poRoutes()) {
          const res = await as(make(), actor);
          if (res.status !== 403) throw new Error(`${label}: expected 403, got ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
        }
        expect(poPdf).not.toHaveBeenCalled();
        expect(await snapshot()).toEqual(before);
      });
    }
  });

  // ==========================================================================
  describe('IDOR: a known Recycling UUID does not help from Healthcare context', () => {
    const hcDual: Actor = { name: 'dual/healthcare', token: () => tokens.dualAdmin, division: 'healthcare' };

    it('dual admin in Healthcare context cannot read the Recycling invoice or PO by UUID', async () => {
      const inv = await as(request(server()).get(`/api/invoices/${invoiceId}`), hcDual).expect(403);
      expect(JSON.stringify(inv.body)).not.toContain(invoiceId);
      const po = await as(request(server()).get(`/api/purchase-orders/${poId}`), hcDual).expect(403);
      expect(JSON.stringify(po.body)).not.toContain(poId);
    });

    it('a denial is the same for real and unknown UUIDs (no existence oracle)', async () => {
      const ghost = '00000000-0000-4000-8000-000000000000';
      await as(request(server()).get(`/api/invoices/${ghost}`), hcDual).expect(403);
      await as(request(server()).get(`/api/purchase-orders/${ghost}`), hcDual).expect(403);
    });

    it('the same dual admin switched to Recycling reads both normally', async () => {
      const rc: Actor = { name: 'dual/recycling', token: () => tokens.dualAdmin, division: 'recycling' };
      expect((await as(request(server()).get(`/api/invoices/${invoiceId}`), rc).expect(200)).body.id).toBe(invoiceId);
      expect((await as(request(server()).get(`/api/purchase-orders/${poId}`), rc).expect(200)).body.id).toBe(poId);
    });
  });

  // ==========================================================================
  describe('Normal Recycling use is unchanged', () => {
    const allowed: Actor[] = [
      { name: 'Recycling-only admin (no header)', token: () => tokens.gwAdmin },
      { name: 'Recycling-only admin + X-Division: recycling', token: () => tokens.gwAdmin, division: 'recycling' },
      { name: 'dual-division admin + X-Division: recycling', token: () => tokens.dualAdmin, division: 'recycling' },
      { name: 'dual-division admin + X-Division: greenwave', token: () => tokens.dualAdmin, division: 'greenwave' },
    ];

    for (const actor of allowed) {
      it(`${actor.name}: invoice list/detail/create/update/duplicate/PDF succeed`, async () => {
        await as(request(server()).get('/api/invoices'), actor).expect(200);
        await as(request(server()).get('/api/invoices/next-number'), actor).expect(200);
        await as(request(server()).get(`/api/invoices/${invoiceId}`), actor).expect(200);
        const created = await as(request(server()).post('/api/invoices').send(invoicePayload()), actor).expect(201);
        await as(request(server()).patch(`/api/invoices/${created.body.id}`).send({ notes: 'ok' }), actor).expect(200);
        await as(request(server()).post(`/api/invoices/${created.body.id}/duplicate`), actor).expect(201);
        const pdf = await as(request(server()).post('/api/invoices/render-pdf').send({ html: '<p>x</p>' }), actor).expect(201);
        expect(pdf.headers['content-type']).toMatch(/pdf/);
      });

      it(`${actor.name}: PO list/detail/create/update/status/delete/PDF succeed`, async () => {
        await as(request(server()).get('/api/purchase-orders'), actor).expect(200);
        await as(request(server()).get('/api/purchase-orders/next-number'), actor).expect(200);
        await as(request(server()).get(`/api/purchase-orders/${poId}`), actor).expect(200);
        const created = await as(request(server()).post('/api/purchase-orders').send(poPayload()), actor).expect(201);
        await as(request(server()).patch(`/api/purchase-orders/${created.body.id}`).send({ notes: 'ok' }), actor).expect(200);
        await as(request(server()).patch(`/api/purchase-orders/${created.body.id}`).send({ status: 'issued' }), actor).expect(200);
        await as(request(server()).delete(`/api/purchase-orders/${created.body.id}`), actor).expect((r) => {
          if (![200, 204].includes(r.status)) throw new Error(`delete: ${r.status}`);
        });
        const pdf = await as(request(server()).post('/api/purchase-orders/render-pdf').send({ html: '<p>x</p>' }), actor).expect(201);
        expect(pdf.headers['content-type']).toMatch(/pdf/);
      });
    }

    it('Recycling manager keeps invoice access within their warehouse', async () => {
      const mgr: Actor = { name: 'gw manager', token: () => tokens.gwManager };
      await as(request(server()).get('/api/invoices'), mgr).expect(200);
      await as(request(server()).get(`/api/invoices/${invoiceId}`), mgr).expect(200);
      await as(request(server()).post('/api/invoices').send(invoicePayload()), mgr).expect(201);
    });
  });

  // ==========================================================================
  describe('Invoice duplicate keeps the source division and copies no payment state', () => {
    let sourceId: string;
    let sourceNumber: string;
    const journalCount = async (sourceId?: string) =>
      Number(
        (
          await dataSource.query(
            sourceId
              ? `SELECT COUNT(*) AS n FROM journal_entries WHERE source_id = ?`
              : `SELECT COUNT(*) AS n FROM journal_entries`,
            sourceId ? [sourceId] : [],
          )
        )[0].n,
      );
    const dup = (actor: Actor, id = sourceId) => as(request(server()).post(`/api/invoices/${id}/duplicate`), actor);
    const dual = (division?: string): Actor => ({ name: `dual/${division}`, token: () => tokens.dualAdmin, division });

    beforeAll(async () => {
      // A finalized, paid Recycling invoice carrying payment-link and Stripe state.
      const created = await as(request(server()).post('/api/invoices').send(invoicePayload()), { name: 'gw', token: () => tokens.gwAdmin }).expect(201);
      sourceId = created.body.id;
      await app.get(LedgerService).ensureDefaultChart();
      await as(request(server()).patch(`/api/invoices/${sourceId}`).send({ status: 'final' }), { name: 'gw', token: () => tokens.gwAdmin }).expect(200);
      // Issuance posted once for the source (DR AR / CR Revenue / CR Sales Tax).
      expect(await journalCount(sourceId)).toBe(1);
      sourceNumber = String(created.body.invoiceNumber);
      await dataSource.getRepository(Invoice).update(sourceId, {
        paymentStatus: 'paid',
        paidAt: new Date('2026-09-18T12:00:00Z'),
        paymentLinkNonce: 'nonce-must-not-be-copied',
        paymentLinkCreatedAt: new Date('2026-09-18T11:00:00Z'),
      });
      await dataSource.getRepository(Payment).save({
        id: '99999999-9999-4999-8999-999999999999',
        invoiceId: sourceId,
        provider: 'stripe',
        providerPaymentId: 'pi_must_not_be_copied',
        status: 'SUCCEEDED',
        currency: 'CAD',
        amount: '105.00',
        amountMinor: 10500,
        warehouseId: WH_MR,
        paidAt: new Date('2026-09-18T12:00:00Z'),
        createdBy: 1,
      });
    });

    it('regression: dual-division admin in Recycling context duplicates (was 400 "division is required")', async () => {
      const res = await dup(dual('recycling')).expect(201);
      expect(res.body.division).toBe('recycling');
    });

    it.each([
      ['Recycling-only admin (no header)', (): Actor => ({ name: 'gw', token: () => tokens.gwAdmin })],
      ['dual-division admin + X-Division: recycling', () => dual('recycling')],
      ['dual-division admin + X-Division: greenwave', () => dual('greenwave')],
    ])('%s → 201, same division, fresh draft with no payment/accounting state', async (_n, actor) => {
      const journalsBefore = await journalCount();
      const res = await dup(actor()).expect(201);
      const copy = await dataSource.getRepository(Invoice).findOne({ where: { id: res.body.id }, relations: ['items'] });
      const source = await dataSource.getRepository(Invoice).findOne({ where: { id: sourceId }, relations: ['items'] });

      expect(copy!.id).not.toBe(sourceId);
      expect(String(copy!.invoiceNumber)).not.toBe(sourceNumber);
      expect(copy!.division).toBe(source!.division);
      expect(copy!.warehouseId).toBe(source!.warehouseId);
      expect(copy!.status).toBe('draft');
      expect(copy!.paymentStatus).toBe('unpaid');
      expect(copy!.paidAt).toBeNull();
      expect(copy!.paymentLinkNonce).toBeNull();
      expect(copy!.paymentLinkCreatedAt).toBeNull();
      expect(Number(copy!.total)).toBe(Number(source!.total));
      expect(copy!.items.map((i) => i.description)).toEqual(source!.items.map((i) => i.description));
      expect(await dataSource.getRepository(Payment).count({ where: { invoiceId: copy!.id } })).toBe(0);
      // A draft posts nothing: no journal entry for the copy, no change overall.
      expect(await journalCount(copy!.id)).toBe(0);
      expect(await journalCount()).toBe(journalsBefore);
    });

    it('a request body cannot move the copy to another division', async () => {
      // Duplicate declares no body: the division comes only from the stored source.
      const res = await dup(dual('recycling')).send({ division: 'healthcare' });
      expect(res.status).toBe(201);
      expect(res.body.division).toBe('recycling');
    });

    it.each([
      ['dual-division admin + X-Division: healthcare', () => dual('healthcare')],
      ['dual-division admin with missing context', () => dual(undefined)],
      ['Healthcare-only admin spoofing X-Division: recycling', (): Actor => ({ name: 'hc', token: () => tokens.hcAdmin, division: 'recycling' })],
    ])('%s → 403, nothing created', async (_n, actor) => {
      const before = await dataSource.getRepository(Invoice).count();
      await dup(actor()).expect(403);
      expect(await dataSource.getRepository(Invoice).count()).toBe(before);
    });

    it('unauthorized warehouse keeps its existing 403', async () => {
      const before = await dataSource.getRepository(Invoice).count();
      await dup({ name: 'mgr', token: () => tokens.gwManager }, otherWhInvoiceId).expect(403);
      expect(await dataSource.getRepository(Invoice).count()).toBe(before);
    });

    it('unknown UUID keeps its existing 404', async () => {
      await dup({ name: 'gw', token: () => tokens.gwAdmin }, '00000000-0000-4000-8000-000000000000').expect(404);
    });
  });

  // ==========================================================================
  describe('Stored Healthcare invoices/POs are unreachable through the Recycling modules', () => {
    // The dual admin also belongs to Healthcare; membership must not make
    // Healthcare rows reachable from the Recycling-only invoice/PO subsystem.
    const rc: Actor = { name: 'dual/recycling', token: () => tokens.dualAdmin, division: 'recycling' };
    const gwAdmin: Actor = { name: 'gw', token: () => tokens.gwAdmin };
    let hcInvoiceId: string;
    let hcPoId: string;
    const count = async (table: string) => Number((await dataSource.query(`SELECT COUNT(*) AS n FROM ${table}`))[0].n);
    const sideEffects = async () => ({
      invoices: await count('invoices'),
      purchaseOrders: await count('purchase_orders'),
      journals: await count('journal_entries'),
      payments: await count('payments'),
      outbox: await count('email_outbox'),
      hcInvoice: await dataSource.getRepository(Invoice).findOneBy({ id: hcInvoiceId }),
      hcPo: await dataSource.getRepository(PurchaseOrder).findOneBy({ id: hcPoId }),
    });

    beforeAll(async () => {
      await app.get(LedgerService).ensureDefaultChart();
      // Created normally, then stored as Healthcare — a legacy/other-division row.
      hcInvoiceId = (await as(request(server()).post('/api/invoices').send(invoicePayload()), gwAdmin).expect(201)).body.id;
      await dataSource.getRepository(Invoice).update(hcInvoiceId, { division: 'healthcare' });
      hcPoId = (await as(request(server()).post('/api/purchase-orders').send(poPayload()), gwAdmin).expect(201)).body.id;
      await dataSource.getRepository(PurchaseOrder).update(hcPoId, { division: 'healthcare' });
    });

    const invoiceOps = (): Array<[string, () => request.Test]> => [
      ['detail', () => request(server()).get(`/api/invoices/${hcInvoiceId}`)],
      ['update', () => request(server()).patch(`/api/invoices/${hcInvoiceId}`).send({ notes: 'x' })],
      ['finalize', () => request(server()).patch(`/api/invoices/${hcInvoiceId}`).send({ status: 'final' })],
      ['duplicate', () => request(server()).post(`/api/invoices/${hcInvoiceId}/duplicate`)],
      ['payment link', () => request(server()).post(`/api/payments/invoices/${hcInvoiceId}/link`).send({})],
      ['payment link regenerate', () => request(server()).post(`/api/payments/invoices/${hcInvoiceId}/link/regenerate`).send({})],
      ['send/email', () => request(server()).post(`/api/payments/invoices/${hcInvoiceId}/send`).send({ recipientEmail: 'x@example.invalid', documentHtml: '<p>invoice</p>' })],
    ];
    const poOps = (): Array<[string, () => request.Test]> => [
      ['detail', () => request(server()).get(`/api/purchase-orders/${hcPoId}`)],
      ['update', () => request(server()).patch(`/api/purchase-orders/${hcPoId}`).send({ notes: 'x' })],
      ['status change', () => request(server()).patch(`/api/purchase-orders/${hcPoId}`).send({ status: 'issued' })],
      ['delete', () => request(server()).delete(`/api/purchase-orders/${hcPoId}`)],
    ];

    for (const actor of [rc, { name: 'dual/greenwave', token: () => tokens.dualAdmin, division: 'greenwave' }, gwAdmin] as Actor[]) {
      it(`${actor.name}: every Healthcare invoice operation → 403, zero side effects`, async () => {
        const before = await sideEffects();
        for (const [label, make] of invoiceOps()) {
          const res = await as(make(), actor);
          if (res.status !== 403) throw new Error(`invoice ${label}: expected 403, got ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
        }
        expect(await sideEffects()).toEqual(before);
      });

      it(`${actor.name}: every Healthcare PO operation → 403, zero side effects`, async () => {
        const before = await sideEffects();
        for (const [label, make] of poOps()) {
          const res = await as(make(), actor);
          if (res.status !== 403) throw new Error(`PO ${label}: expected 403, got ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
        }
        expect(await sideEffects()).toEqual(before);
      });
    }

    it('Healthcare rows never appear in the Recycling lists (with or without ?division=)', async () => {
      for (const q of ['', '?division=healthcare', '?division=recycling']) {
        const inv = await as(request(server()).get(`/api/invoices${q}`), rc).expect(200);
        expect(inv.body.map((i: any) => i.id)).not.toContain(hcInvoiceId);
        expect(inv.body.every((i: any) => i.division === 'recycling')).toBe(true);
        const po = await as(request(server()).get(`/api/purchase-orders${q}`), rc).expect(200);
        expect(po.body.map((p: any) => p.id)).not.toContain(hcPoId);
        expect(po.body.every((p: any) => p.division === 'recycling')).toBe(true);
      }
    });

    it('create cannot target Healthcare through the payload (no row, no number consumed)', async () => {
      const before = await sideEffects();
      const nextInv = (await as(request(server()).get('/api/invoices/next-number'), rc).expect(200)).body.nextNumber;
      const nextPo = (await as(request(server()).get('/api/purchase-orders/next-number'), rc).expect(200)).body.nextNumber;
      await as(request(server()).post('/api/invoices').send({ ...invoicePayload(), division: 'healthcare' }), rc).expect(403);
      await as(request(server()).post('/api/purchase-orders').send({ ...poPayload(), division: 'healthcare' }), rc).expect(403);
      expect(await sideEffects()).toEqual(before);
      expect((await as(request(server()).get('/api/invoices/next-number'), rc).expect(200)).body.nextNumber).toBe(nextInv);
      expect((await as(request(server()).get('/api/purchase-orders/next-number'), rc).expect(200)).body.nextNumber).toBe(nextPo);
    });

    it('update cannot move a Recycling invoice or PO into Healthcare', async () => {
      await as(request(server()).patch(`/api/invoices/${invoiceId}`).send({ division: 'healthcare' }), rc).expect(403);
      await as(request(server()).patch(`/api/purchase-orders/${poId}`).send({ division: 'healthcare' }), rc).expect(403);
      expect((await dataSource.getRepository(Invoice).findOneBy({ id: invoiceId }))!.division).toBe('recycling');
      expect((await dataSource.getRepository(PurchaseOrder).findOneBy({ id: poId }))!.division).toBe('recycling');
    });

    it('denial for a Healthcare UUID follows the finance convention: 403 (existing, out of scope) vs 404 (unknown)', async () => {
      const ghost = '00000000-0000-4000-8000-000000000000';
      await as(request(server()).get(`/api/invoices/${hcInvoiceId}`), rc).expect(403);
      await as(request(server()).get(`/api/invoices/${ghost}`), rc).expect(404);
      await as(request(server()).get(`/api/purchase-orders/${hcPoId}`), rc).expect(403);
      await as(request(server()).get(`/api/purchase-orders/${ghost}`), rc).expect(404);
    });

    it('Recycling records remain fully usable by the same dual admin', async () => {
      await as(request(server()).get(`/api/invoices/${invoiceId}`), rc).expect(200);
      const copy = await as(request(server()).post(`/api/invoices/${invoiceId}/duplicate`), rc).expect(201);
      expect(copy.body.division).toBe('recycling');
      await as(request(server()).get(`/api/purchase-orders/${poId}`), rc).expect(200);
    });
  });

  // ==========================================================================
  describe('Existing RBAC and warehouse restrictions still apply inside Recycling', () => {
    it('Recycling manager is still refused an invoice in a warehouse they are not assigned', async () => {
      await as(request(server()).get(`/api/invoices/${otherWhInvoiceId}`), { name: 'mgr', token: () => tokens.gwManager }).expect(403);
    });

    it('Recycling manager is still refused purchase orders (admin-only)', async () => {
      await as(request(server()).get('/api/purchase-orders'), { name: 'mgr', token: () => tokens.gwManager }).expect(403);
      await as(request(server()).get(`/api/purchase-orders/${poId}`), { name: 'mgr', token: () => tokens.gwManager }).expect(403);
    });

    it('Recycling staff are still refused invoices and purchase orders (role)', async () => {
      const staff: Actor = { name: 'staff', token: () => tokens.gwStaff };
      await as(request(server()).get('/api/invoices'), staff).expect(403);
      await as(request(server()).get(`/api/invoices/${invoiceId}`), staff).expect(403);
      await as(request(server()).get('/api/purchase-orders'), staff).expect(403);
    });

    it('unauthenticated requests are still 401', async () => {
      await request(server()).get('/api/invoices').expect(401);
      await request(server()).get('/api/purchase-orders').expect(401);
    });
  });
});
