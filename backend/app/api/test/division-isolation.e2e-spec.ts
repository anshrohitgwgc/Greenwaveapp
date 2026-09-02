/* eslint-disable */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AuditModule } from '../src/audit/audit.module';
import { AuditEvent } from '../src/audit/entities/audit-event.entity';
import { AuthModule } from '../src/auth/auth.module';
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
import { Material } from '../src/materials/entities/material.entity';
import { MaterialsModule } from '../src/materials/materials.module';
import { PhotoAsset } from '../src/photos/entities/photo-asset.entity';
import { RedisService } from '../src/redis/redis.service';
import { Permission } from '../src/roles/entities/permission.entity';
import { Role } from '../src/roles/entities/role.entity';
import { RolePermission } from '../src/roles/entities/role-permission.entity';
import { UserRole } from '../src/roles/entities/user-role.entity';
import { RolesModule } from '../src/roles/roles.module';
import { StorageService } from '../src/storage/storage.service';
import { User } from '../src/users/entities/user.entity';
import { UsersModule } from '../src/users/users.module';
import { UserWarehouse } from '../src/warehouses/entities/user-warehouse.entity';
import { Warehouse } from '../src/warehouses/entities/warehouse.entity';
import { WarehousesModule } from '../src/warehouses/warehouses.module';

/**
 * Cross-division authorization & IDOR matrix.
 *
 * Frontend hiding is not authorization, so every assertion here goes straight
 * at the HTTP API with a real token and a known object id. The question each
 * case asks is: "if the attacker already knows the UUID, does the server still
 * say no?"
 *
 * Runs entirely against in-memory sqlite. No production or staging data is
 * touched, and no production credentials are used.
 */
describe('E2E Security: Cross-division authorization & IDOR', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let dataSource: DataSource;

  const WAREHOUSE_CGY = '22222222-2222-4222-8222-222222222222';
  const WAREHOUSE_ON = '33333333-3333-4333-8333-333333333333';
  const WAREHOUSE_MR = '44444444-4444-4444-8444-444444444444';

  // Products, one per warehouse x division combination.
  const MAT = {
    cgyGw: 'aaaaaaaa-0001-4aaa-8aaa-aaaaaaaaaaaa',
    cgyHc: 'aaaaaaaa-0002-4aaa-8aaa-aaaaaaaaaaaa',
    onGw: 'aaaaaaaa-0003-4aaa-8aaa-aaaaaaaaaaaa',
    onHc: 'aaaaaaaa-0004-4aaa-8aaa-aaaaaaaaaaaa',
    mrGw: 'aaaaaaaa-0005-4aaa-8aaa-aaaaaaaaaaaa',
    mrHc: 'aaaaaaaa-0006-4aaa-8aaa-aaaaaaaaaaaa',
  };
  const CUST = {
    gw: 'bbbbbbbb-0001-4bbb-8bbb-bbbbbbbbbbbb',
    hc: 'bbbbbbbb-0002-4bbb-8bbb-bbbbbbbbbbbb',
  };
  const INV = {
    gw: 'cccccccc-0001-4ccc-8ccc-cccccccccccc',
    hc: 'cccccccc-0002-4ccc-8ccc-cccccccccccc',
  };
  const TX = {
    gw: 'dddddddd-0001-4ddd-8ddd-dddddddddddd',
    hc: 'dddddddd-0002-4ddd-8ddd-dddddddddddd',
  };
  const CONT = {
    gw: 'ffffffff-0001-4fff-8fff-ffffffffffff',
    hc: 'ffffffff-0002-4fff-8fff-ffffffffffff',
  };

  // Tokens
  let gwAdminToken: string; // admin, GreenWave only, all warehouses
  let hcAdminToken: string; // admin, Healthcare only, all warehouses
  let bothAdminToken: string; // admin, both divisions, all warehouses
  let gwCalgaryStaffToken: string; // staff, GreenWave only, Calgary only
  let noDivisionStaffToken: string; // staff, NO divisions, Calgary
  let hcOntarioManagerToken: string; // manager, Healthcare only, Ontario only

  let noDivisionUserId: number;
  let victimUserId: number;

  const login = async (email: string) => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'Password123!' });
    if (!res.body?.access_token) {
      throw new Error(
        `login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`,
      );
    }
    return res.body.access_token as string;
  };

  beforeAll(async () => {
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
          synchronize: true,
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
        AuditModule,
      ],
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
      .overrideProvider(StorageService)
      .useValue({
        presignedGetUrl: jest.fn().mockResolvedValue('https://example/x.jpg'),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    dataSource = moduleRef.get(DataSource);

    // Legacy counter table for the non-PostgreSQL invoice-numbering fallback.
    await dataSource.query(
      `CREATE TABLE IF NOT EXISTS invoice_number_counter (id INT PRIMARY KEY, next_value BIGINT)`,
    );

    await dataSource.getRepository(Warehouse).save([
      { id: WAREHOUSE_CGY, name: 'Calgary, AB', code: 'CGY', active: true },
      { id: WAREHOUSE_ON, name: 'Ontario', code: 'ON', active: true },
      { id: WAREHOUSE_MR, name: 'Maple Ridge, BC', code: 'MR', active: true },
    ]);

    // Six warehouse x division product combinations.
    await dataSource.getRepository(Material).save([
      { id: MAT.cgyGw, name: 'CGY Cardboard', unit: 'kg', division: 'recycling', warehouseId: WAREHOUSE_CGY, active: true },
      { id: MAT.cgyHc, name: 'CGY Gloves', unit: 'box', division: 'healthcare', warehouseId: WAREHOUSE_CGY, active: true },
      { id: MAT.onGw, name: 'ON Cardboard', unit: 'kg', division: 'recycling', warehouseId: WAREHOUSE_ON, active: true },
      { id: MAT.onHc, name: 'ON Gowns', unit: 'box', division: 'healthcare', warehouseId: WAREHOUSE_ON, active: true },
      { id: MAT.mrGw, name: 'MR Cardboard', unit: 'kg', division: 'recycling', warehouseId: WAREHOUSE_MR, active: true },
      { id: MAT.mrHc, name: 'MR Masks', unit: 'box', division: 'healthcare', warehouseId: WAREHOUSE_MR, active: true },
    ]);

    await dataSource.getRepository(Customer).save([
      { id: CUST.gw, name: 'Recycling Customer Ltd', division: 'recycling', warehouseId: WAREHOUSE_CGY },
      { id: CUST.hc, name: 'Healthcare Customer Ltd', division: 'healthcare', warehouseId: WAREHOUSE_CGY },
    ]);

    // Users -------------------------------------------------------------
    const passwordHash = await bcrypt.hash('Password123!', 12);
    const userRepo = dataSource.getRepository(User);
    const divRepo = dataSource.getRepository(UserDivision);
    const whRepo = dataSource.getRepository(UserWarehouse);

    const mkUser = async (
      fullName: string,
      email: string,
      role: string,
      divisions: string[],
      warehouseIds: string[] | 'global',
    ) => {
      const u = await userRepo.save({ fullName, email, password: passwordHash, role, status: 'active' });
      for (const division of divisions) {
        await divRepo.save({ userId: u.id, division, createdBy: null });
      }
      if (warehouseIds !== 'global') {
        for (const warehouseId of warehouseIds) {
          await whRepo.save({ id: `${u.id}-${warehouseId}`.slice(0, 36), userId: u.id, warehouseId, createdBy: null });
        }
      }
      return u;
    };

    // Admins get warehouses:global_access from the default role permissions,
    // so their warehouse reach is global and DIVISION is the only variable.
    const gwAdmin = await mkUser('GreenWave Admin', 'gw_admin@greenwave.test', 'admin', ['greenwave'], 'global');
    const hcAdmin = await mkUser('Healthcare Admin', 'hc_admin@greenwave.test', 'admin', ['healthcare'], 'global');
    const bothAdmin = await mkUser('Both Admin', 'both_admin@greenwave.test', 'admin', ['greenwave', 'healthcare'], 'global');
    await mkUser('GW Calgary Staff', 'gw_cgy_staff@greenwave.test', 'staff', ['greenwave'], [WAREHOUSE_CGY]);
    const noDiv = await mkUser('No Division Staff', 'nodiv@greenwave.test', 'staff', [], [WAREHOUSE_CGY]);
    await mkUser('HC Ontario Manager', 'hc_on_mgr@greenwave.test', 'manager', ['healthcare'], [WAREHOUSE_ON]);
    const victim = await mkUser('Victim Staff', 'victim@greenwave.test', 'staff', [], [WAREHOUSE_CGY]);

    noDivisionUserId = noDiv.id;
    victimUserId = victim.id;

    gwAdminToken = await login('gw_admin@greenwave.test');
    hcAdminToken = await login('hc_admin@greenwave.test');
    bothAdminToken = await login('both_admin@greenwave.test');
    gwCalgaryStaffToken = await login('gw_cgy_staff@greenwave.test');
    noDivisionStaffToken = await login('nodiv@greenwave.test');
    hcOntarioManagerToken = await login('hc_on_mgr@greenwave.test');

    // Business records created through the API so they go through the real
    // authorization + persistence path.
    await dataSource.getRepository(InventoryTransaction).save([
      { id: TX.gw, warehouseId: WAREHOUSE_CGY, materialId: MAT.cgyGw, type: 'inbound', unitType: 'pallet', division: 'recycling', xl: '10', l: '0', m: '0', s: '0', total: '10', createdBy: gwAdmin.id },
      { id: TX.hc, warehouseId: WAREHOUSE_CGY, materialId: MAT.cgyHc, type: 'inbound', unitType: 'box', division: 'healthcare', xl: '0', l: '5', m: '0', s: '0', total: '5', createdBy: hcAdmin.id },
    ]);
    await dataSource.getRepository(Container).save([
      { id: CONT.gw, warehouseId: WAREHOUSE_CGY, materialId: MAT.cgyGw, orderNumber: 'GW-ORDER-1', unitType: 'pallet', division: 'recycling', xl: '10', l: '0', m: '0', s: '0', total: '10', status: 'received', createdBy: gwAdmin.id },
      { id: CONT.hc, warehouseId: WAREHOUSE_CGY, materialId: MAT.cgyHc, orderNumber: 'HC-ORDER-1', unitType: 'box', division: 'healthcare', xl: '0', l: '5', m: '0', s: '0', total: '5', status: 'received', createdBy: hcAdmin.id },
    ]);
    await dataSource.getRepository(Invoice).save([
      { id: INV.gw, invoiceNumber: 'TEST-GW-1', invoiceDate: '2026-09-01', division: 'recycling', warehouseId: WAREHOUSE_CGY, customerId: CUST.gw, subtotal: '100', discountTotal: '0', taxRate: '0', taxTotal: '0', total: '100', status: 'final', currency: 'CAD', paymentStatus: 'unpaid', createdBy: gwAdmin.id },
      { id: INV.hc, invoiceNumber: 'TEST-HC-1', invoiceDate: '2026-09-01', division: 'healthcare', warehouseId: WAREHOUSE_CGY, customerId: CUST.hc, subtotal: '200', discountTotal: '0', taxRate: '0', taxTotal: '0', total: '200', status: 'final', currency: 'CAD', paymentStatus: 'unpaid', createdBy: hcAdmin.id },
    ]);

    void bothAdmin;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  const get = (path: string, token: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);

  // ====================================================================
  // 1-4. The core allow/deny matrix
  // ====================================================================
  describe('1-4. Core division access matrix', () => {
    it('1. GreenWave user -> GreenWave resource = ALLOWED', async () => {
      const res = await get(`/materials/${MAT.cgyGw}`, gwAdminToken).expect(200);
      expect(res.body.id).toBe(MAT.cgyGw);
    });

    it('2. GreenWave user -> Healthcare resource = DENIED (403)', async () => {
      await get(`/materials/${MAT.cgyHc}`, gwAdminToken).expect(403);
    });

    it('3. Healthcare user -> Healthcare resource = ALLOWED', async () => {
      const res = await get(`/materials/${MAT.cgyHc}`, hcAdminToken).expect(200);
      expect(res.body.id).toBe(MAT.cgyHc);
    });

    it('4. Healthcare user -> GreenWave resource = DENIED (403)', async () => {
      await get(`/materials/${MAT.cgyGw}`, hcAdminToken).expect(403);
    });

    it('a both-divisions admin can reach both', async () => {
      await get(`/materials/${MAT.cgyGw}`, bothAdminToken).expect(200);
      await get(`/materials/${MAT.cgyHc}`, bothAdminToken).expect(200);
    });
  });

  // ====================================================================
  // 5-6. Direct-object (IDOR) access by UUID across every scoped resource
  // ====================================================================
  describe('5-6. Direct UUID access is blocked in both directions', () => {
    const idorCases: Array<[string, (id: string) => string, string, string]> = [
      ['material', (id) => `/materials/${id}`, MAT.cgyGw, MAT.cgyHc],
      ['inventory transaction', (id) => `/inventory/transactions/${id}`, TX.gw, TX.hc],
      ['customer', (id) => `/customers/${id}`, CUST.gw, CUST.hc],
      ['invoice', (id) => `/invoices/${id}`, INV.gw, INV.hc],
    ];

    for (const [label, path, gwId, hcId] of idorCases) {
      it(`5. GreenWave-only user knowing a Healthcare ${label} UUID still gets 403`, async () => {
        await get(path(hcId), gwAdminToken).expect(403);
      });

      it(`6. Healthcare-only user knowing a GreenWave ${label} UUID still gets 403`, async () => {
        await get(path(gwId), hcAdminToken).expect(403);
      });

      it(`   ...and each can still read their own ${label}`, async () => {
        await get(path(gwId), gwAdminToken).expect(200);
        await get(path(hcId), hcAdminToken).expect(200);
      });
    }

    it('blocks cross-division UPDATE of a product by UUID (403)', async () => {
      await request(app.getHttpServer())
        .patch(`/materials/${MAT.cgyHc}`)
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .send({ name: 'Hijacked' })
        .expect(403);
    });

    it('blocks cross-division DELETE of a product by UUID (403), even for an admin', async () => {
      await request(app.getHttpServer())
        .delete(`/materials/${MAT.mrHc}`)
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .expect(403);
    });

    it('blocks cross-division UPDATE of a customer by UUID (403)', async () => {
      await request(app.getHttpServer())
        .patch(`/customers/${CUST.hc}`)
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .send({ name: 'Hijacked Customer' })
        .expect(403);
    });

    it('blocks cross-division UPDATE of an invoice by UUID (403)', async () => {
      await request(app.getHttpServer())
        .patch(`/invoices/${INV.hc}`)
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .send({ notes: 'Hijacked invoice' })
        .expect(403);
    });

    it('blocks cross-division DUPLICATE of an invoice by UUID (403)', async () => {
      await request(app.getHttpServer())
        .post(`/invoices/${INV.hc}/duplicate`)
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .expect(403);
    });

    it('the product delete contract is unchanged for an authorized division (204 / 404)', async () => {
      // 404 for an unknown id ...
      await request(app.getHttpServer())
        .delete('/materials/99999999-9999-4999-8999-999999999999')
        .set('Authorization', `Bearer ${bothAdminToken}`)
        .expect(404);
      // ... 204 for a real, unreferenced, authorized product.
      await request(app.getHttpServer())
        .delete(`/materials/${MAT.mrHc}`)
        .set('Authorization', `Bearer ${bothAdminToken}`)
        .expect(204);
    });
  });

  // ====================================================================
  // Query-parameter tampering
  // ====================================================================
  describe('Query-parameter tampering (?division=)', () => {
    it('rejects ?division=healthcare from a GreenWave-only user (403)', async () => {
      await get('/materials?division=healthcare', gwAdminToken).expect(403);
      await get('/inventory/balances?division=healthcare', gwAdminToken).expect(403);
      await get('/inventory/transactions?division=healthcare', gwAdminToken).expect(403);
      await get('/containers?division=healthcare', gwAdminToken).expect(403);
      await get('/customers?division=healthcare', gwAdminToken).expect(403);
      await get('/invoices?division=healthcare', gwAdminToken).expect(403);
    });

    it('rejects ?division=recycling (the legacy alias) from a Healthcare-only user (403)', async () => {
      await get('/materials?division=recycling', hcAdminToken).expect(403);
      await get('/materials?division=greenwave', hcAdminToken).expect(403);
      await get('/invoices?division=greenwave', hcAdminToken).expect(403);
    });

    it('rejects an invented division with 400, never a silent fallback', async () => {
      await get('/materials?division=finance', bothAdminToken).expect(400);
      await get('/materials?division=', bothAdminToken).expect(200);
    });

    it('an unfiltered list never leaks the other division', async () => {
      const gw = await get('/materials', gwAdminToken).expect(200);
      const names = gw.body.map((m: any) => m.name);
      expect(names).toContain('CGY Cardboard');
      expect(names).not.toContain('CGY Gloves');
      expect(gw.body.every((m: any) => m.division === 'recycling')).toBe(true);

      const hc = await get('/materials', hcAdminToken).expect(200);
      expect(hc.body.every((m: any) => m.division === 'healthcare')).toBe(true);
      expect(hc.body.map((m: any) => m.name)).not.toContain('CGY Cardboard');
    });

    it('unfiltered invoices and customers are division-scoped too', async () => {
      const gwInv = await get('/invoices', gwAdminToken).expect(200);
      expect(gwInv.body.map((i: any) => i.invoiceNumber)).toEqual(['TEST-GW-1']);

      const hcInv = await get('/invoices', hcAdminToken).expect(200);
      expect(hcInv.body.map((i: any) => i.invoiceNumber)).toEqual(['TEST-HC-1']);

      const gwCust = await get('/customers', gwAdminToken).expect(200);
      expect(gwCust.body.map((c: any) => c.name)).toEqual(['Recycling Customer Ltd']);

      const hcCust = await get('/customers', hcAdminToken).expect(200);
      expect(hcCust.body.map((c: any) => c.name)).toEqual(['Healthcare Customer Ltd']);
    });

    it('unfiltered transactions and containers are division-scoped too', async () => {
      const gwTx = await get('/inventory/transactions', gwAdminToken).expect(200);
      expect(gwTx.body.every((t: any) => t.division === 'recycling')).toBe(true);
      expect(gwTx.body.map((t: any) => t.id)).not.toContain(TX.hc);

      const hcCont = await get('/containers', hcAdminToken).expect(200);
      expect(hcCont.body.map((c: any) => c.orderNumber)).toEqual(['HC-ORDER-1']);
    });
  });

  // ====================================================================
  // 9. A new account has no division access
  // ====================================================================
  describe('9. Newly created staff receive no unintended division access', () => {
    it('a user with no grants sees an empty list everywhere, not everything', async () => {
      for (const path of [
        '/materials',
        '/inventory/balances',
        '/inventory/transactions',
        '/containers',
      ]) {
        const res = await get(path, noDivisionStaffToken).expect(200);
        expect(res.body).toEqual([]);
      }
    });

    it('a user with no grants is denied every specific division', async () => {
      await get('/materials?division=greenwave', noDivisionStaffToken).expect(403);
      await get('/materials?division=healthcare', noDivisionStaffToken).expect(403);
    });

    it('a user with no grants cannot read any object by UUID', async () => {
      await get(`/materials/${MAT.cgyGw}`, noDivisionStaffToken).expect(403);
      await get(`/materials/${MAT.cgyHc}`, noDivisionStaffToken).expect(403);
      await get(`/inventory/transactions/${TX.gw}`, noDivisionStaffToken).expect(403);
    });

    it('POST /users creates staff with NO divisions unless explicitly given', async () => {
      const res = await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${bothAdminToken}`)
        .send({
          fullName: 'Fresh Hire',
          email: 'fresh.hire@greenwave.test',
          password: 'Password123!',
          role: 'staff',
        })
        .expect(201);

      expect(res.body.divisions).toEqual([]);

      const check = await get(`/users/${res.body.id}/divisions`, bothAdminToken).expect(200);
      expect(check.body).toEqual([]);
    });

    it('/divisions reports exactly what the caller holds, so the UI cannot offer more', async () => {
      expect((await get('/divisions', gwAdminToken).expect(200)).body).toEqual([
        { key: 'greenwave', label: 'GreenWave Recycling' },
      ]);
      expect((await get('/divisions', hcAdminToken).expect(200)).body).toEqual([
        { key: 'healthcare', label: 'Healthcare' },
      ]);
      expect((await get('/divisions', bothAdminToken).expect(200)).body).toHaveLength(2);
      expect((await get('/divisions', noDivisionStaffToken).expect(200)).body).toEqual([]);
    });
  });

  // ====================================================================
  // 7-8. Who may change division assignment
  // ====================================================================
  describe('7-8. Division assignment authorization', () => {
    it('7. a normal staff member cannot grant themselves a division (403)', async () => {
      await request(app.getHttpServer())
        .put(`/users/${noDivisionUserId}/divisions`)
        .set('Authorization', `Bearer ${noDivisionStaffToken}`)
        .send({ divisions: ['greenwave'] })
        .expect(403);

      // ...and nothing changed
      const after = await get(`/users/${noDivisionUserId}/divisions`, bothAdminToken).expect(200);
      expect(after.body).toEqual([]);
    });

    it('7. a manager cannot modify another user\'s division access (403)', async () => {
      await request(app.getHttpServer())
        .put(`/users/${victimUserId}/divisions`)
        .set('Authorization', `Bearer ${hcOntarioManagerToken}`)
        .send({ divisions: ['healthcare'] })
        .expect(403);
    });

    it('7. a staff member cannot widen their own access via PATCH /users/:id either', async () => {
      await request(app.getHttpServer())
        .patch(`/users/${noDivisionUserId}`)
        .set('Authorization', `Bearer ${noDivisionStaffToken}`)
        .send({ divisions: ['greenwave', 'healthcare'] })
        .expect(403);
    });

    it('7. a GreenWave-only ADMIN cannot grant Healthcare to anyone (403)', async () => {
      await request(app.getHttpServer())
        .put(`/users/${victimUserId}/divisions`)
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .send({ divisions: ['healthcare'] })
        .expect(403);
    });

    it('7. a GreenWave-only ADMIN cannot escalate themselves into Healthcare (403)', async () => {
      const me = await get('/users/me', gwAdminToken).expect(200);
      await request(app.getHttpServer())
        .put(`/users/${me.body.id}/divisions`)
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .send({ divisions: ['greenwave', 'healthcare'] })
        .expect(403);

      const still = await get('/divisions', gwAdminToken).expect(200);
      expect(still.body).toEqual([{ key: 'greenwave', label: 'GreenWave Recycling' }]);
    });

    it('8. an admin CAN assign a division they themselves hold', async () => {
      const res = await request(app.getHttpServer())
        .put(`/users/${victimUserId}/divisions`)
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .send({ divisions: ['greenwave'] })
        .expect(200);
      expect(res.body).toEqual([{ key: 'greenwave', label: 'GreenWave Recycling' }]);
    });

    it('8. a both-divisions admin can assign both, and can revoke everything', async () => {
      const granted = await request(app.getHttpServer())
        .put(`/users/${victimUserId}/divisions`)
        .set('Authorization', `Bearer ${bothAdminToken}`)
        .send({ divisions: ['greenwave', 'healthcare'] })
        .expect(200);
      expect(granted.body).toHaveLength(2);

      const revoked = await request(app.getHttpServer())
        .put(`/users/${victimUserId}/divisions`)
        .set('Authorization', `Bearer ${bothAdminToken}`)
        .send({ divisions: [] })
        .expect(200);
      expect(revoked.body).toEqual([]);
    });

    it('rejects an invented division on assignment (400)', async () => {
      await request(app.getHttpServer())
        .put(`/users/${victimUserId}/divisions`)
        .set('Authorization', `Bearer ${bothAdminToken}`)
        .send({ divisions: ['finance'] })
        .expect(400);
    });

    it('a revoked division takes effect on the very next request, not at token expiry', async () => {
      const res = await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${bothAdminToken}`)
        .send({
          fullName: 'Temp GW User',
          email: 'temp.gw@greenwave.test',
          password: 'Password123!',
          role: 'staff',
          divisions: ['greenwave'],
          warehouseIds: [WAREHOUSE_CGY],
        })
        .expect(201);

      const tempToken = await login('temp.gw@greenwave.test');
      await get(`/materials/${MAT.cgyGw}`, tempToken).expect(200);

      await request(app.getHttpServer())
        .put(`/users/${res.body.id}/divisions`)
        .set('Authorization', `Bearer ${bothAdminToken}`)
        .send({ divisions: [] })
        .expect(200);

      // Same token, immediately denied.
      await get(`/materials/${MAT.cgyGw}`, tempToken).expect(403);
    });
  });

  // ====================================================================
  // 10. warehouse x division isolation
  // ====================================================================
  describe('10. Warehouse + division combinations stay isolated', () => {
    it('a Calgary GreenWave staff member sees only Calgary GreenWave products', async () => {
      const res = await get('/materials', gwCalgaryStaffToken).expect(200);
      const names = res.body.map((m: any) => m.name);
      expect(names).toEqual(['CGY Cardboard']);
      expect(names).not.toContain('CGY Gloves'); // right warehouse, wrong division
      expect(names).not.toContain('ON Cardboard'); // right division, wrong warehouse
      expect(names).not.toContain('ON Gowns'); // wrong on both axes
    });

    it('an Ontario Healthcare manager sees only Ontario Healthcare products', async () => {
      const res = await get('/materials', hcOntarioManagerToken).expect(200);
      expect(res.body.map((m: any) => m.name)).toEqual(['ON Gowns']);
    });

    it('the warehouse 403 still fires ahead of division scoping', async () => {
      // Calgary-only staff asking for Ontario must get 403, not a quietly
      // empty list that hides the authorization failure.
      await get(`/materials?warehouseId=${WAREHOUSE_ON}`, gwCalgaryStaffToken).expect(403);
      await get(`/inventory/balances?warehouseId=${WAREHOUSE_ON}`, gwCalgaryStaffToken).expect(403);
      await get(`/customers?warehouseId=${WAREHOUSE_ON}`, hcOntarioManagerToken).expect(200);
    });

    it('every warehouse x division cell is reachable only by an actor holding both axes', async () => {
      // The both-divisions global admin can enumerate all six cells.
      const all = await get('/materials', bothAdminToken).expect(200);
      const byName = (n: string) => all.body.some((m: any) => m.name === n);
      expect(byName('CGY Cardboard')).toBe(true);
      expect(byName('CGY Gloves')).toBe(true);
      expect(byName('ON Cardboard')).toBe(true);
      expect(byName('ON Gowns')).toBe(true);
      expect(byName('MR Cardboard')).toBe(true);

      // But narrowing by warehouse still respects division.
      const cgyGwOnly = await get(
        `/materials?warehouseId=${WAREHOUSE_CGY}&division=greenwave`,
        bothAdminToken,
      ).expect(200);
      expect(cgyGwOnly.body.map((m: any) => m.name)).toContain('CGY Cardboard');
      expect(cgyGwOnly.body.map((m: any) => m.name)).not.toContain('CGY Gloves');
    });
  });

  // ====================================================================
  // Relationship leaks
  // ====================================================================
  describe('Relationships cannot be used as a cross-division side channel', () => {
    it('refuses to attach a Healthcare customer to a GreenWave invoice (403)', async () => {
      await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .send({
          invoiceDate: '2026-09-01',
          customerId: CUST.hc,
          warehouseId: WAREHOUSE_CGY,
          items: [{ description: 'x', quantity: 1, unitPrice: 10 }],
        })
        .expect(403);
    });

    it('refuses to re-point an existing invoice at a customer in the other division (403)', async () => {
      await request(app.getHttpServer())
        .patch(`/invoices/${INV.gw}`)
        .set('Authorization', `Bearer ${bothAdminToken}`)
        .send({ customerId: CUST.hc })
        .expect(403);
    });

    it('allows the correct same-division pairing', async () => {
      await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .send({
          invoiceDate: '2026-09-01',
          customerId: CUST.gw,
          warehouseId: WAREHOUSE_CGY,
          items: [{ description: 'x', quantity: 1, unitPrice: 10 }],
        })
        .expect(201);
    });

    it('refuses to move a product into a division the actor does not hold (403)', async () => {
      await request(app.getHttpServer())
        .patch(`/materials/${MAT.cgyGw}`)
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .send({ division: 'healthcare' })
        .expect(403);
    });
  });

  // ====================================================================
  // Writes
  // ====================================================================
  describe('Writes are division-scoped too', () => {
    it('refuses to create an inventory transaction in an unauthorized division (403)', async () => {
      await request(app.getHttpServer())
        .post('/inventory/transactions')
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .send({
          warehouseId: WAREHOUSE_CGY,
          materialId: MAT.cgyHc,
          type: 'inbound',
          division: 'healthcare',
          unitType: 'box',
          l: 3,
        })
        .expect(403);
    });

    it('refuses to create a container in an unauthorized division (403)', async () => {
      await request(app.getHttpServer())
        .post('/containers')
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .send({
          warehouseId: WAREHOUSE_CGY,
          division: 'healthcare',
          unitType: 'box',
          containerNumber: 'HIJACK-1',
          l: 1,
        })
        .expect(403);
    });

    it('refuses to create a product in an unauthorized division (403)', async () => {
      await request(app.getHttpServer())
        .post('/materials')
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .send({ name: 'Sneaky Gloves', division: 'healthcare', warehouseId: WAREHOUSE_CGY })
        .expect(403);
    });

    it('allows the same write inside the actor\'s own division', async () => {
      await request(app.getHttpServer())
        .post('/materials')
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .send({ name: 'Legit Cardboard', division: 'greenwave', warehouseId: WAREHOUSE_CGY })
        .expect(201);
    });

    it('requires a both-divisions actor to state the division rather than defaulting', async () => {
      await request(app.getHttpServer())
        .post('/customers')
        .set('Authorization', `Bearer ${bothAdminToken}`)
        .send({ name: 'Ambiguous Customer' })
        .expect(400);
    });

    it('lets a single-division actor omit it, since there is nothing to guess', async () => {
      const res = await request(app.getHttpServer())
        .post('/customers')
        .set('Authorization', `Bearer ${hcAdminToken}`)
        .send({ name: 'Implied Healthcare Customer' })
        .expect(201);
      expect(res.body.division).toBe('healthcare');
    });
  });

  // ====================================================================
  // Invoice numbering must be unaffected by any of this
  // ====================================================================
  describe('Invoice numbering is unchanged by division scoping', () => {
    it('numbering stays a single global series across divisions (no reuse, no per-division counter)', async () => {
      const mk = async (token: string, division: string) => {
        const res = await request(app.getHttpServer())
          .post('/invoices')
          .set('Authorization', `Bearer ${token}`)
          .send({
            invoiceDate: '2026-09-01',
            division,
            warehouseId: WAREHOUSE_CGY,
            items: [{ description: 'seq', quantity: 1, unitPrice: 1 }],
          })
          .expect(201);
        return Number(res.body.invoiceNumber);
      };

      const a = await mk(gwAdminToken, 'greenwave');
      const b = await mk(hcAdminToken, 'healthcare');
      const c = await mk(gwAdminToken, 'greenwave');

      // Strictly increasing and never reused, regardless of which division
      // the invoice belongs to.
      expect(b).toBeGreaterThan(a);
      expect(c).toBeGreaterThan(b);
      expect(new Set([a, b, c]).size).toBe(3);
    });

    it('a rejected cross-division create does not consume a number', async () => {
      const before = await request(app.getHttpServer())
        .get('/invoices/next-number')
        .set('Authorization', `Bearer ${bothAdminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${gwAdminToken}`)
        .send({
          invoiceDate: '2026-09-01',
          division: 'healthcare',
          warehouseId: WAREHOUSE_CGY,
          items: [{ description: 'x', quantity: 1, unitPrice: 1 }],
        })
        .expect(403);

      const after = await request(app.getHttpServer())
        .get('/invoices/next-number')
        .set('Authorization', `Bearer ${bothAdminToken}`)
        .expect(200);

      expect(after.body.nextNumber).toBe(before.body.nextNumber);
    });
  });
});
