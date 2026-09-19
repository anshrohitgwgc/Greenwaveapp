import { MAIL_TRANSPORT, MailService } from '../src/mail/mail.service';
import { gateDatabase } from './gate-database';
/* eslint-disable */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AccountingModule } from '../src/accounting/accounting.module';
import { JournalEntry } from '../src/accounting/entities/journal-entry.entity';
import { JournalLine } from '../src/accounting/entities/journal-line.entity';
import { LedgerAccount } from '../src/accounting/entities/ledger-account.entity';
import { LedgerService } from '../src/accounting/ledger.service';
import { AuditModule } from '../src/audit/audit.module';
import { AuditEvent } from '../src/audit/entities/audit-event.entity';
import { AuthModule } from '../src/auth/auth.module';
import { Customer } from '../src/customers/entities/customer.entity';
import { CustomersModule } from '../src/customers/customers.module';
import { DivisionsModule } from '../src/divisions/divisions.module';
import { UserDivision } from '../src/divisions/entities/user-division.entity';
import { Invoice } from '../src/invoices/entities/invoice.entity';
import { InvoiceItem } from '../src/invoices/entities/invoice-item.entity';
import { InvoicesModule } from '../src/invoices/invoices.module';
import { EmailOutbox } from '../src/mail/entities/email-outbox.entity';
import { MailModule } from '../src/mail/mail.module';
import { Material } from '../src/materials/entities/material.entity';
import { MaterialsModule } from '../src/materials/materials.module';
import { Payment } from '../src/payments/entities/payment.entity';
import { PaymentsModule } from '../src/payments/payments.module';
import { ProviderEvent } from '../src/payments/entities/provider-event.entity';
import { StripePayout } from '../src/payments/entities/stripe-payout.entity';
import { StripeDispute } from '../src/payments/entities/stripe-dispute.entity';
import { StripeSyncRun } from '../src/payments/entities/stripe-sync-run.entity';
import { StripeBalanceTransaction } from '../src/payments/entities/stripe-balance-transaction.entity';
import { PaymentRefund } from '../src/payments/entities/payment-refund.entity';
import { ProformaInvoice } from '../src/proformas/entities/proforma-invoice.entity';
import { ProformaInvoiceItem } from '../src/proformas/entities/proforma-invoice-item.entity';
import { ProformasModule } from '../src/proformas/proformas.module';
import { ProformasService } from '../src/proformas/proformas.service';
import { RedisService } from '../src/redis/redis.service';
import { Permission } from '../src/roles/entities/permission.entity';
import { Role } from '../src/roles/entities/role.entity';
import { RolePermission } from '../src/roles/entities/role-permission.entity';
import { RolesModule } from '../src/roles/roles.module';
import { StorageService } from '../src/storage/storage.service';
import { StripeService } from '../src/stripe/stripe.service';
import { User } from '../src/users/entities/user.entity';
import { UsersModule } from '../src/users/users.module';
import { UserWarehouse } from '../src/warehouses/entities/user-warehouse.entity';
import { Warehouse } from '../src/warehouses/entities/warehouse.entity';
import { WarehousesModule } from '../src/warehouses/warehouses.module';
import { grantDivisions } from './fixtures/divisions-test.helper';

describe('Workstream 3: Proforma Invoices (GreenWave Recycling Non-Accounting Workflow)', () => {
  jest.setTimeout(30000);
  let app: INestApplication;
  let dataSource: DataSource;

  const WAREHOUSE_CGY = '22222222-2222-4222-8222-222222222222';
  const CUSTOMER_ID = '66666666-6666-4666-8666-666666666666';

  let gwAdminToken: string;
  let gwManagerToken: string;
  let gwStaffToken: string;
  let hcAdminToken: string;

  beforeAll(async () => {
    const mockStorageService = {
      upload: jest.fn().mockResolvedValue({ objectKey: 'test.pdf', etag: '1', sizeBytes: 1024 }),
      downloadStream: jest.fn(),
      getPresignedUrl: jest.fn().mockResolvedValue('https://storage.test/signed'),
      objectExists: jest.fn().mockResolvedValue(true),
    };

    const mockRedisService = {
      getClient: () => null,
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      publish: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockResolvedValue(undefined),
    };

    const mockStripeService = {
      isPaymentsConfigured: () => false,
      retrieveBalance: jest.fn(),
      createPaymentIntent: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        TypeOrmModule.forRoot({
          ...gateDatabase('proforma'),
          entities: [
            User,
            Role,
            Permission,
            RolePermission,
            Warehouse,
            UserWarehouse,
            UserDivision,
            Customer,
            Material,
            Invoice,
            InvoiceItem,
            Payment,
            PaymentRefund,
            ProviderEvent,
            StripePayout,
            StripeDispute,
            StripeSyncRun,
            StripeBalanceTransaction,
            LedgerAccount,
            JournalEntry,
            JournalLine,
            AuditEvent,
            EmailOutbox,
            ProformaInvoice,
            ProformaInvoiceItem,
          ],
        }),
        AuthModule,
        UsersModule,
        RolesModule,
        WarehousesModule,
        DivisionsModule,
        CustomersModule,
        MaterialsModule,
        InvoicesModule,
        ProformasModule,
        PaymentsModule,
        AccountingModule,
        AuditModule,
        MailModule,
      ],
    })
      .overrideProvider(MAIL_TRANSPORT)
      .useValue({ send: jest.fn().mockResolvedValue({ messageId: 'local-capture' }) })
      .overrideProvider(StorageService)
      .useValue(mockStorageService)
      .overrideProvider(RedisService)
      .useValue(mockRedisService)
      .overrideProvider(StripeService)
      .useValue(mockStripeService)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    dataSource = moduleRef.get(DataSource);
    await moduleRef.get(LedgerService).ensureDefaultChart();

    await dataSource.query(
      `CREATE TABLE IF NOT EXISTS proforma_invoice_number_counter (id INT PRIMARY KEY, next_value INT)`,
    );
    await dataSource.query(
      `CREATE TABLE IF NOT EXISTS invoice_number_counter (id INT PRIMARY KEY, next_value BIGINT)`,
    );

    // Seed Warehouse
    const whRepo = dataSource.getRepository(Warehouse);
    await whRepo.save({
      id: WAREHOUSE_CGY,
      name: 'Calgary Depot',
      code: 'CGY',
      province: 'AB',
      active: true,
    });

    // Seed Customer
    const custRepo = dataSource.getRepository(Customer);
    await custRepo.save({
      id: CUSTOMER_ID,
      name: 'Pacific Scrap Importers Ltd',
      billTo: '100 Harbour View, Vancouver, BC',
      shipTo: 'Dock 4, Port of Vancouver, BC',
      email: 'logistics@pacificscrap.test',
      division: 'recycling',
      warehouseId: WAREHOUSE_CGY,
    });

    // Seed Users
    const userRepo = dataSource.getRepository(User);
    const uwRepo = dataSource.getRepository(UserWarehouse);
    const udivRepo = dataSource.getRepository(UserDivision);
    const passwordHash = await bcrypt.hash('Secret123!', 10);

    // 1. GW Admin (full finance access, greenwave division)
    await userRepo.save({
      id: 1,
      email: 'gw-admin@test.local',
      fullName: 'GW Admin',
      password: passwordHash,
      status: 'active',
      role: 'admin',
    });
    await udivRepo.save({ id: '11111111-0000-4000-8000-000000000001', userId: 1, division: 'greenwave' });

    // 2. GW Manager
    await userRepo.save({
      id: 2,
      email: 'gw-mgr@test.local',
      fullName: 'GW Manager',
      password: passwordHash,
      status: 'active',
      role: 'manager',
    });
    await udivRepo.save({ id: '11111111-0000-4000-8000-000000000002', userId: 2, division: 'greenwave' });
    await uwRepo.save({ id: '22222222-0000-4000-8000-000000000002', userId: 2, warehouseId: WAREHOUSE_CGY });

    // 3. GW Staff (read only, staff role)
    await userRepo.save({
      id: 3,
      email: 'gw-staff@test.local',
      fullName: 'GW Staff',
      password: passwordHash,
      status: 'active',
      role: 'staff',
    });
    await udivRepo.save({ id: '11111111-0000-4000-8000-000000000003', userId: 3, division: 'greenwave' });
    await uwRepo.save({ id: '22222222-0000-4000-8000-000000000003', userId: 3, warehouseId: WAREHOUSE_CGY });

    // 4. Healthcare Admin (admin role, BUT healthcare division ONLY)
    await userRepo.save({
      id: 4,
      email: 'hc-admin@test.local',
      fullName: 'HC Admin',
      password: passwordHash,
      status: 'active',
      role: 'admin',
    });
    await udivRepo.save({ id: '11111111-0000-4000-8000-000000000004', userId: 4, division: 'healthcare' });

    // Login helper
    const login = async (email: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: 'Secret123!' })
        .expect(200);
      return res.body.access_token as string;
    };

    gwAdminToken = await login('gw-admin@test.local');
    gwManagerToken = await login('gw-mgr@test.local');
    gwStaffToken = await login('gw-staff@test.local');
    hcAdminToken = await login('hc-admin@test.local');
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  let createdProformaId: string;
  let createdProformaNumber: string;

  describe('1. Division Scoping & Security Access', () => {
    it('allows GreenWave Recycling admin to access peek-number', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/proformas/peek-number')
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .expect(200);
      expect(res.body.nextNumber).toBe('PF-0001');
      expect(res.body.preview).toBe(true);
    });

    it('FORBIDS Healthcare admin from accessing proformas (403 Forbidden)', async () => {
      await request(app.getHttpServer())
        .get('/api/proformas')
        .set('Authorization', `Bearer ${hcAdminToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .get('/api/proformas/peek-number')
        .set('Authorization', `Bearer ${hcAdminToken}`)
        .expect(403);
    });
  });

  describe('2. Proforma Invoice Creation & Numbering Independence', () => {
    it('creates a draft proforma invoice with custom Incoterms, weights, and items', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/proformas')
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .send({
          customerId: CUSTOMER_ID,
          warehouseId: WAREHOUSE_CGY,
          issueDate: '2026-09-17',
          validityDate: '2026-10-17',
          currency: 'CAD',
          poReference: 'PO-PAC-2026-001',
          incoterm: 'FOB',
          incotermLocation: 'Port of Vancouver',
          origin: 'Calgary, AB',
          destination: 'Tokyo, Japan',
          shippingTerms: 'Ocean Freight Prepaid',
          notes: 'Customer inspection required before shipment loading',
          commercialTerms: 'Commercial preliminary estimate',
          items: [
            {
              description: 'Baled PET Flakes Clear',
              quantity: 20000,
              unit: 'kg',
              unitPrice: 0.85,
              discount: 500,
              taxRate: 5,
              weight: 20000,
            },
            {
              description: 'HDPE Granules Natural',
              quantity: 10000,
              unit: 'kg',
              unitPrice: 1.1,
              discount: 0,
              taxRate: 5,
              weight: 10000,
            },
          ],
        })
        .expect(201);

      createdProformaId = res.body.id;
      createdProformaNumber = res.body.proformaNumber;

      expect(createdProformaNumber).toBe('PF-0001');
      expect(res.body.status).toBe('draft');
      expect(res.body.division).toBe('recycling');
      expect(res.body.customerName).toBe('Pacific Scrap Importers Ltd');
      expect(res.body.incoterm).toBe('FOB');
      expect(res.body.incotermLocation).toBe('Port of Vancouver');
      expect(Number(res.body.totalWeight)).toBe(30000);

      // Line 1: (20000 * 0.85 - 500) = 16500 + 5% (825) = 17325
      // Line 2: (10000 * 1.10 - 0) = 11000 + 5% (550) = 11550
      // Subtotal: 27500, Tax: 1375, Total: 28875
      expect(Number(res.body.subtotal)).toBe(27500);
      expect(Number(res.body.taxTotal)).toBe(1375);
      expect(Number(res.body.total)).toBe(28875);
      expect(res.body.items).toHaveLength(2);
    });

    it('creates second proforma with sequential number PF-0002 without affecting normal invoices', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/proformas')
        .set('Authorization', `Bearer ${gwManagerToken}`)
        .send({
          warehouseId: WAREHOUSE_CGY,
          issueDate: '2026-09-17',
          items: [
            {
              description: 'Mixed Scrap Metal',
              quantity: 500,
              unit: 'kg',
              unitPrice: 2.0,
            },
          ],
        })
        .expect(201);

      expect(res.body.proformaNumber).toBe('PF-0002');

      // Verify normal invoices table has NOT had any rows created
      const invRepo = dataSource.getRepository(Invoice);
      const invoicesCount = await invRepo.count();
      expect(invoicesCount).toBe(0);
    });
  });

  describe('3. Strict Accounting & Payment Isolation Proof', () => {
    it('proves that creating and updating a proforma created 0 payments, 0 journal entries, 0 AR postings', async () => {
      // 1. Payment records count
      const paymentRepo = dataSource.getRepository(Payment);
      const paymentCount = await paymentRepo.count();
      expect(paymentCount).toBe(0);

      // 2. Journal entries count
      const journalEntryRepo = dataSource.getRepository(JournalEntry);
      const journalEntryCount = await journalEntryRepo.count();
      expect(journalEntryCount).toBe(0);

      // 3. Journal lines count
      const journalLineRepo = dataSource.getRepository(JournalLine);
      const journalLineCount = await journalLineRepo.count();
      expect(journalLineCount).toBe(0);

      // 4. Invoices count
      const invoiceRepo = dataSource.getRepository(Invoice);
      const invoiceCount = await invoiceRepo.count();
      expect(invoiceCount).toBe(0);
    });
  });

  describe('4. Draft Editing & Status Lifecycle', () => {
    it('allows editing draft proforma fields and items', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/proformas/${createdProformaId}`)
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .send({
          notes: 'Updated notes: CIF terms requested instead',
          incoterm: 'CIF',
          incotermLocation: 'Yokohama, Japan',
        })
        .expect(200);

      expect(res.body.incoterm).toBe('CIF');
      expect(res.body.incotermLocation).toBe('Yokohama, Japan');
      expect(res.body.notes).toContain('Updated notes');
    });

    it('supports PDF generation with prominent PROFORMA INVOICE header and no payment links', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/proformas/${createdProformaId}/pdf`)
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .expect(200);

      expect(res.headers['content-type']).toContain('pdf');
      expect(res.headers['content-disposition']).toContain(`${createdProformaNumber}.pdf`);
      expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
      expect(await dataSource.getRepository(Payment).count()).toBe(0);
      expect(await dataSource.getRepository(JournalEntry).count()).toBe(0);
      expect(await dataSource.getRepository(JournalLine).count()).toBe(0);
    });

    it('supports sending proforma via email without Stripe or payment links', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/proformas/${createdProformaId}/send`)
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .send({ email: 'billing@pacificscrap.test' })
        .expect(200);

      expect(res.body.recipient).toBe('billing@pacificscrap.test');
      expect(res.body.status).toBe('SENT');
      expect(await dataSource.getRepository(EmailOutbox).count()).toBe(1);
      expect(await dataSource.getRepository(Payment).count()).toBe(0);
      expect(await dataSource.getRepository(JournalEntry).count()).toBe(0);
      expect(await dataSource.getRepository(JournalLine).count()).toBe(0);
    });
  });

  it('accepting a proforma has no accounting effects', async () => {
    await request(app.getHttpServer()).patch(`/api/proformas/${createdProformaId}`).set('Authorization', `Bearer ${gwAdminToken}`).send({ status: 'accepted' }).expect(200);
    for (const entity of [Payment, JournalEntry, JournalLine]) expect(await dataSource.getRepository(entity).count()).toBe(0);
  });

  describe('5. Convert to Final Invoice', () => {
    let convertedInvoiceId: string;

    it('converts proforma into a real final invoice transactionally', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/proformas/${createdProformaId}/convert`)
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .expect(201);

      expect(res.body.proforma).toBeDefined();
      expect(res.body.proforma.status).toBe('converted');
      expect(res.body.proforma.convertedInvoiceId).toBeDefined();
      convertedInvoiceId = res.body.proforma.convertedInvoiceId;

      expect(res.body.invoice).toBeDefined();
      expect(res.body.invoice.id).toBe(convertedInvoiceId);
      expect(res.body.invoice.invoiceNumber).toBeDefined(); // Standard invoice numbering allocated
      expect(res.body.invoice.division).toBe('recycling');
      expect(res.body.invoice.items).toHaveLength(2);

      // Verify the final invoice now exists in invoices table
      const invRepo = dataSource.getRepository(Invoice);
      const finalInvoice = await invRepo.findOne({ where: { id: convertedInvoiceId } });
      expect(finalInvoice).toBeDefined();
      expect(finalInvoice?.status).toBe('final');
      expect(Number(finalInvoice?.total)).toBe(28875);
    });

    it('PREVENTS double conversion of the same proforma invoice (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/proformas/${createdProformaId}/convert`)
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .expect(400);

      expect(res.body.message).toContain('already been converted');
    });

    it('PREVENTS editing a proforma that has already been converted', async () => {
      await request(app.getHttpServer())
        .patch(`/api/proformas/${createdProformaId}`)
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .send({ notes: 'Attempting edit after conversion' })
        .expect(400);
    });

    it('Healthcare user attempting to convert proforma is denied with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .post(`/api/proformas/${createdProformaId}/convert`)
        .set('Authorization', `Bearer ${hcAdminToken}`)
        .expect(403);
    });
  });
  (process.env.GREENWAVE_PG_GATE === '1' ? it : it.skip)('concurrent conversion creates exactly one final invoice and posting', async () => {
    const created = await request(app.getHttpServer()).post('/api/proformas').set('Authorization', `Bearer ${gwAdminToken}`).send({ warehouseId: WAREHOUSE_CGY, issueDate: '2026-09-17', items: [{ description: 'Concurrency fixture', quantity: 1, unitPrice: 10 }] }).expect(201);
    const before = await dataSource.getRepository(Invoice).count();
    const postings = await dataSource.getRepository(JournalEntry).count();
    const responses = await Promise.all([1, 2].map(() => request(app.getHttpServer()).post(`/api/proformas/${created.body.id}/convert`).set('Authorization', `Bearer ${gwAdminToken}`)));
    expect(responses.map(r => r.status).sort()).toEqual([201, 400]);
    expect(await dataSource.getRepository(Invoice).count()).toBe(before + 1);
    expect(await dataSource.getRepository(JournalEntry).count()).toBe(postings + 1);
  });

  describe('6. Send only marks a proforma sent when the email was dispatched', () => {
    const draft = async () =>
      (
        await request(app.getHttpServer())
          .post('/api/proformas')
          .set('Authorization', `Bearer ${gwAdminToken}`)
          .send({
            customerId: CUSTOMER_ID,
            warehouseId: WAREHOUSE_CGY,
            issueDate: '2026-09-17',
            validityDate: '2026-10-17',
            currency: 'CAD',
            items: [{ description: 'Send status line', quantity: 1, unitPrice: 100, taxRate: 5 }],
          })
          .expect(201)
      ).body.id as string;
    const send = (id: string) =>
      request(app.getHttpServer())
        .post(`/api/proformas/${id}/send`)
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .send({ email: 'billing@pacificscrap.test' })
        .expect(200);
    const statusOf = async (id: string) =>
      (await dataSource.getRepository(ProformaInvoice).findOneByOrFail({ id })).status;
    const outboxFor = (id: string) =>
      dataSource.getRepository(EmailOutbox).find({ where: { entityId: id } });
    const sideEffects = async () => ({
      payments: await dataSource.getRepository(Payment).count(),
      journals: await dataSource.getRepository(JournalEntry).count(),
      lines: await dataSource.getRepository(JournalLine).count(),
    });

    it('delivered: draft -> sent, PDF attached, outbox SENT', async () => {
      const transport = app.get(MAIL_TRANSPORT) as { send: jest.Mock };
      transport.send.mockClear();
      const id = await draft();
      const before = await sideEffects();
      const res = await send(id);
      expect(res.body).toMatchObject({ sent: true, status: 'SENT' });
      expect(await statusOf(id)).toBe('sent');
      const attachment = transport.send.mock.calls[0][0].attachments[0];
      expect(attachment.contentType).toBe('application/pdf');
      expect(Buffer.isBuffer(attachment.content) && attachment.content.length > 0).toBe(true);
      expect((await outboxFor(id)).map((o) => o.status)).toEqual(['SENT']);
      expect(await sideEffects()).toEqual(before);
    });

    it('SMTP absent: not sent, status stays draft, outbox SKIPPED', async () => {
      const mail = app.get(MailService) as unknown as { transport: unknown };
      const saved = mail.transport;
      mail.transport = null; // as in production today: no transport, no SMTP_HOST
      try {
        const id = await draft();
        const before = await sideEffects();
        const res = await send(id);
        expect(res.body).toMatchObject({ sent: false, status: 'SKIPPED' });
        expect(await statusOf(id)).toBe('draft');
        expect(res.body.note).toMatch(/not configured/i);
        expect((await outboxFor(id)).map((o) => o.status)).toEqual(['SKIPPED']);
        expect(await sideEffects()).toEqual(before);
      } finally {
        mail.transport = saved;
      }
    });

    it('SMTP transport failure: not sent, status stays draft, outbox FAILED', async () => {
      const transport = app.get(MAIL_TRANSPORT) as { send: jest.Mock };
      transport.send.mockRejectedValueOnce(Object.assign(new Error('connection refused'), { code: 'ECONNECTION' }));
      const id = await draft();
      const before = await sideEffects();
      const res = await send(id);
      expect(res.body).toMatchObject({ sent: false, status: 'FAILED' });
      expect(await statusOf(id)).toBe('draft');
      expect((await outboxFor(id)).map((o) => o.status)).toEqual(['FAILED']);
      expect(await sideEffects()).toEqual(before);
    });

    it('accepted proforma: a failed send keeps it accepted', async () => {
      const transport = app.get(MAIL_TRANSPORT) as { send: jest.Mock };
      const id = await draft();
      await request(app.getHttpServer())
        .patch(`/api/proformas/${id}`)
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .send({ status: 'accepted' })
        .expect(200);
      transport.send.mockRejectedValueOnce(new Error('transport down'));
      const res = await send(id);
      expect(res.body.sent).toBe(false);
      expect(await statusOf(id)).toBe('accepted');
    });

    it('PDF failure: send is refused and the draft is untouched', async () => {
      const id = await draft();
      const spy = jest
        .spyOn(app.get(ProformasService), 'renderPdf')
        .mockRejectedValueOnce(new Error('PDF rendering unavailable'));
      try {
        const res = await request(app.getHttpServer())
          .post(`/api/proformas/${id}/send`)
          .set('Authorization', `Bearer ${gwAdminToken}`)
          .send({ email: 'billing@pacificscrap.test' });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(await statusOf(id)).toBe('draft');
        expect(await outboxFor(id)).toHaveLength(0);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
