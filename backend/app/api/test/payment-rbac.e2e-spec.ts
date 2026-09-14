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
import { ACCOUNTING_ENTITIES } from '../src/accounting/accounting.module';
import { EmailOutbox } from '../src/mail/entities/email-outbox.entity';
import { PAYMENT_ENTITIES } from '../src/payments/payments.module';
import { MailModule } from '../src/mail/mail.module';

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
            ...PAYMENT_ENTITIES,
            ...ACCOUNTING_ENTITIES,
            EmailOutbox,
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
        MailModule,
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

  // Section 3 (payment links, checkout, webhooks, refunds) exercised the
  // retired simulated gateway at /pay/:token and /pay/webhook. The real
  // Stripe flow is covered end to end in test/stripe-payments.e2e-spec.ts.
});
