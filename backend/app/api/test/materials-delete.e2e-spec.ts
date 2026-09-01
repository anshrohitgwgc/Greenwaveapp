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
import { UserWarehouse } from '../src/warehouses/entities/user-warehouse.entity';
import { Warehouse } from '../src/warehouses/entities/warehouse.entity';
import { WarehousesModule } from '../src/warehouses/warehouses.module';

/**
 * E2E acceptance for the safe Product/Material delete feature:
 * admin-only, warehouse-scoped, and blocked by referential integrity
 * (inventory_transactions / containers). Runs against an in-memory
 * sqlite database — no real Postgres/Redis, no production or staging
 * data is touched.
 */
describe('E2E Acceptance: Safe Product Delete (DELETE /materials/:id)', () => {
  jest.setTimeout(30000);
  let app: INestApplication;
  let dataSource: DataSource;

  const WAREHOUSE_CGY = '22222222-2222-4222-8222-222222222222';
  const WAREHOUSE_ON = '33333333-3333-4333-8333-333333333333';

  const MATERIAL_UNREFERENCED = 'dddddddd-0001-4ddd-8ddd-dddddddddddd';
  const MATERIAL_WITH_INVENTORY_TX = 'dddddddd-0002-4ddd-8ddd-dddddddddddd';
  const MATERIAL_WITH_CONTAINER = 'dddddddd-0003-4ddd-8ddd-dddddddddddd';
  const MATERIAL_CGY_DUPLICATE_NAME = 'dddddddd-0004-4ddd-8ddd-dddddddddddd';
  const MATERIAL_ON_DUPLICATE_NAME = 'dddddddd-0005-4ddd-8ddd-dddddddddddd';
  const MATERIAL_ONTARIO_ONLY = 'dddddddd-0006-4ddd-8ddd-dddddddddddd';
  const DUPLICATE_PRODUCT_NAME = 'Recycled Cardboard';

  let adminToken: string;
  let staffToken: string;
  let driverToken: string;
  let managerToken: string;
  let scopedAdminToken: string; // admin role, but no global warehouse access

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
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: false,
      }),
    );
    await app.init();

    dataSource = moduleRef.get(DataSource);

    // Seed warehouses
    const whRepo = dataSource.getRepository(Warehouse);
    await whRepo.save([
      { id: WAREHOUSE_CGY, name: 'Calgary, AB', code: 'CGY', active: true },
      { id: WAREHOUSE_ON, name: 'Ontario', code: 'ON', active: true },
    ]);

    // Seed materials/products used across the delete scenarios
    const materialRepo = dataSource.getRepository(Material);
    await materialRepo.save([
      {
        id: MATERIAL_UNREFERENCED,
        name: 'Disposable Test Widget',
        unit: 'kg',
        division: 'recycling',
        warehouseId: WAREHOUSE_CGY,
        active: true,
      },
      {
        id: MATERIAL_WITH_INVENTORY_TX,
        name: 'Baled Cardboard (has ledger history)',
        unit: 'kg',
        division: 'recycling',
        warehouseId: WAREHOUSE_CGY,
        active: true,
      },
      {
        id: MATERIAL_WITH_CONTAINER,
        name: 'Container-Linked Scrap',
        unit: 'kg',
        division: 'recycling',
        warehouseId: WAREHOUSE_CGY,
        active: true,
      },
      {
        id: MATERIAL_CGY_DUPLICATE_NAME,
        name: DUPLICATE_PRODUCT_NAME,
        unit: 'kg',
        division: 'recycling',
        warehouseId: WAREHOUSE_CGY,
        active: true,
      },
      {
        id: MATERIAL_ON_DUPLICATE_NAME,
        name: DUPLICATE_PRODUCT_NAME,
        unit: 'kg',
        division: 'recycling',
        warehouseId: WAREHOUSE_ON,
        active: true,
      },
      {
        id: MATERIAL_ONTARIO_ONLY,
        name: 'Ontario-Only Product',
        unit: 'kg',
        division: 'recycling',
        warehouseId: WAREHOUSE_ON,
        active: true,
      },
    ]);

    // Reference MATERIAL_WITH_INVENTORY_TX from an inventory transaction
    const txRepo = dataSource.getRepository(InventoryTransaction);
    await txRepo.save({
      id: 'eeeeeeee-0001-4eee-8eee-eeeeeeeeeeee',
      warehouseId: WAREHOUSE_CGY,
      materialId: MATERIAL_WITH_INVENTORY_TX,
      type: 'inbound',
      total: '10.000',
      createdBy: 1,
    });

    // Reference MATERIAL_WITH_CONTAINER from a container
    const containerRepo = dataSource.getRepository(Container);
    await containerRepo.save({
      id: 'ffffffff-0001-4fff-8fff-ffffffffffff',
      warehouseId: WAREHOUSE_CGY,
      materialId: MATERIAL_WITH_CONTAINER,
      status: 'in_transit',
    });

    // Seed permissions/roles. Deliberately do NOT grant the admin role
    // 'warehouses:global_access' here — permissions in this system are
    // keyed by role NAME (every 'admin' user shares the same permission
    // set), so leaving it off means warehouse access for admins is decided
    // purely by their individual user_warehouses membership rows below.
    // That is what lets this test prove an admin who isn't a member of a
    // given warehouse still gets 403 deleting a product there.
    const permRepo = dataSource.getRepository(Permission);
    const roleRepo = dataSource.getRepository(Role);
    const rolePermRepo = dataSource.getRepository(RolePermission);

    const seededPerms = await permRepo.save([
      { id: '1', key: 'materials:manage', description: 'Manage Materials' },
    ]);

    const adminRole = await roleRepo.save({ id: 'r-admin', name: 'admin' });
    await roleRepo.save({ id: 'r-manager', name: 'manager' });
    await roleRepo.save({ id: 'r-staff', name: 'staff' });
    await roleRepo.save({ id: 'r-driver', name: 'driver' });

    await rolePermRepo.save(
      seededPerms.map((p) => ({ roleId: adminRole.id, permissionId: p.id })),
    );
    // Manager/staff/driver keep the default (code-fallback) permission sets
    // defined in RolesService.ROLE_DEFAULT_PERMISSIONS since no role_permissions
    // rows are seeded for them here.

    // Seed users
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
      fullName: 'Operations Manager',
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
      fullName: 'Calgary Driver',
      email: 'driver@greenwave.test',
      password: passwordHash,
      role: 'driver',
      status: 'active',
    });

    // A second 'admin'-role account, deliberately assigned membership in
    // Ontario only, used to prove Calgary products are still off-limits to
    // an admin who isn't authorized for that facility.
    const scopedAdminUser = await userRepo.save({
      fullName: 'Ontario-Scoped Admin',
      email: 'scoped-admin@greenwave.test',
      password: passwordHash,
      role: 'admin',
      status: 'active',
    });

    // Assign warehouse memberships. The primary admin gets both facilities
    // (needed for the positive delete scenarios below); the scoped admin
    // gets Ontario only.
    const userWhRepo = dataSource.getRepository(UserWarehouse);
    await userWhRepo.save([
      { id: 'uw-1', userId: staffUser.id, warehouseId: WAREHOUSE_CGY },
      { id: 'uw-2', userId: driverUser.id, warehouseId: WAREHOUSE_CGY },
      { id: 'uw-3', userId: managerUser.id, warehouseId: WAREHOUSE_CGY },
      { id: 'uw-4', userId: adminUser.id, warehouseId: WAREHOUSE_CGY },
      { id: 'uw-5', userId: adminUser.id, warehouseId: WAREHOUSE_ON },
      { id: 'uw-6', userId: scopedAdminUser.id, warehouseId: WAREHOUSE_ON },
    ]);

    const login = async (email: string) => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'TestPass123!' });
      return res.body.access_token;
    };

    adminToken = await login('admin@greenwave.test');
    managerToken = await login('manager@greenwave.test');
    staffToken = await login('staff@greenwave.test');
    driverToken = await login('driver@greenwave.test');
    scopedAdminToken = await login('scoped-admin@greenwave.test');
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Admin can delete an unused (unreferenced) product', async () => {
    await request(app.getHttpServer())
      .delete(`/materials/${MATERIAL_UNREFERENCED}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    const stillThere = await dataSource
      .getRepository(Material)
      .findOne({ where: { id: MATERIAL_UNREFERENCED } });
    expect(stillThere).toBeNull();
  });

  it('2. Staff gets 403', async () => {
    await request(app.getHttpServer())
      .delete(`/materials/${MATERIAL_WITH_INVENTORY_TX}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);
  });

  it('3. Driver gets 403', async () => {
    await request(app.getHttpServer())
      .delete(`/materials/${MATERIAL_WITH_INVENTORY_TX}`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(403);
  });

  it('3b. Ordinary manager gets 403 (delete is admin-only, unlike create/update)', async () => {
    await request(app.getHttpServer())
      .delete(`/materials/${MATERIAL_WITH_INVENTORY_TX}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(403);
  });

  it('4. Unauthorized warehouse user (admin without Calgary access) gets 403', async () => {
    await request(app.getHttpServer())
      .delete(`/materials/${MATERIAL_CGY_DUPLICATE_NAME}`)
      .set('Authorization', `Bearer ${scopedAdminToken}`)
      .expect(403);

    // Confirm nothing was actually removed.
    const stillThere = await dataSource
      .getRepository(Material)
      .findOne({ where: { id: MATERIAL_CGY_DUPLICATE_NAME } });
    expect(stillThere).not.toBeNull();
  });

  it('5. Unknown product returns 404', async () => {
    await request(app.getHttpServer())
      .delete('/materials/00000000-0000-4000-8000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('6. Referenced product returns 409 with a clear message', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/materials/${MATERIAL_WITH_INVENTORY_TX}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    expect(res.body.message).toMatch(/referenced by existing business records/i);
  });

  it('7. Inventory-referenced product cannot be deleted (business history preserved)', async () => {
    await request(app.getHttpServer())
      .delete(`/materials/${MATERIAL_WITH_INVENTORY_TX}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    const tx = await dataSource
      .getRepository(InventoryTransaction)
      .findOne({ where: { materialId: MATERIAL_WITH_INVENTORY_TX } });
    expect(tx).not.toBeNull();

    const material = await dataSource
      .getRepository(Material)
      .findOne({ where: { id: MATERIAL_WITH_INVENTORY_TX } });
    expect(material).not.toBeNull();
  });

  it('8. Container-referenced product cannot be deleted', async () => {
    await request(app.getHttpServer())
      .delete(`/materials/${MATERIAL_WITH_CONTAINER}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    const material = await dataSource
      .getRepository(Material)
      .findOne({ where: { id: MATERIAL_WITH_CONTAINER } });
    expect(material).not.toBeNull();
  });

  it('9. Deleting a product in one warehouse does not affect a same-named product in another warehouse/division', async () => {
    await request(app.getHttpServer())
      .delete(`/materials/${MATERIAL_ON_DUPLICATE_NAME}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    const ontarioProduct = await dataSource
      .getRepository(Material)
      .findOne({ where: { id: MATERIAL_ON_DUPLICATE_NAME } });
    expect(ontarioProduct).toBeNull();

    // The Calgary product sharing the same name must be untouched.
    const calgaryProduct = await dataSource
      .getRepository(Material)
      .findOne({ where: { id: MATERIAL_CGY_DUPLICATE_NAME } });
    expect(calgaryProduct).not.toBeNull();
    expect(calgaryProduct?.name).toBe(DUPLICATE_PRODUCT_NAME);
  });

  it('10. Successful deletion removes only the selected product', async () => {
    const before = await dataSource.getRepository(Material).find();
    const beforeIds = before.map((m) => m.id).sort();

    await request(app.getHttpServer())
      .delete(`/materials/${MATERIAL_ONTARIO_ONLY}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    const after = await dataSource.getRepository(Material).find();
    const afterIds = after.map((m) => m.id).sort();

    expect(afterIds).toEqual(
      beforeIds.filter((id) => id !== MATERIAL_ONTARIO_ONLY),
    );
  });

  it('rejects unauthenticated delete requests (401)', async () => {
    await request(app.getHttpServer())
      .delete(`/materials/${MATERIAL_CGY_DUPLICATE_NAME}`)
      .expect(401);
  });
});
