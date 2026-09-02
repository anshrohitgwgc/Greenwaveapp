/* eslint-disable */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AuditModule } from '../src/audit/audit.module';
import { AuditEvent } from '../src/audit/entities/audit-event.entity';
import { AuthModule } from '../src/auth/auth.module';
import { CustomersModule } from '../src/customers/customers.module';
import { Customer } from '../src/customers/entities/customer.entity';
import { Container } from '../src/inventory/entities/container.entity';
import { InventoryBalance } from '../src/inventory/entities/inventory-balance.entity';
import { InventoryTransaction } from '../src/inventory/entities/inventory-transaction.entity';
import { InventoryModule } from '../src/inventory/inventory.module';
import { InvoiceItem } from '../src/invoices/entities/invoice-item.entity';
import { Invoice } from '../src/invoices/entities/invoice.entity';
import { InvoicesModule } from '../src/invoices/invoices.module';
import { MaterialsModule } from '../src/materials/materials.module';
import { Material } from '../src/materials/entities/material.entity';
import { Payment } from '../src/payments/entities/payment.entity';
import { PaymentsModule } from '../src/payments/payments.module';
import { PhotoAsset } from '../src/photos/entities/photo-asset.entity';
import { PhotosModule } from '../src/photos/photos.module';
import { RedisService } from '../src/redis/redis.service';
import { Permission } from '../src/roles/entities/permission.entity';
import { Role } from '../src/roles/entities/role.entity';
import { RolePermission } from '../src/roles/entities/role-permission.entity';
import { UserRole } from '../src/roles/entities/user-role.entity';
import { RolesModule } from '../src/roles/roles.module';
import { StorageService } from '../src/storage/storage.service';
import { Timesheet } from '../src/timesheets/entities/timesheet.entity';
import { TimesheetsModule } from '../src/timesheets/timesheets.module';
import { User } from '../src/users/entities/user.entity';
import { UsersModule } from '../src/users/users.module';
import { UserDivision } from '../src/divisions/entities/user-division.entity';
import { UserWarehouse } from '../src/warehouses/entities/user-warehouse.entity';
import { Warehouse } from '../src/warehouses/entities/warehouse.entity';
import { WarehousesModule } from '../src/warehouses/warehouses.module';
import { grantDivisions } from './fixtures/divisions-test.helper';

describe('E2E Acceptance: Management Portal RBAC & Customer Payments', () => {
  jest.setTimeout(30000);
  let app: INestApplication;
  let dataSource: DataSource;

  const WAREHOUSE_CGY = '22222222-2222-4222-8222-222222222222';
  const WAREHOUSE_ON = '33333333-3333-4333-8333-333333333333';
  const WAREHOUSE_MR = '11111111-1111-4111-8111-111111111111';

  const MATERIAL_CGY_RECYCLING = 'aaaaaaaa-0001-4aaa-8aaa-aaaaaaaaaaaa';
  const MATERIAL_CGY_HEALTHCARE = 'aaaaaaaa-0002-4aaa-8aaa-aaaaaaaaaaaa';
  const MATERIAL_ON_RECYCLING = 'aaaaaaaa-0003-4aaa-8aaa-aaaaaaaaaaaa';
  const MATERIAL_ON_HEALTHCARE = 'aaaaaaaa-0004-4aaa-8aaa-aaaaaaaaaaaa';
  const MATERIAL_MR_RECYCLING = 'aaaaaaaa-0005-4aaa-8aaa-aaaaaaaaaaaa';
  const MATERIAL_MR_HEALTHCARE = 'aaaaaaaa-0006-4aaa-8aaa-aaaaaaaaaaaa';
  const MATERIAL_GLOBAL = 'aaaaaaaa-0007-4aaa-8aaa-aaaaaaaaaaaa';

  let adminToken: string;
  let managerToken: string;
  let staffToken: string;
  let driverToken: string;
  let ontarioStaffToken: string;

  const webhookSecret = 'whsec_e2e_acceptance_test_secret_key_12345';

  beforeAll(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          dropSchema: true,
          entities: [
            User,
            AuditEvent,
            Warehouse,
            UserWarehouse,
            UserDivision,
            Customer,
            Material,
            Container,
            InventoryTransaction,
            InventoryBalance,
            Invoice,
            InvoiceItem,
            Payment,
            PhotoAsset,
            Role,
            Permission,
            RolePermission,
            UserRole,
            Timesheet,
          ],
          synchronize: true,
        }),
        AuthModule,
        UsersModule,
        WarehousesModule,
        RolesModule,
        InvoicesModule,
        PaymentsModule,
        CustomersModule,
        MaterialsModule,
        InventoryModule,
        PhotosModule,
        TimesheetsModule,
        AuditModule,
      ],
    })
      .overrideProvider(StorageService)
      .useValue({
        onModuleInit: jest.fn(),
        getPresignedUploadUrl: jest
          .fn()
          .mockResolvedValue('https://mock-s3/upload'),
        getPresignedDownloadUrl: jest
          .fn()
          .mockResolvedValue('https://mock-s3/download'),
        deleteObject: jest.fn().mockResolvedValue(undefined),
      })
      .overrideProvider(RedisService)
      .useValue({
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        del: jest.fn().mockResolvedValue(undefined),
        publish: jest.fn().mockResolvedValue(undefined),
        subscribe: jest.fn().mockResolvedValue(undefined),
        getClient: jest.fn().mockReturnValue({}),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: false,
      }),
    );
    await app.init();

    dataSource = moduleRef.get(DataSource);

    // Seed Warehouses
    const whRepo = dataSource.getRepository(Warehouse);
    await whRepo.save([
      { id: WAREHOUSE_CGY, name: 'Calgary, AB', code: 'CGY', active: true },
      { id: WAREHOUSE_ON, name: 'Ontario', code: 'ON', active: true },
      { id: WAREHOUSE_MR, name: 'Maple Ridge, BC', code: 'MR', active: true },
    ]);

    // Seed Materials - one Recycling + one Healthcare material per facility,
    // plus one global (warehouse-agnostic) material.
    const materialRepo = dataSource.getRepository(Material);
    await materialRepo.save([
      {
        id: MATERIAL_CGY_RECYCLING,
        name: 'Calgary Recycling Scrap',
        unit: 'kg',
        division: 'recycling',
        warehouseId: WAREHOUSE_CGY,
        active: true,
      },
      {
        id: MATERIAL_CGY_HEALTHCARE,
        name: 'Calgary Healthcare Sharps',
        unit: 'box',
        division: 'healthcare',
        warehouseId: WAREHOUSE_CGY,
        active: true,
      },
      {
        id: MATERIAL_ON_RECYCLING,
        name: 'Ontario Recycling Scrap',
        unit: 'kg',
        division: 'recycling',
        warehouseId: WAREHOUSE_ON,
        active: true,
      },
      {
        id: MATERIAL_ON_HEALTHCARE,
        name: 'Ontario Healthcare Sharps',
        unit: 'box',
        division: 'healthcare',
        warehouseId: WAREHOUSE_ON,
        active: true,
      },
      {
        id: MATERIAL_MR_RECYCLING,
        name: 'Maple Ridge Recycling Scrap',
        unit: 'kg',
        division: 'recycling',
        warehouseId: WAREHOUSE_MR,
        active: true,
      },
      {
        id: MATERIAL_MR_HEALTHCARE,
        name: 'Maple Ridge Healthcare Sharps',
        unit: 'box',
        division: 'healthcare',
        warehouseId: WAREHOUSE_MR,
        active: true,
      },
      {
        id: MATERIAL_GLOBAL,
        name: 'Universal Baler Twine',
        unit: 'kg',
        division: 'recycling',
        warehouseId: null,
        active: true,
      },
    ]);

    // Seed Permissions
    const permRepo = dataSource.getRepository(Permission);
    const roleRepo = dataSource.getRepository(Role);
    const rolePermRepo = dataSource.getRepository(RolePermission);

    const seededPerms = await permRepo.save([
      {
        id: '1',
        key: 'warehouses:global_access',
        description: 'Global Access',
      },
      { id: '2', key: 'warehouses:manage', description: 'Manage Warehouses' },
      { id: '3', key: 'invoices:manage', description: 'Manage Invoices' },
      { id: '4', key: 'payments:manage', description: 'Manage Payments' },
      { id: '5', key: 'payments:refund', description: 'Process Refunds' },
      { id: '6', key: 'staff:manage', description: 'Manage Staff' },
      { id: '7', key: 'inventory:write', description: 'Write Inventory' },
    ]);

    const adminRole = await roleRepo.save({ id: 'r-admin', name: 'admin' });
    const managerRole = await roleRepo.save({
      id: 'r-manager',
      name: 'manager',
    });
    const staffRole = await roleRepo.save({ id: 'r-staff', name: 'staff' });
    const driverRole = await roleRepo.save({ id: 'r-driver', name: 'driver' });

    // Link admin permissions
    await rolePermRepo.save(
      seededPerms.map((p) => ({ roleId: adminRole.id, permissionId: p.id })),
    );

    // Link manager permissions (no global access, no refund)
    const managerPerms = seededPerms.filter((p) =>
      ['invoices:manage', 'payments:manage', 'inventory:write'].includes(p.key),
    );
    await rolePermRepo.save(
      managerPerms.map((p) => ({ roleId: managerRole.id, permissionId: p.id })),
    );

    // Seed Users
    const passwordHash = await bcrypt.hash('TestPass123!', 10);
    const userRepo = dataSource.getRepository(User);

    const adminUser = await userRepo.save({
      fullName: 'Global Admin',
      email: 'admin@greenwave.test',
      password: passwordHash,
      role: 'admin',
      status: 'active',
    });

    const managerUser = await userRepo.save({
      fullName: 'Multi-Warehouse Manager',
      email: 'manager@greenwave.test',
      password: passwordHash,
      role: 'manager',
      status: 'active',
    });

    const staffUser = await userRepo.save({
      fullName: 'Calgary Staff',
      email: 'staff@greenwave.test',
      password: passwordHash,
      role: 'staff',
      status: 'active',
    });

    const driverUser = await userRepo.save({
      fullName: 'Maple Ridge Driver',
      email: 'driver@greenwave.test',
      password: passwordHash,
      role: 'driver',
      status: 'active',
    });

    const ontarioStaffUser = await userRepo.save({
      fullName: 'Ontario Staff',
      email: 'ontario-staff@greenwave.test',
      password: passwordHash,
      role: 'staff',
      status: 'active',
    });

    // Assign warehouse memberships
    const userWhRepo = dataSource.getRepository(UserWarehouse);
    await userWhRepo.save([
      // Manager: Calgary + Maple Ridge
      { id: 'uw-1', userId: managerUser.id, warehouseId: WAREHOUSE_CGY },
      { id: 'uw-2', userId: managerUser.id, warehouseId: WAREHOUSE_MR },
      // Staff: Calgary only
      { id: 'uw-3', userId: staffUser.id, warehouseId: WAREHOUSE_CGY },
      // Driver: Maple Ridge only
      { id: 'uw-4', userId: driverUser.id, warehouseId: WAREHOUSE_MR },
      // Ontario Staff: Ontario only
      { id: 'uw-5', userId: ontarioStaffUser.id, warehouseId: WAREHOUSE_ON },
    ]);

    // Obtain JWT Tokens
    const login = async (email: string) => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'TestPass123!' });
      return res.body.access_token;
    };


    // The invoice numbering path falls back to the legacy
    // `invoice_number_counter` table on non-PostgreSQL drivers (see
    // invoices.service.ts#allocateInvoiceNumber). No entity maps to that
    // table, so `synchronize: true` does not create it and every invoice
    // create in this suite failed with "no such table". Create it the same
    // way invoice-numbering.integration.spec.ts does.
    await dataSource.query(
      `CREATE TABLE IF NOT EXISTS invoice_number_counter (id INT PRIMARY KEY, next_value BIGINT)`,
    );

    // Hold division access constant: this suite asserts warehouse/role
    // behaviour, and every seeded user predates division access control.
    await grantDivisions(
      dataSource,
      (await dataSource.getRepository(User).find()).map((u) => u.id),
    );

    adminToken = await login('admin@greenwave.test');
    managerToken = await login('manager@greenwave.test');
    staffToken = await login('staff@greenwave.test');
    driverToken = await login('driver@greenwave.test');
    ontarioStaffToken = await login('ontario-staff@greenwave.test');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Management Portal RBAC & Scoped Facility Visibility', () => {
    it('Admin sees all warehouses via GET /warehouses', async () => {
      const res = await request(app.getHttpServer())
        .get('/warehouses')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.length).toBe(3);
    });

    it('Manager sees only authorized warehouses (Calgary + Maple Ridge)', async () => {
      const res = await request(app.getHttpServer())
        .get('/warehouses')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      const ids = res.body.map((w: any) => w.id);
      expect(ids).toContain(WAREHOUSE_CGY);
      expect(ids).toContain(WAREHOUSE_MR);
      expect(ids).not.toContain(WAREHOUSE_ON);
    });

    it('Staff sees only Calgary', async () => {
      const res = await request(app.getHttpServer())
        .get('/warehouses')
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(WAREHOUSE_CGY);
    });

    it('Driver sees only Maple Ridge', async () => {
      const res = await request(app.getHttpServer())
        .get('/warehouses')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(WAREHOUSE_MR);
    });
  });

  describe('2. Direct API Privilege Escalation Defense', () => {
    it('Staff user cannot access unassigned Ontario warehouse (403 Forbidden)', async () => {
      await request(app.getHttpServer())
        .get(`/warehouses/${WAREHOUSE_ON}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(403);
    });

    it('Staff user cannot access Ontario warehouse users list (403 Forbidden)', async () => {
      await request(app.getHttpServer())
        .get(`/management/warehouses/${WAREHOUSE_ON}/users`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(403);
    });

    it('Staff user cannot self-promote to admin or assign warehouses (403 Forbidden)', async () => {
      await request(app.getHttpServer())
        .put('/users/3/warehouses')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ warehouseIds: [WAREHOUSE_ON] })
        .expect(403);
    });
  });

  describe('2b. Material Detail IDOR Defense (GET /materials/:id)', () => {
    it('Calgary-only staff can retrieve Calgary Recycling material (200)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/materials/${MATERIAL_CGY_RECYCLING}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);

      expect(res.body.id).toBe(MATERIAL_CGY_RECYCLING);
      expect(res.body.name).toBe('Calgary Recycling Scrap');
    });

    it('Calgary-only staff can retrieve Calgary Healthcare material (division is not a separate access boundary)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/materials/${MATERIAL_CGY_HEALTHCARE}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);

      expect(res.body.id).toBe(MATERIAL_CGY_HEALTHCARE);
    });

    it('Calgary-only staff CANNOT retrieve Ontario Recycling material by direct ID (403, no data leak)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/materials/${MATERIAL_ON_RECYCLING}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(403);

      expect(res.body.name).toBeUndefined();
      expect(res.body.warehouseId).toBeUndefined();
      expect(res.body.division).toBeUndefined();
      expect(res.body.category).toBeUndefined();
    });

    it('Calgary-only staff CANNOT retrieve Ontario Healthcare material by direct ID (403, no data leak)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/materials/${MATERIAL_ON_HEALTHCARE}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(403);

      expect(res.body.name).toBeUndefined();
    });

    it('Calgary-only staff CANNOT retrieve Maple Ridge material by direct ID (403)', async () => {
      await request(app.getHttpServer())
        .get(`/materials/${MATERIAL_MR_RECYCLING}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(403);
    });

    it('Ontario material is unreachable for any actor not assigned to Ontario (staff, manager, and driver all 403)', async () => {
      await request(app.getHttpServer())
        .get(`/materials/${MATERIAL_ON_RECYCLING}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .get(`/materials/${MATERIAL_ON_RECYCLING}`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(403);
    });

    it('Ontario-only staff can retrieve both Ontario divisions but CANNOT retrieve Calgary material by direct ID (reverse-direction IDOR)', async () => {
      await request(app.getHttpServer())
        .get(`/materials/${MATERIAL_ON_RECYCLING}`)
        .set('Authorization', `Bearer ${ontarioStaffToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/materials/${MATERIAL_ON_HEALTHCARE}`)
        .set('Authorization', `Bearer ${ontarioStaffToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/materials/${MATERIAL_CGY_RECYCLING}`)
        .set('Authorization', `Bearer ${ontarioStaffToken}`)
        .expect(403);
      expect(res.body.name).toBeUndefined();

      await request(app.getHttpServer())
        .get(`/materials/${MATERIAL_CGY_HEALTHCARE}`)
        .set('Authorization', `Bearer ${ontarioStaffToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .get(`/materials/${MATERIAL_MR_RECYCLING}`)
        .set('Authorization', `Bearer ${ontarioStaffToken}`)
        .expect(403);
    });

    it('Maple Ridge driver can retrieve Maple Ridge material but not Calgary material', async () => {
      await request(app.getHttpServer())
        .get(`/materials/${MATERIAL_MR_HEALTHCARE}`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/materials/${MATERIAL_CGY_RECYCLING}`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(403);
    });

    it('Manager with Calgary + Maple Ridge assignment can access both, but not Ontario', async () => {
      await request(app.getHttpServer())
        .get(`/materials/${MATERIAL_CGY_RECYCLING}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/materials/${MATERIAL_MR_HEALTHCARE}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/materials/${MATERIAL_ON_HEALTHCARE}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(403);
    });

    it('Admin (global access) can retrieve materials from every facility', async () => {
      for (const id of [
        MATERIAL_CGY_RECYCLING,
        MATERIAL_ON_HEALTHCARE,
        MATERIAL_MR_RECYCLING,
      ]) {
        await request(app.getHttpServer())
          .get(`/materials/${id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
      }
    });

    it('Any authenticated actor can retrieve a global (warehouse-agnostic) material', async () => {
      await request(app.getHttpServer())
        .get(`/materials/${MATERIAL_GLOBAL}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);
    });

    it('Unauthenticated request to material detail is rejected (401)', async () => {
      await request(app.getHttpServer())
        .get(`/materials/${MATERIAL_CGY_RECYCLING}`)
        .expect(401);
    });

    it('A non-existent material ID returns 404, not an authorization bypass', async () => {
      await request(app.getHttpServer())
        .get('/materials/ffffffff-9999-4fff-8fff-ffffffffffff')
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(404);
    });

    it('Direct ID tampering across every facility/division pair is rejected for Calgary-only staff', async () => {
      const forbidden = [
        MATERIAL_ON_RECYCLING,
        MATERIAL_ON_HEALTHCARE,
        MATERIAL_MR_RECYCLING,
        MATERIAL_MR_HEALTHCARE,
      ];
      for (const id of forbidden) {
        await request(app.getHttpServer())
          .get(`/materials/${id}`)
          .set('Authorization', `Bearer ${staffToken}`)
          .expect(403);
      }
    });
  });

  describe('3. Create Test Invoice & Generate Payment Link', () => {
    let createdInvoiceId: string;
    let createdInvoiceNumber: string;
    let paymentToken: string;

    it('creates a $100.00 CAD invoice in Calgary facility', async () => {
      const res = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          invoiceNumber: 'INV-ACCEPT-1001',
          invoiceDate: '2026-08-30',
          // The seeded admin holds both divisions, so the API now requires
          // the invoice's division to be stated rather than guessing one.
          division: 'greenwave',
          dueDate: '2026-09-15',
          billTo: 'Acceptance Corp\n100 Enterprise Way',
          currency: 'CAD',
          subtotal: 95.24,
          taxRate: 5.0,
          taxLabel: 'GST @ 5%',
          taxTotal: 4.76,
          total: 100.0,
          warehouseId: WAREHOUSE_CGY,
          status: 'final',
          items: [
            {
              description: 'Recycled Commodity Test Batch',
              quantity: 1,
              unit: 'lot',
              unitPrice: 95.24,
              lineTotal: 95.24,
            },
          ],
        })
        .expect((r)=>{ if(r.status!==201) console.error('INVOICE 500 BODY:', JSON.stringify(r.body)); });

      createdInvoiceId = res.body.id;
      createdInvoiceNumber = res.body.invoiceNumber;
      expect(Number(res.body.total).toFixed(2)).toBe('100.00');
      expect(res.body.currency).toBe('CAD');
      expect(res.body.paymentStatus).toBe('unpaid');
    });

    it('generates a secure 64-character hex payment link', async () => {
      const res = await request(app.getHttpServer())
        .post(`/payments/invoices/${createdInvoiceId}/link`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      expect(res.body.paymentToken).toBeDefined();
      expect(res.body.paymentToken.length).toBe(64);
      expect(res.body.paymentUrl).toBe(`/pay/${res.body.paymentToken}`);
      paymentToken = res.body.paymentToken;
    });

    it('allows public access to /pay/:token with sanitized metadata and zero internal leaks', async () => {
      const res = await request(app.getHttpServer())
        .get(`/pay/${paymentToken}`)
        .expect(200);

      expect(res.body.invoiceNumber).toBe(createdInvoiceNumber);
      expect(res.body.total).toBe(100.0);
      expect(res.body.currency).toBe('CAD');
      expect(res.body.paymentStatus).toBe('unpaid');
      expect(res.body.items.length).toBe(1);

      // Verify no internal IDs or staff tokens leaked
      expect(res.body.id).toBeUndefined();
      expect(res.body.createdBy).toBeUndefined();
      expect(res.body.warehouseId).toBeUndefined();
    });

    it('creates server-authoritative checkout session from DB invoice amount', async () => {
      const res = await request(app.getHttpServer())
        .post(`/pay/${paymentToken}/checkout`)
        .expect(201);

      expect(res.body.amount).toBe(100.0);
      expect(res.body.currency).toBe('CAD');
      expect(res.body.sessionId).toMatch(/^cs_test_/);
    });

    it('processes webhook with valid HMAC-SHA256 signature and authoritatively transitions invoice to PAID', async () => {
      const payload = {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_accept_session_1001',
            payment_intent: 'pi_test_accept_intent_1001',
            amount_total: 10000,
            currency: 'cad',
            metadata: {
              invoiceNumber: createdInvoiceNumber,
              paymentToken: paymentToken,
            },
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const sig = crypto
        .createHmac('sha256', webhookSecret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');

      const res = await request(app.getHttpServer())
        .post('/pay/webhook')
        .set('stripe-signature', `t=${timestamp},v1=${sig}`)
        .send(payload)
        .expect(200);

      expect(res.body.received).toBe(true);
      expect(res.body.status).toBe('paid');

      // Verify DB persistence of PAID status
      const invCheck = await request(app.getHttpServer())
        .get(`/invoices/${createdInvoiceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(invCheck.body.paymentStatus).toBe('paid');
      expect(invCheck.body.paidAt).toBeDefined();
      expect(invCheck.body.paymentReference).toBe('pi_test_accept_intent_1001');
    });

    it('guarantees webhook idempotency on duplicate delivery', async () => {
      const payload = {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_accept_session_1001',
            payment_intent: 'pi_test_accept_intent_1001',
            amount_total: 10000,
            currency: 'cad',
            metadata: {
              invoiceNumber: createdInvoiceNumber,
              paymentToken: paymentToken,
            },
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const sig = crypto
        .createHmac('sha256', webhookSecret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');

      const res = await request(app.getHttpServer())
        .post('/pay/webhook')
        .set('stripe-signature', `t=${timestamp},v1=${sig}`)
        .send(payload)
        .expect(200);

      expect(res.body.received).toBe(true);
      expect(res.body.idempotent).toBe(true);
    });

    it('rejects tampered webhook signatures (401 Unauthorized)', async () => {
      const payload = { type: 'checkout.session.completed', data: {} };
      const timestamp = Math.floor(Date.now() / 1000).toString();

      await request(app.getHttpServer())
        .post('/pay/webhook')
        .set('stripe-signature', `t=${timestamp},v1=bad_signature_deadbeef`)
        .send(payload)
        .expect(401);
    });

    it('rejects replayed webhooks with old timestamps (> 300s) (401 Unauthorized)', async () => {
      const payload = { type: 'checkout.session.completed', data: {} };
      const rawBody = JSON.stringify(payload);
      const staleTimestamp = (Math.floor(Date.now() / 1000) - 350).toString();
      const sig = crypto
        .createHmac('sha256', webhookSecret)
        .update(`${staleTimestamp}.${rawBody}`)
        .digest('hex');

      await request(app.getHttpServer())
        .post('/pay/webhook')
        .set('stripe-signature', `t=${staleTimestamp},v1=${sig}`)
        .send(payload)
        .expect(401);
    });

    it('handles payment failure webhooks safely without marking invoice as paid', async () => {
      const failInvoice = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          invoiceNumber: 'INV-ACCEPT-FAIL-1',
          invoiceDate: '2026-08-30',
          division: 'greenwave',
          billTo: 'Failed Test Corp',
          currency: 'CAD',
          subtotal: 50.0,
          total: 50.0,
          warehouseId: WAREHOUSE_CGY,
          status: 'final',
          items: [
            {
              description: 'Failed Order Item',
              quantity: 1,
              unitPrice: 50.0,
              lineTotal: 50.0,
            },
          ],
        });

      expect(failInvoice.status).toBe(201);
      const failInvoiceId = failInvoice.body.id;
      const failInvoiceNumber = failInvoice.body.invoiceNumber;

      const failPayload = {
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_test_failed_1001',
            last_payment_error: {
              message: 'Your card has insufficient funds.',
            },
            metadata: {
              invoiceNumber: failInvoiceNumber,
            },
          },
        },
      };

      const rawBody = JSON.stringify(failPayload);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const sig = crypto
        .createHmac('sha256', webhookSecret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');

      const res = await request(app.getHttpServer())
        .post('/pay/webhook')
        .set('stripe-signature', `t=${timestamp},v1=${sig}`)
        .send(failPayload)
        .expect(200);

      expect(res.body.status).toBe('failed_recorded');

      // Verify invoice did not become paid
      const check = await request(app.getHttpServer())
        .get(`/invoices/${failInvoiceId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(check.body.paymentStatus).toBe('failed');
    });

    it('allows admin with payments:refund permission to process refunds', async () => {
      const payments = await dataSource.getRepository(Payment).find();
      const paidPayment = payments.find((p) => p.status === 'paid');
      expect(paidPayment).toBeDefined();

      const res = await request(app.getHttpServer())
        .post(`/payments/refund/${paidPayment?.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Customer requested cancellation of test order' })
        .expect(201);

      expect(res.body.status).toBe('refunded');
    });

    it('blocks non-admin staff from processing refunds (403 Forbidden)', async () => {
      const payments = await dataSource.getRepository(Payment).find();
      if (payments.length > 0) {
        await request(app.getHttpServer())
          .post(`/payments/refund/${payments[0].id}`)
          .set('Authorization', `Bearer ${staffToken}`)
          .send({ reason: 'Unauthorized staff refund' })
          .expect(403);
      }
    });

    it('returns server-calculated payment metrics via GET /payments/metrics', async () => {
      const res = await request(app.getHttpServer())
        .get('/payments/metrics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.totalOutstanding).toBeDefined();
      expect(res.body.paidThisMonth).toBeDefined();
      expect(res.body.unpaidCount).toBeDefined();
      expect(typeof res.body.unpaidCount).toBe('number');
    });
  });
});
