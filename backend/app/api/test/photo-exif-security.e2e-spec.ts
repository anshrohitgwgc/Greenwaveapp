/* eslint-disable */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import exifr from 'exifr';
import request from 'supertest';
import sharp from 'sharp';
import { DataSource } from 'typeorm';

import { AuditModule } from '../src/audit/audit.module';
import { AuditEvent } from '../src/audit/entities/audit-event.entity';
import { AuthModule } from '../src/auth/auth.module';
import { PhotoAsset } from '../src/photos/entities/photo-asset.entity';
import { PhotosModule } from '../src/photos/photos.module';
import { RedisService } from '../src/redis/redis.service';
import { Permission } from '../src/roles/entities/permission.entity';
import { Role } from '../src/roles/entities/role.entity';
import { RolePermission } from '../src/roles/entities/role-permission.entity';
import { UserRole } from '../src/roles/entities/user-role.entity';
import { RolesModule } from '../src/roles/roles.module';
import { StorageService } from '../src/storage/storage.service';
import { User } from '../src/users/entities/user.entity';
import { UsersModule } from '../src/users/users.module';
import { UserDivision } from '../src/divisions/entities/user-division.entity';
import { UserWarehouse } from '../src/warehouses/entities/user-warehouse.entity';
import { Warehouse } from '../src/warehouses/entities/warehouse.entity';
import { WarehousesModule } from '../src/warehouses/warehouses.module';
import { createJpegWithGpsExif } from './fixtures/exif-jpeg';
import { grantDivisions } from './fixtures/divisions-test.helper';

/**
 * This suite deliberately does NOT mock StorageService — it uploads through
 * the real /photos API endpoint and reads the bytes back from the real
 * local MinIO container (greenwave-local-minio), so it proves what is
 * actually persisted, not what a mock claims would be persisted.
 */
describe('E2E Security: Server-side EXIF/GPS stripping on photo upload', () => {
  jest.setTimeout(30000);
  let app: INestApplication;
  let dataSource: DataSource;
  let storageService: StorageService;

  const WAREHOUSE_CGY = '22222222-2222-4222-8222-222222222222';
  const WAREHOUSE_ON = '33333333-3333-4333-8333-333333333333';

  let staffToken: string;
  let ontarioStaffToken: string;

  const uploadedObjectKeys: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
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
        PhotosModule,
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
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    dataSource = moduleRef.get(DataSource);
    storageService = moduleRef.get(StorageService);

    const whRepo = dataSource.getRepository(Warehouse);
    await whRepo.save([
      { id: WAREHOUSE_CGY, name: 'Calgary, AB', code: 'CGY', active: true },
      { id: WAREHOUSE_ON, name: 'Ontario', code: 'ON', active: true },
    ]);

    const passwordHash = await bcrypt.hash('TestPass123!', 10);
    const userRepo = dataSource.getRepository(User);

    const staffUser = await userRepo.save({
      fullName: 'Calgary Staff',
      email: 'photo-staff@greenwave.test',
      password: passwordHash,
      role: 'staff',
      status: 'active',
    });

    const ontarioStaffUser = await userRepo.save({
      fullName: 'Ontario Staff',
      email: 'photo-ontario-staff@greenwave.test',
      password: passwordHash,
      role: 'staff',
      status: 'active',
    });

    const userWhRepo = dataSource.getRepository(UserWarehouse);
    await userWhRepo.save([
      { id: 'photo-uw-1', userId: staffUser.id, warehouseId: WAREHOUSE_CGY },
      {
        id: 'photo-uw-2',
        userId: ontarioStaffUser.id,
        warehouseId: WAREHOUSE_ON,
      },
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

    staffToken = await login('photo-staff@greenwave.test');
    ontarioStaffToken = await login('photo-ontario-staff@greenwave.test');
  });

  afterAll(async () => {
    // Clean up whatever this run actually stored in the shared local MinIO
    // bucket so repeated runs don't accumulate test objects.
    await Promise.all(
      uploadedObjectKeys.map((key) =>
        storageService.delete(key).catch(() => undefined),
      ),
    );
    await app.close();
  });

  it('authorized staff can upload a photo to their own warehouse', async () => {
    const jpegWithGps = await createJpegWithGpsExif();

    // Sanity check on the fixture itself: it really does contain GPS before
    // upload, so a later "absent" assertion is meaningful and not vacuous.
    const beforeExif = await exifr.parse(jpegWithGps, {
      gps: true,
      exif: true,
    });
    expect(beforeExif).toBeTruthy();
    expect(beforeExif.latitude).toBeCloseTo(51.0447, 3);
    expect(beforeExif.longitude).toBeCloseTo(-114.0719, 3);
    expect(beforeExif.Make).toBe('GreenWaveTestCam');

    const res = await request(app.getHttpServer())
      .post('/photos')
      .set('Authorization', `Bearer ${staffToken}`)
      .field('warehouseId', WAREHOUSE_CGY)
      .field('photoType', 'inbound')
      .attach('file', jpegWithGps, {
        filename: 'gps-test.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();

    const stored = await dataSource
      .getRepository(PhotoAsset)
      .findOne({ where: { id: res.body.id } });
    expect(stored).toBeTruthy();
    uploadedObjectKeys.push(stored!.objectKey);

    // Retrieve the ACTUAL stored object bytes from the ACTUAL local MinIO
    // bucket — not from the app's DB/API response, not from a mock.
    const bucket = storageService.getBucketName();
    const objectUrl = `http://localhost:9000/${bucket}/${stored!.objectKey}`;
    const fetched = await fetch(objectUrl);
    expect(fetched.status).toBe(200);
    const storedBytes = Buffer.from(await fetched.arrayBuffer());

    // 1. GPS metadata is absent from the object as stored in MinIO.
    const afterExif = await exifr.parse(storedBytes, {
      gps: true,
      exif: true,
    });
    expect(afterExif?.latitude).toBeUndefined();
    expect(afterExif?.longitude).toBeUndefined();
    expect(afterExif?.GPSLatitude).toBeUndefined();
    expect(afterExif?.GPSLongitude).toBeUndefined();
    expect(afterExif?.GPSAltitude).toBeUndefined();
    expect(afterExif?.GPSTimeStamp).toBeUndefined();
    expect(afterExif?.Make).toBeUndefined();
    expect(afterExif?.Model).toBeUndefined();

    // 2. The stored object is still a valid, readable image.
    const meta = await sharp(storedBytes).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(240);
    expect(meta.height).toBe(180);
  });

  it('rejects a photo upload targeting a warehouse the user is not authorized for', async () => {
    const jpegWithGps = await createJpegWithGpsExif();

    const res = await request(app.getHttpServer())
      .post('/photos')
      .set('Authorization', `Bearer ${ontarioStaffToken}`)
      // Ontario staff has no access to the Calgary warehouse.
      .field('warehouseId', WAREHOUSE_CGY)
      .field('photoType', 'inbound')
      .attach('file', jpegWithGps, {
        filename: 'gps-test.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(403);

    // Nothing was persisted for the rejected upload.
    const count = await dataSource
      .getRepository(PhotoAsset)
      .count({ where: { warehouseId: WAREHOUSE_CGY } });
    expect(count).toBe(1); // only the one from the authorized-upload test above
  });

  it('rejects a non-image file even with a spoofed image mimetype', async () => {
    const fakeImage = Buffer.from('this is not actually a jpeg', 'utf8');

    const res = await request(app.getHttpServer())
      .post('/photos')
      .set('Authorization', `Bearer ${staffToken}`)
      .field('warehouseId', WAREHOUSE_CGY)
      .attach('file', fakeImage, {
        filename: 'fake.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(400);
  });
});
