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
import { Container } from '../src/inventory/entities/container.entity';
import { InventoryBalance } from '../src/inventory/entities/inventory-balance.entity';
import { InventoryTransaction } from '../src/inventory/entities/inventory-transaction.entity';
import { MaterialsModule } from '../src/materials/materials.module';
import { Material } from '../src/materials/entities/material.entity';
import { RedisService } from '../src/redis/redis.service';
import { Permission } from '../src/roles/entities/permission.entity';
import { Role } from '../src/roles/entities/role.entity';
import { RolePermission } from '../src/roles/entities/role-permission.entity';
import { UserRole } from '../src/roles/entities/user-role.entity';
import { RolesModule } from '../src/roles/roles.module';
import { User } from '../src/users/entities/user.entity';
import { UsersModule } from '../src/users/users.module';
import { UserDivision } from '../src/divisions/entities/user-division.entity';
import { UserWarehouse } from '../src/warehouses/entities/user-warehouse.entity';
import { Warehouse } from '../src/warehouses/entities/warehouse.entity';
import { WarehousesModule } from '../src/warehouses/warehouses.module';
import { grantDivisions } from './fixtures/divisions-test.helper';

/**
 * Frontend/backend contract coverage for PATCH /materials/:id.
 *
 * This suite deliberately mirrors production's global ValidationPipe
 * (whitelist AND forbidNonWhitelisted both true, per main.ts). The existing
 * delete suite runs with forbidNonWhitelisted:false, which cannot reproduce
 * the "property <x> should not exist" 400 that a stale DTO produces in
 * production — so the exact field-compatibility regression this guards
 * against was invisible to the e2e layer. Everything runs against in-memory
 * sqlite; no production or staging data is touched.
 */
describe('E2E Acceptance: Material update field compatibility (PATCH /materials/:id)', () => {
  jest.setTimeout(30000);

  let app: INestApplication;
  let dataSource: DataSource;

  const WAREHOUSE_CGY = '22222222-2222-4222-8222-222222222222';
  const WAREHOUSE_ON = '33333333-3333-4333-8333-333333333333';
  const WAREHOUSE_MR = '44444444-4444-4444-8444-444444444444';

  // One disposable product per warehouse+division combination.
  const P: Record<string, string> = {
    cgyRec: 'eeeeeeee-0001-4eee-8eee-eeeeeeeeeeee',
    cgyHc: 'eeeeeeee-0002-4eee-8eee-eeeeeeeeeeee',
    onRec: 'eeeeeeee-0003-4eee-8eee-eeeeeeeeeeee',
    onHc: 'eeeeeeee-0004-4eee-8eee-eeeeeeeeeeee',
    mrRec: 'eeeeeeee-0005-4eee-8eee-eeeeeeeeeeee',
    mrHc: 'eeeeeeee-0006-4eee-8eee-eeeeeeeeeeee',
  };

  let adminToken: string;
  let scopedAdminToken: string;

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
        RolesModule,
        MaterialsModule,
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
      .compile();

    app = moduleRef.createNestApplication();
    // Identical to src/main.ts — this is the whole point of the suite.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    dataSource = moduleRef.get(DataSource);

    await dataSource.getRepository(Warehouse).save([
      { id: WAREHOUSE_CGY, name: 'Calgary, AB', code: 'CGY', active: true },
      { id: WAREHOUSE_ON, name: 'Ontario', code: 'ON', active: true },
      { id: WAREHOUSE_MR, name: 'Maple Ridge', code: 'MR', active: true },
    ]);

    await dataSource.getRepository(Material).save([
      { id: P.cgyRec, name: 'CGY Recycling Item', unit: 'kg', division: 'recycling', warehouseId: WAREHOUSE_CGY, active: true },
      { id: P.cgyHc, name: 'CGY Healthcare Item', unit: 'kg', division: 'healthcare', warehouseId: WAREHOUSE_CGY, active: true },
      { id: P.onRec, name: 'ON Recycling Item', unit: 'kg', division: 'recycling', warehouseId: WAREHOUSE_ON, active: true },
      { id: P.onHc, name: 'ON Healthcare Item', unit: 'kg', division: 'healthcare', warehouseId: WAREHOUSE_ON, active: true },
      { id: P.mrRec, name: 'MR Recycling Item', unit: 'kg', division: 'recycling', warehouseId: WAREHOUSE_MR, active: true },
      { id: P.mrHc, name: 'MR Healthcare Item', unit: 'kg', division: 'healthcare', warehouseId: WAREHOUSE_MR, active: true },
    ]);

    const permRepo = dataSource.getRepository(Permission);
    const roleRepo = dataSource.getRepository(Role);
    const rolePermRepo = dataSource.getRepository(RolePermission);
    const seededPerms = await permRepo.save([
      { id: '1', key: 'materials:manage', description: 'Manage Materials' },
    ]);
    const adminRole = await roleRepo.save({ id: 'r-admin', name: 'admin' });
    await rolePermRepo.save(
      seededPerms.map((p) => ({ roleId: adminRole.id, permissionId: p.id })),
    );

    const passwordHash = await bcrypt.hash('TestPass123!', 10);
    const userRepo = dataSource.getRepository(User);
    const adminUser = await userRepo.save({
      fullName: 'Global Admin', email: 'admin@greenwave.test',
      password: passwordHash, role: 'admin', status: 'active',
    });
    const scopedAdminUser = await userRepo.save({
      fullName: 'Ontario-Scoped Admin', email: 'scoped-admin@greenwave.test',
      password: passwordHash, role: 'admin', status: 'active',
    });

    await dataSource.getRepository(UserWarehouse).save([
      { id: 'uw-1', userId: adminUser.id, warehouseId: WAREHOUSE_CGY },
      { id: 'uw-2', userId: adminUser.id, warehouseId: WAREHOUSE_ON },
      { id: 'uw-3', userId: adminUser.id, warehouseId: WAREHOUSE_MR },
      { id: 'uw-4', userId: scopedAdminUser.id, warehouseId: WAREHOUSE_ON },
    ]);

    const login = async (email: string) => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'TestPass123!' });
      return res.body.access_token;
    };

    // Hold division access constant: this suite asserts warehouse/role
    // behaviour, and every seeded user predates division access control.
    await grantDivisions(
      dataSource,
      (await dataSource.getRepository(User).find()).map((u) => u.id),
    );

    adminToken = await login('admin@greenwave.test');
    scopedAdminToken = await login('scoped-admin@greenwave.test');
  });

  afterAll(async () => {
    await app.close();
  });

  // ---- A/B/C: the fields the Edit Product form actually submits ----

  it('A. accepts description (the field production was rejecting)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/materials/${P.cgyRec}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ description: 'Updated via the Edit Product form' });

    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Updated via the Edit Product form');
  });

  it('B. accepts division', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/materials/${P.cgyRec}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ division: 'healthcare' });

    expect(res.status).toBe(200);
    expect(res.body.division).toBe('healthcare');

    // restore so later isolation assertions stay meaningful
    await request(app.getHttpServer())
      .patch(`/materials/${P.cgyRec}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ division: 'recycling' });
  });

  it('C. accepts warehouseId', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/materials/${P.mrRec}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ warehouseId: WAREHOUSE_ON });

    expect(res.status).toBe(200);
    expect(res.body.warehouseId).toBe(WAREHOUSE_ON);

    await request(app.getHttpServer())
      .patch(`/materials/${P.mrRec}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ warehouseId: WAREHOUSE_MR });
  });

  it('accepts the full Edit Product payload exactly as app.js submits it', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/materials/${P.onRec}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'ON Recycling Item',
        category: 'Fibre',
        description: 'Baled mixed office paper',
        division: 'recycling',
        active: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Baled mixed office paper');
    expect(res.body.category).toBe('Fibre');
  });

  // ---- strictness must not be traded away for compatibility ----

  it('still rejects an unknown property with 400 (whitelist intact)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/materials/${P.cgyRec}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ description: 'ok', isAdmin: true });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('isAdmin');
  });

  it('still rejects an out-of-range division with 400', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/materials/${P.cgyRec}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ division: 'finance' });

    expect(res.status).toBe(400);
  });

  it('still enforces warehouse authorization on reassignment (403)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/materials/${P.onRec}`)
      .set('Authorization', `Bearer ${scopedAdminToken}`)
      .send({ warehouseId: WAREHOUSE_CGY });

    expect(res.status).toBe(403);
  });

  it('rejects unauthenticated updates (401)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/materials/${P.cgyRec}`)
      .send({ description: 'nope' });

    expect(res.status).toBe(401);
  });

  // ---- K: warehouse + division isolation across all six scopes ----

  const COMBOS: Array<[string, string, string, string]> = [
    ['Calgary', WAREHOUSE_CGY, 'recycling', 'CGY Recycling Item'],
    ['Calgary', WAREHOUSE_CGY, 'healthcare', 'CGY Healthcare Item'],
    ['Ontario', WAREHOUSE_ON, 'recycling', 'ON Recycling Item'],
    ['Ontario', WAREHOUSE_ON, 'healthcare', 'ON Healthcare Item'],
    ['Maple Ridge', WAREHOUSE_MR, 'recycling', 'MR Recycling Item'],
    ['Maple Ridge', WAREHOUSE_MR, 'healthcare', 'MR Healthcare Item'],
  ];

  it.each(COMBOS)(
    'K. %s + %s catalog returns only that warehouse/division scope',
    async (_label, warehouseId, division, expectedName) => {
      const res = await request(app.getHttpServer())
        .get(`/materials?warehouseId=${warehouseId}&division=${division}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const names = res.body.map((m: any) => m.name);
      expect(names).toContain(expectedName);

      // nothing from another division, and nothing pinned to another facility
      for (const m of res.body) {
        expect(m.division).toBe(division);
        if (m.warehouseId !== null) expect(m.warehouseId).toBe(warehouseId);
      }
    },
  );

  it('an admin authorized for every facility still sees only the selected division', async () => {
    const res = await request(app.getHttpServer())
      .get('/materials?division=healthcare')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const m of res.body) expect(m.division).toBe('healthcare');
    expect(res.body.map((m: any) => m.name)).not.toContain('CGY Recycling Item');
  });

  it('switching division changes the catalog (no cross-division leak)', async () => {
    const rec = await request(app.getHttpServer())
      .get(`/materials?warehouseId=${WAREHOUSE_CGY}&division=recycling`)
      .set('Authorization', `Bearer ${adminToken}`);
    const hc = await request(app.getHttpServer())
      .get(`/materials?warehouseId=${WAREHOUSE_CGY}&division=healthcare`)
      .set('Authorization', `Bearer ${adminToken}`);

    const recIds = rec.body.map((m: any) => m.id);
    const hcIds = hc.body.map((m: any) => m.id);
    expect(recIds).toContain(P.cgyRec);
    expect(hcIds).toContain(P.cgyHc);
    expect(recIds.filter((id: string) => hcIds.includes(id))).toHaveLength(0);
  });

  it('an unauthorized facility is refused rather than silently scoped (403)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/materials?warehouseId=${WAREHOUSE_CGY}&division=recycling`)
      .set('Authorization', `Bearer ${scopedAdminToken}`);

    expect(res.status).toBe(403);
  });
});
