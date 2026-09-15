/* eslint-disable */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Readable } from 'stream';

import { AuditModule } from '../src/audit/audit.module';
import { AuditEvent } from '../src/audit/entities/audit-event.entity';
import { AuthModule } from '../src/auth/auth.module';
import { Container } from '../src/inventory/entities/container.entity';
import { InventoryBalance } from '../src/inventory/entities/inventory-balance.entity';
import { InventoryTransaction } from '../src/inventory/entities/inventory-transaction.entity';
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

describe('E2E Acceptance: Inventory History Details & Photo Storage Retrieval', () => {
  jest.setTimeout(30000);
  let app: INestApplication;
  let dataSource: DataSource;

  const WAREHOUSE_CGY = '22222222-2222-4222-8222-222222222222';
  const WAREHOUSE_ON = '33333333-3333-4333-8333-333333333333';
  const MATERIAL_RECYCLING = 'dddddddd-0001-4ddd-8ddd-dddddddddddd';
  const PHOTO_ID_1 = 'bbbbbbbb-0001-4bbb-8bbb-bbbbbbbbbbbb';
  const TX_ID_1 = 'aaaaaaaa-0001-4aaa-8aaa-aaaaaaaaaaaa';

  let adminToken: string;
  let staffCgyToken: string;
  let staffOnToken: string;

  const sampleImageBytes = Buffer.from('fake-jpeg-binary-stream-data-for-testing');

  beforeAll(async () => {
    const mockStorageService = {
      upload: jest.fn().mockResolvedValue({
        objectKey: 'photos/cgy/test.jpg',
        etag: 'etag123',
        sizeBytes: sampleImageBytes.length,
      }),
      delete: jest.fn().mockResolvedValue(undefined),
      validateObjectKey: jest.fn(),
      getObject: jest.fn().mockImplementation((key: string) => {
        if (key.includes('missing')) {
          const err = new Error('NoSuchKey');
          (err as any).code = 'NoSuchKey';
          throw err;
        }
        return Promise.resolve(
          new Readable({
            read() {
              this.push(sampleImageBytes);
              this.push(null);
            },
          }),
        );
      }),
      statObject: jest.fn().mockResolvedValue({
        size: sampleImageBytes.length,
        metaData: { 'content-type': 'image/jpeg' },
      }),
      objectExists: jest.fn().mockResolvedValue(true),
      getBucketName: jest.fn().mockReturnValue('greenwave-photos'),
    };

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
        RolesModule,
        MaterialsModule,
        AuditModule,
        InventoryModule,
        PhotosModule,
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
      .useValue(mockStorageService)
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
      { id: WAREHOUSE_CGY, name: 'Calgary Facility', code: 'CGY', active: true },
      { id: WAREHOUSE_ON, name: 'Ontario Facility', code: 'ON', active: true },
    ]);

    // Seed material
    const matRepo = dataSource.getRepository(Material);
    await matRepo.save({
      id: MATERIAL_RECYCLING,
      name: 'OCC Baled Cardboard',
      unit: 'pallet',
      division: 'recycling',
      warehouseId: WAREHOUSE_CGY,
      active: true,
    });

    // Seed users
    const passwordHash = await bcrypt.hash('secret123', 10);
    const userRepo = dataSource.getRepository(User);
    const [adminUser, staffCgy, staffOn] = await userRepo.save([
      {
        id: 1,
        email: 'admin@greenwave.test',
        password: passwordHash,
        fullName: 'Admin User',
        role: 'admin',
        status: 'active',
      },
      {
        id: 2,
        email: 'staff-cgy@greenwave.test',
        password: passwordHash,
        fullName: 'Calgary Staff',
        role: 'staff',
        status: 'active',
      },
      {
        id: 3,
        email: 'staff-on@greenwave.test',
        password: passwordHash,
        fullName: 'Ontario Staff',
        role: 'staff',
        status: 'active',
      },
    ]);

    const uwRepo = dataSource.getRepository(UserWarehouse);
    await uwRepo.save([
      { userId: staffCgy.id, warehouseId: WAREHOUSE_CGY },
      { userId: staffOn.id, warehouseId: WAREHOUSE_ON },
    ]);

    await grantDivisions(dataSource, [adminUser.id, staffCgy.id, staffOn.id], ['greenwave', 'healthcare']);

    // Seed PhotoAsset
    const photoRepo = dataSource.getRepository(PhotoAsset);
    await photoRepo.save({
      id: PHOTO_ID_1,
      objectKey: 'photos/cgy/photo1.jpg',
      originalFilename: 'intake_seal.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: sampleImageBytes.length,
      warehouseId: WAREHOUSE_CGY,
      photoType: 'inventory_inbound',
      jobReference: 'ORD-9999',
      takenBy: staffCgy.id,
      takenAt: new Date('2026-09-15T10:00:00Z'),
    });

    // Seed Inventory Transaction
    const txRepo = dataSource.getRepository(InventoryTransaction);
    await txRepo.save({
      id: TX_ID_1,
      warehouseId: WAREHOUSE_CGY,
      materialId: MATERIAL_RECYCLING,
      type: 'inbound',
      unitType: 'pallet',
      division: 'recycling',
      weightValue: '4500.000',
      weightUnit: 'kg',
      photoId: PHOTO_ID_1,
      orderNumber: 'ORD-9999',
      reference: 'ORD-9999',
      containerNumber: 'MSMU6896930',
      sealNumber: '0336695',
      xl: '10',
      l: '0',
      m: '0',
      s: '0',
      total: '10',
      notes: 'Cross dock delivery, clean pallets',
      createdBy: staffCgy.id,
      createdAt: new Date('2026-09-15T10:00:00Z'),
    });

    // Obtain JWT tokens
    const login = async (email: string) => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'secret123' })
        .expect(200);
      return res.body.access_token as string;
    };

    adminToken = await login('admin@greenwave.test');
    staffCgyToken = await login('staff-cgy@greenwave.test');
    staffOnToken = await login('staff-on@greenwave.test');
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('PROBLEM A: Authoritative Inventory Detail History', () => {
    it('1. GET /inventory/transactions/:id returns all authoritative details including seal, container, date, time and photos', async () => {
      const res = await request(app.getHttpServer())
        .get(`/inventory/transactions/${TX_ID_1}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const tx = res.body;
      expect(tx.id).toBe(TX_ID_1);
      expect(tx.materialName).toBe('OCC Baled Cardboard');
      expect(tx.warehouseName).toBe('Calgary Facility');
      expect(tx.division).toBe('recycling');
      expect(tx.unitType).toBe('pallet');
      expect(tx.weightValue).toBe(4500);
      expect(tx.weightUnit).toBe('kg');
      expect(tx.total).toBe(10);
      expect(tx.orderNumber).toBe('ORD-9999');
      expect(tx.containerNumber).toBe('MSMU6896930');
      expect(tx.sealNumber).toBe('0336695');
      expect(tx.notes).toBe('Cross dock delivery, clean pallets');
      expect(tx.creatorName).toBe('Calgary Staff');
      expect(tx.date).toBe('2026-09-15');
      expect(tx.time).toBeDefined();

      // Photos verification
      expect(tx.photos).toBeInstanceOf(Array);
      expect(tx.photos.length).toBeGreaterThanOrEqual(1);
      const photo = tx.photos[0];
      expect(photo.id).toBe(PHOTO_ID_1);
      expect(photo.url).toBe(`/api/photos/${PHOTO_ID_1}/view`);
      expect(photo.thumbnailUrl).toBe(`/api/photos/${PHOTO_ID_1}/thumbnail`);
      expect(photo.downloadUrl).toBe(`/api/photos/${PHOTO_ID_1}/download`);
      expect(photo.url).not.toContain('localhost:9000');
    });

    it('2. Denies cross-warehouse access to transaction details (staff from ON cannot view CGY transaction)', async () => {
      await request(app.getHttpServer())
        .get(`/inventory/transactions/${TX_ID_1}`)
        .set('Authorization', `Bearer ${staffOnToken}`)
        .expect(403);
    });

    it('3. Returns 404 for nonexistent transaction', async () => {
      await request(app.getHttpServer())
        .get('/inventory/transactions/nonexistent-id')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('4. POST /inventory/transactions persists custom date, sealNumber, containerNumber', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/inventory/transactions')
        .set('Authorization', `Bearer ${staffCgyToken}`)
        .send({
          warehouseId: WAREHOUSE_CGY,
          materialId: MATERIAL_RECYCLING,
          type: 'inbound',
          division: 'recycling',
          unitType: 'pallet',
          palletQty: 8,
          date: '2026-09-10',
          orderNumber: 'ORD-CUSTOM-DATE',
          containerNumber: 'CAXU9999999',
          sealNumber: 'SEAL-CUSTOM',
          notes: 'Custom date persisted test',
        })
        .expect(201);

      const createdId = createRes.body.id;
      expect(createdId).toBeDefined();

      const fetchRes = await request(app.getHttpServer())
        .get(`/inventory/transactions/${createdId}`)
        .set('Authorization', `Bearer ${staffCgyToken}`)
        .expect(200);

      expect(fetchRes.body.containerNumber).toBe('CAXU9999999');
      expect(fetchRes.body.sealNumber).toBe('SEAL-CUSTOM');
      expect(fetchRes.body.date).toBe('2026-09-10');
      expect(fetchRes.body.notes).toBe('Custom date persisted test');
    });
  });

  describe('PROBLEM B: Photo Streaming, Retrieval & Download', () => {
    it('1. GET /photos/:id/view streams image bytes with private cache control', async () => {
      const res = await request(app.getHttpServer())
        .get(`/photos/${PHOTO_ID_1}/view`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers['cache-control']).toBe(
        'private, no-cache, no-store, must-revalidate',
      );
      expect(res.body).toEqual(sampleImageBytes);
    });

    it('2. GET /photos/:id/thumbnail streams thumbnail bytes with safe headers', async () => {
      const res = await request(app.getHttpServer())
        .get(`/photos/${PHOTO_ID_1}/thumbnail`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers['cache-control']).toBe(
        'private, no-cache, no-store, must-revalidate',
      );
    });

    it('3. GET /photos/:id/download sets Content-Disposition attachment', async () => {
      const res = await request(app.getHttpServer())
        .get(`/photos/${PHOTO_ID_1}/download`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.headers['content-disposition']).toContain('attachment;');
      expect(res.headers['content-disposition']).toContain('intake_seal.jpg');
      expect(res.body).toEqual(sampleImageBytes);
    });

    it('4. Rejects cross-warehouse photo stream request with 403', async () => {
      await request(app.getHttpServer())
        .get(`/photos/${PHOTO_ID_1}/view`)
        .set('Authorization', `Bearer ${staffOnToken}`)
        .expect(403);
    });

    it('5. Returns 404 for nonexistent photo', async () => {
      await request(app.getHttpServer())
        .get('/photos/00000000-0000-0000-0000-000000000000/view')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });
});
