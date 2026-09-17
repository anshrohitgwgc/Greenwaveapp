import { gateDatabase } from './gate-database';
/* eslint-disable */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { ACCOUNTING_ENTITIES, AccountingModule } from '../src/accounting/accounting.module';
import { LedgerAccount } from '../src/accounting/entities/ledger-account.entity';
import { AuditModule } from '../src/audit/audit.module';
import { AuditEvent } from '../src/audit/entities/audit-event.entity';
import { AuthModule } from '../src/auth/auth.module';
import { BANKING_ENTITIES, BankingModule } from '../src/banking/banking.module';
import { Customer } from '../src/customers/entities/customer.entity';
import { CustomersModule } from '../src/customers/customers.module';
import { DivisionsModule } from '../src/divisions/divisions.module';
import { UserDivision } from '../src/divisions/entities/user-division.entity';
import { Container } from '../src/inventory/entities/container.entity';
import { InventoryBalance } from '../src/inventory/entities/inventory-balance.entity';
import { InventoryTransaction } from '../src/inventory/entities/inventory-transaction.entity';
import { InventoryModule } from '../src/inventory/inventory.module';
import { InvoiceItem } from '../src/invoices/entities/invoice-item.entity';
import { Invoice } from '../src/invoices/entities/invoice.entity';
import { InvoicesModule } from '../src/invoices/invoices.module';
import { EmailOutbox } from '../src/mail/entities/email-outbox.entity';
import { MailModule } from '../src/mail/mail.module';
import { Material } from '../src/materials/entities/material.entity';
import { MaterialsModule } from '../src/materials/materials.module';
import { PAYABLES_ENTITIES, PayablesModule } from '../src/payables/payables.module';
import { PAYMENT_ENTITIES, PaymentsModule } from '../src/payments/payments.module';
import { Payment } from '../src/payments/entities/payment.entity';
import { PhotoAsset } from '../src/photos/entities/photo-asset.entity';
import { RedisService } from '../src/redis/redis.service';
import { Permission } from '../src/roles/entities/permission.entity';
import { Role } from '../src/roles/entities/role.entity';
import { RolePermission } from '../src/roles/entities/role-permission.entity';
import { UserRole } from '../src/roles/entities/user-role.entity';
import { RolesModule } from '../src/roles/roles.module';
import { StorageService } from '../src/storage/storage.service';
import { StripeService } from '../src/stripe/stripe.service';
import { User } from '../src/users/entities/user.entity';
import { UsersModule } from '../src/users/users.module';
import { UserWarehouse } from '../src/warehouses/entities/user-warehouse.entity';
import { Warehouse } from '../src/warehouses/entities/warehouse.entity';
import { WarehousesModule } from '../src/warehouses/warehouses.module';

describe('E2E Security: Financial Features Restricted to GreenWave Recycling Only', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let dataSource: DataSource;

  const WAREHOUSE_CGY = '22222222-2222-4222-8222-222222222222';
  const SAMPLE_PAYMENT_ID = '99999999-9999-4999-8999-999999999999';
  const SAMPLE_INVOICE_ID = '88888888-8888-4888-8888-888888888888';

  let gwAdminToken: string;
  let gwManagerToken: string;
  let gwStaffToken: string;
  let hcAdminToken: string;
  let hcManagerToken: string;
  let hcStaffToken: string;
  let dualAdminToken: string;

  const loginAs = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'Password123!' });
    if (!res.body?.access_token) {
      throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body.access_token as string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        TypeOrmModule.forRoot({
          ...gateDatabase('finance'),
          entities: [
            ...PAYMENT_ENTITIES,
            ...ACCOUNTING_ENTITIES,
            ...BANKING_ENTITIES,
            ...PAYABLES_ENTITIES,
            EmailOutbox,
            User,
            AuditEvent,
            Warehouse,
            UserWarehouse,
            UserDivision,
            Material,
            Container,
            InventoryTransaction,
            InventoryBalance,
            Customer,
            Invoice,
            InvoiceItem,
            PhotoAsset,
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
        MaterialsModule,
        InventoryModule,
        CustomersModule,
        InvoicesModule,
        MailModule,
        AccountingModule,
        BankingModule,
        PayablesModule,
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
      .overrideProvider(StorageService)
      .useValue({
        onModuleInit: jest.fn(),
        upload: jest.fn().mockResolvedValue('test-key'),
        downloadStream: jest.fn(),
        getPresignedUrl: jest.fn().mockResolvedValue('https://storage.test/signed'),
      })
      .overrideProvider(StripeService)
      .useValue({
        isPaymentsConfigured: () => false,
        retrieveBalance: jest.fn(),
      })
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

    // Seed Warehouses
    await dataSource.getRepository(Warehouse).save({
      id: WAREHOUSE_CGY,
      name: 'Calgary Warehouse',
      code: 'CGY',
      province: 'AB',
      address: '123 Calgary Trail',
      active: true,
    });

    // Seed Roles & Permissions
    const permRepo = dataSource.getRepository(Permission);
    const roleRepo = dataSource.getRepository(Role);
    const rpRepo = dataSource.getRepository(RolePermission);

    const adminRole = await roleRepo.save({ id: randomUUID(), name: 'admin', description: 'Admin' });
    const managerRole = await roleRepo.save({ id: randomUUID(), name: 'manager', description: 'Manager' });
    const staffRole = await roleRepo.save({ id: randomUUID(), name: 'staff', description: 'Staff' });

    const perms = [
      'accounting:read',
      'accounting:manage_accounts',
      'banking:read',
      'banking:manage',
      'payables:read',
      'payables:manage',
      'payments:read_all',
      'payments:manage',
      'payments:refund',
      'warehouses:global_access',
    ];
    for (const key of perms) {
      const p = await permRepo.save({ id: randomUUID(), key, description: key });
      await rpRepo.save({ roleId: adminRole.id, permissionId: p.id });
      if (key !== 'accounting:manage_accounts') {
        await rpRepo.save({ roleId: managerRole.id, permissionId: p.id });
      }
    }

    const passwordHash = await bcrypt.hash('Password123!', 8);
    const userRepo = dataSource.getRepository(User);
    const udivRepo = dataSource.getRepository(UserDivision);
    const uwRepo = dataSource.getRepository(UserWarehouse);

    // 1. GW Admin (GreenWave only)
    const uGwAdmin = await userRepo.save({
      id: 1,
      email: 'gw-admin@test.local',
      fullName: 'GW Admin',
      password: passwordHash,
      status: 'active',
      role: 'admin',
    });
    await udivRepo.save({ id: '11111111-1111-1111-1111-111111111101', userId: 1, division: 'greenwave' });

    // 2. GW Manager (GreenWave only, with finance permissions and global warehouse access)
    const uGwMgr = await userRepo.save({
      id: 2,
      email: 'gw-mgr@test.local',
      fullName: 'GW Manager',
      password: passwordHash,
      status: 'active',
      role: 'manager',
    });
    await udivRepo.save({ id: '11111111-1111-1111-1111-111111111102', userId: 2, division: 'greenwave' });
    await uwRepo.save({ id: '22222222-1111-1111-1111-111111111102', userId: 2, warehouseId: WAREHOUSE_CGY });

    // 3. GW Staff (GreenWave only, no finance permissions)
    const uGwStaff = await userRepo.save({
      id: 3,
      email: 'gw-staff@test.local',
      fullName: 'GW Staff',
      password: passwordHash,
      status: 'active',
      role: 'staff',
    });
    await udivRepo.save({ id: '11111111-1111-1111-1111-111111111103', userId: 3, division: 'greenwave' });
    await uwRepo.save({ id: '22222222-1111-1111-1111-111111111103', userId: 3, warehouseId: WAREHOUSE_CGY });

    // 4. Healthcare Admin (Healthcare ONLY)
    const uHcAdmin = await userRepo.save({
      id: 4,
      email: 'hc-admin@test.local',
      fullName: 'HC Admin',
      password: passwordHash,
      status: 'active',
      role: 'admin',
    });
    await udivRepo.save({ id: '11111111-1111-1111-1111-111111111104', userId: 4, division: 'healthcare' });

    // 5. Healthcare Manager (Healthcare ONLY, has manager role)
    const uHcMgr = await userRepo.save({
      id: 5,
      email: 'hc-mgr@test.local',
      fullName: 'HC Manager',
      password: passwordHash,
      status: 'active',
      role: 'manager',
    });
    await udivRepo.save({ id: '11111111-1111-1111-1111-111111111105', userId: 5, division: 'healthcare' });
    await uwRepo.save({ id: '22222222-1111-1111-1111-111111111105', userId: 5, warehouseId: WAREHOUSE_CGY });

    // 6. Healthcare Staff (Healthcare ONLY)
    const uHcStaff = await userRepo.save({
      id: 6,
      email: 'hc-staff@test.local',
      fullName: 'HC Staff',
      password: passwordHash,
      status: 'active',
      role: 'staff',
    });
    await udivRepo.save({ id: '11111111-1111-1111-1111-111111111106', userId: 6, division: 'healthcare' });

    // 7. Dual Admin (both divisions)
    const uDual = await userRepo.save({
      id: 7,
      email: 'dual-admin@test.local',
      fullName: 'Dual Admin',
      password: passwordHash,
      status: 'active',
      role: 'admin',
    });
    await udivRepo.save({ id: '11111111-1111-1111-1111-111111111107', userId: 7, division: 'greenwave' });
    await udivRepo.save({ id: '11111111-1111-1111-1111-111111111108', userId: 7, division: 'healthcare' });

    // Seed a Recycling Invoice and Payment
    const invRepo = dataSource.getRepository(Invoice);
    await invRepo.save({
      id: SAMPLE_INVOICE_ID,
      invoiceNumber: '10001',
      invoiceDate: '2026-09-17',
      division: 'recycling',
      warehouseId: WAREHOUSE_CGY,
      subtotal: '100.00',
      taxTotal: '5.00',
      total: '105.00',
      currency: 'CAD',
      status: 'final',
      paymentStatus: 'paid',
      createdBy: 1,
    });

    const paymentRepo = dataSource.getRepository(Payment);
    await paymentRepo.save({
      id: SAMPLE_PAYMENT_ID,
      invoiceId: SAMPLE_INVOICE_ID,
      provider: 'stripe',
      status: 'SUCCEEDED',
      currency: 'CAD',
      amount: '105.00',
      amountMinor: 10500,
      warehouseId: WAREHOUSE_CGY,
      createdBy: 1,
    });

    // Seed a Chart of Accounts entry
    const ledgerRepo = dataSource.getRepository(LedgerAccount);
    await ledgerRepo.save({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      code: '1010',
      name: 'Operating Bank Account',
      type: 'ASSET',
      normalBalance: 'DEBIT',
      isActive: true,
    });

    // Obtain tokens
    gwAdminToken = await loginAs('gw-admin@test.local');
    gwManagerToken = await loginAs('gw-mgr@test.local');
    gwStaffToken = await loginAs('gw-staff@test.local');
    hcAdminToken = await loginAs('hc-admin@test.local');
    hcManagerToken = await loginAs('hc-mgr@test.local');
    hcStaffToken = await loginAs('hc-staff@test.local');
    dualAdminToken = await loginAs('dual-admin@test.local');
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('1. GreenWave Recycling Admin Access', () => {
    it('allows GET /api/payments', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/payments')
        .set('Authorization', `Bearer ${gwAdminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    });

    it('allows GET /api/accounting/accounts', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/accounting/accounts')
        .set('Authorization', `Bearer ${gwAdminToken}`);
      expect(res.status).toBe(200);
    });

    it('allows GET /api/banking/accounts', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/banking/accounts')
        .set('Authorization', `Bearer ${gwAdminToken}`);
      expect(res.status).toBe(200);
    });

    it('allows GET /api/payables/vendors', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/payables/vendors')
        .set('Authorization', `Bearer ${gwAdminToken}`);
      expect(res.status).toBe(200);
    });

    it('allows GET /api/payments/:id for a valid Recycling payment', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/payments/${SAMPLE_PAYMENT_ID}`)
        .set('Authorization', `Bearer ${gwAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.payment.id).toBe(SAMPLE_PAYMENT_ID);
    });
  });

  describe('2. GreenWave Recycling Authorized Manager Access', () => {
    it('allows GET /api/payments for authorized manager', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/payments')
        .set('Authorization', `Bearer ${gwManagerToken}`);
      expect(res.status).toBe(200);
    });

    it('allows GET /api/accounting/accounts for manager with warehouses:global_access', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/accounting/accounts')
        .set('Authorization', `Bearer ${gwManagerToken}`);
      expect(res.status).toBe(200);
    });
  });

  describe('3. GreenWave Recycling Staff Without Permissions', () => {
    it('rejects GET /api/payments with 403 (missing permission)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/payments')
        .set('Authorization', `Bearer ${gwStaffToken}`);
      expect(res.status).toBe(403);
    });

    it('rejects GET /api/accounting/accounts with 403 (missing role/permission)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/accounting/accounts')
        .set('Authorization', `Bearer ${gwStaffToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('4. Healthcare Admin Denial (Even with admin role)', () => {
    it('FORBIDS GET /api/payments for Healthcare admin (403)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/payments')
        .set('Authorization', `Bearer ${hcAdminToken}`);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/strictly restricted to the GreenWave Recycling division/i);
    });

    it('FORBIDS GET /api/accounting/accounts for Healthcare admin (403)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/accounting/accounts')
        .set('Authorization', `Bearer ${hcAdminToken}`);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/strictly restricted to the GreenWave Recycling division/i);
    });

    it('FORBIDS GET /api/banking/accounts for Healthcare admin (403)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/banking/accounts')
        .set('Authorization', `Bearer ${hcAdminToken}`);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/strictly restricted to the GreenWave Recycling division/i);
    });

    it('FORBIDS GET /api/payables/vendors for Healthcare admin (403)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/payables/vendors')
        .set('Authorization', `Bearer ${hcAdminToken}`);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/strictly restricted to the GreenWave Recycling division/i);
    });
  });

  describe('5. Healthcare Manager Denial', () => {
    it('FORBIDS GET /api/payments for Healthcare manager (403)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/payments')
        .set('Authorization', `Bearer ${hcManagerToken}`);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/strictly restricted to the GreenWave Recycling division/i);
    });

    it('FORBIDS GET /api/accounting/accounts for Healthcare manager (403)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/accounting/accounts')
        .set('Authorization', `Bearer ${hcManagerToken}`);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/strictly restricted to the GreenWave Recycling division/i);
    });
  });

  describe('6. Direct API and IDOR Defense: Supplying Recycling UUID by Healthcare User', () => {
    it('Healthcare admin supplying Recycling payment UUID gets 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/payments/${SAMPLE_PAYMENT_ID}`)
        .set('Authorization', `Bearer ${hcAdminToken}`);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/strictly restricted to the GreenWave Recycling division/i);
    });

    it('Healthcare staff supplying Recycling payment UUID gets 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/payments/${SAMPLE_PAYMENT_ID}`)
        .set('Authorization', `Bearer ${hcStaffToken}`);
      expect(res.status).toBe(403);
    });

    it('Healthcare admin attempting refund on Recycling payment gets 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/payments/${SAMPLE_PAYMENT_ID}/refunds`)
        .set('Authorization', `Bearer ${hcAdminToken}`)
        .send({ amountMinor: 1000, reason: 'requested_by_customer' });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/strictly restricted to the GreenWave Recycling division/i);
    });

    it('Healthcare admin attempting Stripe sync gets 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/payments/stripe/sync')
        .set('Authorization', `Bearer ${hcAdminToken}`);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/strictly restricted to the GreenWave Recycling division/i);
    });
  });

  describe('7. Active Division Switching Cannot Bypass Server Authorization', () => {
    it('Healthcare user sending X-Division: greenwave header is rejected (403)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/payments')
        .set('Authorization', `Bearer ${hcAdminToken}`)
        .set('X-Division', 'greenwave');
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/strictly restricted to the GreenWave Recycling division/i);
    });

    it('Dual-division admin sending X-Division: healthcare header gets 403 on financial API', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/payments')
        .set('Authorization', `Bearer ${dualAdminToken}`)
        .set('X-Division', 'healthcare');
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/strictly restricted to the GreenWave Recycling division/i);
    });

    it('Dual-division admin with active division recycling / greenwave gets 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/payments')
        .set('Authorization', `Bearer ${dualAdminToken}`)
        .set('X-Division', 'recycling');
      expect(res.status).toBe(200);
    });
  });
  it.each([undefined, 'invalid', ''])('denies dual actor missing/malformed context %p', async (division) => {
    const req = request(app.getHttpServer()).get('/api/accounting/accounts').set('Authorization', `Bearer ${dualAdminToken}`);
    if (division !== undefined) req.set('X-Division', division);
    await req.expect(403);
  });
  it('denies direct payment UUID while Healthcare is active', async () => {
    await request(app.getHttpServer()).get(`/api/payments/${SAMPLE_PAYMENT_ID}`).set('Authorization', `Bearer ${dualAdminToken}`).set('X-Division', 'healthcare').expect(403);
  });

});
