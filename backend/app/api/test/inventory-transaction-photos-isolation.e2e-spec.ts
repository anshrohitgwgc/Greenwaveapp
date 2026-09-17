import { gateDatabase } from './gate-database';
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
import { InventoryTransactionPhoto } from '../src/inventory/entities/inventory-transaction-photo.entity';
import { InventoryModule } from '../src/inventory/inventory.module';
import { MaterialsModule } from '../src/materials/materials.module';
import { Material } from '../src/materials/entities/material.entity';
import { PhotoAsset } from '../src/photos/entities/photo-asset.entity';
import { PhotosModule } from '../src/photos/photos.module';
import { StorageService } from '../src/storage/storage.service';
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

describe('Workstream 4: Multi-Photo Durable Association & Editing Isolation', () => {
  jest.setTimeout(30000);
  let app: INestApplication;
  let dataSource: DataSource;

  const WAREHOUSE_CGY = '22222222-2222-4222-8222-222222222222';
  const WAREHOUSE_ON = '33333333-3333-4333-8333-333333333333';
  const MATERIAL_ID = 'dddddddd-0001-4ddd-8ddd-dddddddddddd';

  let adminToken: string;
  let staffCgyToken: string;
  let staffOnToken: string;

  beforeAll(async () => {
    const mockStorageService = {
      upload: jest.fn().mockResolvedValue({
        objectKey: 'photos/test.jpg',
        etag: 'etag123',
        sizeBytes: 1024,
      }),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    const mockRedisService = {
      getClient: () => null,
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        TypeOrmModule.forRoot({
          ...gateDatabase('photos'),
          entities: [
            User,
            Role,
            Permission,
            UserRole,
            RolePermission,
            Warehouse,
            UserWarehouse,
            UserDivision,
            Material,
            Container,
            InventoryTransaction,
            InventoryTransactionPhoto,
            InventoryBalance,
            PhotoAsset,
            AuditEvent,
          ],
        }),
        AuthModule,
        UsersModule,
        RolesModule,
        WarehousesModule,
        MaterialsModule,
        InventoryModule,
        PhotosModule,
        AuditModule,
      ],
    })
      .overrideProvider(StorageService)
      .useValue(mockStorageService)
      .overrideProvider(RedisService)
      .useValue(mockRedisService)
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

    // Seed Warehouses
    const warehouseRepo = dataSource.getRepository(Warehouse);
    await warehouseRepo.save([
      { id: WAREHOUSE_CGY, name: 'Calgary', code: 'CGY', province: 'AB', active: true },
      { id: WAREHOUSE_ON, name: 'Ontario', code: 'ON', province: 'ON', active: true },
    ]);

    // Seed Material
    const materialRepo = dataSource.getRepository(Material);
    await materialRepo.save({
      id: MATERIAL_ID,
      name: 'Cardboard',
      unit: 'kg',
      category: 'paper',
      division: 'recycling',
      warehouseId: WAREHOUSE_CGY,
      active: true,
    });

    // Seed Users
    const userRepo = dataSource.getRepository(User);
    const userWarehouseRepo = dataSource.getRepository(UserWarehouse);
    const passwordHash = await bcrypt.hash('Secret123!', 10);

    await userRepo.save([
      { id: 1, email: 'admin@test.local', fullName: 'Admin', password: passwordHash, status: 'active', role: 'admin' },
      { id: 2, email: 'staff-cgy@test.local', fullName: 'Staff CGY', password: passwordHash, status: 'active', role: 'staff' },
      { id: 3, email: 'staff-on@test.local', fullName: 'Staff ON', password: passwordHash, status: 'active', role: 'staff' },
    ]);

    await userWarehouseRepo.save([
      { id: '22222222-0000-4000-8000-000000000001', userId: 2, warehouseId: WAREHOUSE_CGY },
      { id: '22222222-0000-4000-8000-000000000002', userId: 3, warehouseId: WAREHOUSE_ON },
    ]);

    await grantDivisions(dataSource, [1, 2, 3], ['greenwave']);

    // Authenticate
    const login = async (email: string) => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'Secret123!' })
        .expect(200);
      return res.body.access_token as string;
    };

    adminToken = await login('admin@test.local');
    staffCgyToken = await login('staff-cgy@test.local');
    staffOnToken = await login('staff-on@test.local');
  });

  afterAll(async () => {
    await app.close();
  });

  const createPhoto = async (id: string, jobRef: string, takenBy = 2) => {
    const photoRepo = dataSource.getRepository(PhotoAsset);
    return photoRepo.save({
      id,
      objectKey: `photos/${id}.jpg`,
      bucketName: 'greenwave-photos',
      originalFilename: `photo-${id.slice(0, 4)}.jpg`,
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      warehouseId: WAREHOUSE_CGY,
      jobReference: jobRef,
      photoType: 'cargo',
      takenBy,
      takenAt: new Date(),
    });
  };

  it('1. Closes multi-photo risk: two transactions with the SAME orderNumber maintain isolated photo sets', async () => {
    const P1 = '11111111-aaaa-4000-8000-000000000001';
    const P2 = '11111111-aaaa-4000-8000-000000000002';
    const P3 = '11111111-aaaa-4000-8000-000000000003';
    const P4 = '11111111-aaaa-4000-8000-000000000004';

    const SHARED_ORDER = 'ORD-SHARED-999';

    await createPhoto(P1, SHARED_ORDER);
    await createPhoto(P2, SHARED_ORDER);
    await createPhoto(P3, SHARED_ORDER);
    await createPhoto(P4, SHARED_ORDER);

    // Create Transaction A with photos P1 and P2
    const resA = await request(app.getHttpServer())
      .post('/inventory/transactions')
      .set('Authorization', `Bearer ${staffCgyToken}`)
      .send({
        warehouseId: WAREHOUSE_CGY,
        materialId: MATERIAL_ID,
        type: 'inbound',
        xl: 100,
        orderNumber: SHARED_ORDER,
        division: 'recycling',
        photoIds: [P1, P2],
      })
      .expect(201);
    const txAId = resA.body.id;

    // Create Transaction B with photos P3 and P4 and the SAME orderNumber
    const resB = await request(app.getHttpServer())
      .post('/inventory/transactions')
      .set('Authorization', `Bearer ${staffCgyToken}`)
      .send({
        warehouseId: WAREHOUSE_CGY,
        materialId: MATERIAL_ID,
        type: 'inbound',
        xl: 200,
        orderNumber: SHARED_ORDER,
        division: 'recycling',
        photoIds: [P3, P4],
      })
      .expect(201);
    const txBId = resB.body.id;

    // Retrieve Transaction A
    const detailA = await request(app.getHttpServer())
      .get(`/inventory/transactions/${txAId}`)
      .set('Authorization', `Bearer ${staffCgyToken}`)
      .expect(200);

    const aPhotoIds = detailA.body.photos.map((p: any) => p.id);
    expect(aPhotoIds).toEqual([P1, P2]);
    expect(aPhotoIds).not.toContain(P3);
    expect(aPhotoIds).not.toContain(P4);

    // Retrieve Transaction B
    const detailB = await request(app.getHttpServer())
      .get(`/inventory/transactions/${txBId}`)
      .set('Authorization', `Bearer ${staffCgyToken}`)
      .expect(200);

    const bPhotoIds = detailB.body.photos.map((p: any) => p.id);
    expect(bPhotoIds).toEqual([P3, P4]);
    expect(bPhotoIds).not.toContain(P1);
    expect(bPhotoIds).not.toContain(P2);
  });

  it('2. Safe photo editing: supports attaching additional photos to an existing entry', async () => {
    const P5 = '11111111-aaaa-4000-8000-000000000005';
    await createPhoto(P5, 'ORD-5');

    // Create a transaction initially with 1 photo
    const P_INIT = '11111111-aaaa-4000-8000-000000000006';
    await createPhoto(P_INIT, 'ORD-6');

    const resTx = await request(app.getHttpServer())
      .post('/inventory/transactions')
      .set('Authorization', `Bearer ${staffCgyToken}`)
      .send({
        warehouseId: WAREHOUSE_CGY,
        materialId: MATERIAL_ID,
        type: 'inbound',
        xl: 50,
        division: 'recycling',
        photoIds: [P_INIT],
      })
      .expect(201);
    const txId = resTx.body.id;

    // Attach P5
    const attachRes = await request(app.getHttpServer())
      .post(`/inventory/transactions/${txId}/photos`)
      .set('Authorization', `Bearer ${staffCgyToken}`)
      .send({ photoIds: [P5] })
      .expect(201);

    const attachedIds = attachRes.body.photos.map((p: any) => p.id);
    expect(attachedIds).toEqual([P_INIT, P5]);
  });

  it('3. Safe photo editing: strictly enforces maximum 15 photos cap', async () => {
    // Generate 16 photos
    const photoIds: string[] = [];
    for (let i = 10; i <= 25; i++) {
      const pid = `11111111-bbbb-4000-8000-0000000000${i}`;
      await createPhoto(pid, 'CAP-TEST');
      photoIds.push(pid);
    }

    // Create a transaction with 10 photos
    const resTx = await request(app.getHttpServer())
      .post('/inventory/transactions')
      .set('Authorization', `Bearer ${staffCgyToken}`)
      .send({
        warehouseId: WAREHOUSE_CGY,
        materialId: MATERIAL_ID,
        type: 'inbound',
        xl: 50,
        division: 'recycling',
        photoIds: photoIds.slice(0, 10),
      })
      .expect(201);
    const txId = resTx.body.id;

    // Attempting to attach 6 more (10 + 6 = 16 > 15) must be rejected with 400
    const overCapRes = await request(app.getHttpServer())
      .post(`/inventory/transactions/${txId}/photos`)
      .set('Authorization', `Bearer ${staffCgyToken}`)
      .send({ photoIds: photoIds.slice(10, 16) })
      .expect(400);

    expect(overCapRes.body.message).toContain('A maximum of 15 photos can be attached');
  });

  it('4. Safe photo editing: removing attachment does not delete underlying photo asset', async () => {
    const P_DETACH = '11111111-cccc-4000-8000-000000000001';
    const P_KEEP = '11111111-cccc-4000-8000-000000000002';
    await createPhoto(P_DETACH, 'DETACH-TEST');
    await createPhoto(P_KEEP, 'DETACH-TEST');

    const resTx = await request(app.getHttpServer())
      .post('/inventory/transactions')
      .set('Authorization', `Bearer ${staffCgyToken}`)
      .send({
        warehouseId: WAREHOUSE_CGY,
        materialId: MATERIAL_ID,
        type: 'inbound',
        xl: 75,
        division: 'recycling',
        photoIds: [P_DETACH, P_KEEP],
      })
      .expect(201);
    const txId = resTx.body.id;

    // Detach P_DETACH
    await request(app.getHttpServer())
      .delete(`/inventory/transactions/${txId}/photos/${P_DETACH}`)
      .set('Authorization', `Bearer ${staffCgyToken}`)
      .expect(200);

    // Verify transaction now only has P_KEEP
    const detail = await request(app.getHttpServer())
      .get(`/inventory/transactions/${txId}`)
      .set('Authorization', `Bearer ${staffCgyToken}`)
      .expect(200);

    const remainingPhotoIds = detail.body.photos.map((p: any) => p.id);
    expect(remainingPhotoIds).toEqual([P_KEEP]);
    expect(detail.body.photoId).toBe(P_KEEP); // Cover photo updated to remaining

    // Verify P_DETACH is still intact in photo library table
    const photoRepo = dataSource.getRepository(PhotoAsset);
    const stillInDb = await photoRepo.findOne({ where: { id: P_DETACH } });
    expect(stillInDb).toBeDefined();
    expect(stillInDb?.id).toBe(P_DETACH);
  });

  it('5. Rejects cross-warehouse photo operations with 403', async () => {
    const P_X = '11111111-dddd-4000-8000-000000000001';
    await createPhoto(P_X, 'X-TEST');

    const resTx = await request(app.getHttpServer())
      .post('/inventory/transactions')
      .set('Authorization', `Bearer ${staffCgyToken}`)
      .send({
        warehouseId: WAREHOUSE_CGY,
        materialId: MATERIAL_ID,
        type: 'inbound',
        xl: 10,
        division: 'recycling',
        photoIds: [P_X],
      })
      .expect(201);
    const txId = resTx.body.id;

    // Staff from Ontario attempting to attach or delete photos on Calgary entry gets 403
    await request(app.getHttpServer())
      .post(`/inventory/transactions/${txId}/photos`)
      .set('Authorization', `Bearer ${staffOnToken}`)
      .send({ photoIds: [P_X] })
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/inventory/transactions/${txId}/photos/${P_X}`)
      .set('Authorization', `Bearer ${staffOnToken}`)
      .expect(403);
  });
});
