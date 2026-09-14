/* eslint-disable */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AuditEvent } from '../src/audit/entities/audit-event.entity';
import { AuditModule } from '../src/audit/audit.module';
import { AuthModule } from '../src/auth/auth.module';
import { UserDivision } from '../src/divisions/entities/user-division.entity';
import { Pickup } from '../src/pickups/entities/pickup.entity';
import { PickupsController } from '../src/pickups/pickups.controller';
import { PickupsModule } from '../src/pickups/pickups.module';
import { PickupsService } from '../src/pickups/pickups.service';
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
import { grantDivisions } from './fixtures/divisions-test.helper';

/**
 * `jest.spyOn` swaps the method for a fresh function, and Nest's `@Get()` /
 * `@Post()` / `@Roles()` decorators hang their metadata on the method
 * function itself — so a naive spy silently unregisters the route (every
 * request 404s) and drops the very @Roles metadata under test. Copying the
 * metadata onto the wrapper keeps the route, the HTTP verb, and the role
 * list exactly as the controller declared them.
 */
function spyPreservingRouteMetadata<T extends object, K extends keyof T>(
  proto: T,
  key: K,
) {
  const original = proto[key] as unknown as (...args: any[]) => unknown;
  const spy = jest.spyOn(proto, key as any);
  const wrapper = proto[key] as unknown as (...args: any[]) => unknown;
  for (const metaKey of Reflect.getMetadataKeys(original)) {
    Reflect.defineMetadata(
      metaKey,
      Reflect.getMetadata(metaKey, original),
      wrapper,
    );
  }
  return spy;
}

/**
 * Release-gate regression cover for the pickups authorization boundary.
 *
 * pickups.controller.ts used to ship unguarded, so the release gate needs
 * executable proof — not a source-text assertion — that an authenticated
 * STAFF principal is stopped by RolesGuard before POST /pickups can reach
 * the handler, the service, or the database.
 *
 * The whole request path here is the real one: a real password login issuing
 * a real JWT, the real JwtAuthGuard/passport-jwt strategy, the real
 * RolesGuard reading the real @Roles metadata off the real controller, and
 * the same global ValidationPipe configuration main.ts installs. Nothing on
 * that path is stubbed. The only overridden provider is RedisService, which
 * is infrastructure the login rate limiter talks to and is not part of the
 * authorization decision.
 *
 * Storage is an in-memory sqlite database created and dropped by this file.
 * No production host, credential, or database is involved.
 */
describe('E2E Release Gate: pickups authorization (JwtAuthGuard + RolesGuard)', () => {
  jest.setTimeout(30000);

  let app: INestApplication;
  let dataSource: DataSource;

  // Spies are installed on the prototypes *before* the module is compiled,
  // because Nest captures the route handler reference at init time. They call
  // through: the real handler and the real service still run whenever
  // authorization actually permits it, so a "was not called" assertion means
  // execution genuinely never got there.
  const controllerCreateSpy = spyPreservingRouteMetadata(
    PickupsController.prototype,
    'create',
  );
  const controllerFindAllSpy = spyPreservingRouteMetadata(
    PickupsController.prototype,
    'findAll',
  );
  const serviceCreateSpy = jest.spyOn(PickupsService.prototype, 'create');
  const serviceFindAllSpy = jest.spyOn(PickupsService.prototype, 'findAll');

  const TEST_PASSWORD = 'TestPass123!';
  const WAREHOUSE_CGY = '22222222-2222-4222-8222-222222222222';

  let adminToken: string;
  let staffToken: string;
  let driverToken: string;

  /** A well-formed pickup payload — the request a staff user would send. */
  const pickupPayload = {
    customerName: 'Regression Fixture Customer',
    address: '1 Test Street, Calgary AB',
    materialType: 'electronics',
    estimatedWeight: 12,
    notes: 'authorization regression fixture — in-memory database only',
  };

  const pickupCount = async () =>
    dataSource.getRepository(Pickup).count();

  /** Counted straight off the driver, not through the ORM cache. */
  const rawPickupRowCount = async () => {
    const rows = await dataSource.query(
      'SELECT COUNT(*) AS c FROM pickup',
    );
    return Number(rows[0].c);
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
            Role,
            Permission,
            RolePermission,
            UserRole,
            Pickup,
          ],
          synchronize: true,
        }),
        AuthModule,
        UsersModule,
        RolesModule,
        WarehousesModule,
        AuditModule,
        PickupsModule,
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
    // Identical to main.ts, so the pipe cannot mask a guard difference.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    dataSource = moduleRef.get(DataSource);

    await dataSource.getRepository(Warehouse).save([
      { id: WAREHOUSE_CGY, name: 'Calgary, AB', code: 'CGY', active: true },
    ]);

    const roleRepo = dataSource.getRepository(Role);
    await roleRepo.save([
      { id: 'r-admin', name: 'admin' },
      { id: 'r-manager', name: 'manager' },
      { id: 'r-staff', name: 'staff' },
      { id: 'r-driver', name: 'driver' },
    ]);

    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    const userRepo = dataSource.getRepository(User);

    const adminUser = await userRepo.save({
      fullName: 'Gate Admin',
      email: 'gate-admin@greenwave.test',
      password: passwordHash,
      role: 'admin',
      status: 'active',
    });
    const staffUser = await userRepo.save({
      fullName: 'Gate Staff',
      email: 'gate-staff@greenwave.test',
      password: passwordHash,
      role: 'staff',
      status: 'active',
    });
    const driverUser = await userRepo.save({
      fullName: 'Gate Driver',
      email: 'gate-driver@greenwave.test',
      password: passwordHash,
      role: 'driver',
      status: 'active',
    });

    await dataSource.getRepository(UserWarehouse).save([
      { id: 'uw-1', userId: adminUser.id, warehouseId: WAREHOUSE_CGY },
      { id: 'uw-2', userId: staffUser.id, warehouseId: WAREHOUSE_CGY },
      { id: 'uw-3', userId: driverUser.id, warehouseId: WAREHOUSE_CGY },
    ]);

    await grantDivisions(dataSource, [
      adminUser.id,
      staffUser.id,
      driverUser.id,
    ]);

    // Real login through the real controller — the tokens below are genuine
    // signed JWTs for this in-memory app, never production credentials.
    const login = async (email: string) => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(200);
      expect(res.body.access_token).toEqual(expect.any(String));
      return res.body.access_token as string;
    };

    adminToken = await login('gate-admin@greenwave.test');
    staffToken = await login('gate-staff@greenwave.test');
    driverToken = await login('gate-driver@greenwave.test');
  });

  afterAll(async () => {
    if (app) await app.close();
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    controllerCreateSpy.mockClear();
    controllerFindAllSpy.mockClear();
    serviceCreateSpy.mockClear();
    serviceFindAllSpy.mockClear();
  });

  describe('CHECK 10 — authenticated staff must not create pickups', () => {
    it('rejects staff POST /pickups with 403 before the handler, the service, or any INSERT', async () => {
      const countBefore = await pickupCount();
      const rawBefore = await rawPickupRowCount();

      const res = await request(app.getHttpServer())
        .post('/pickups')
        .set('Authorization', `Bearer ${staffToken}`)
        .send(pickupPayload);

      // 1-3. An authenticated staff principal POSTing /pickups gets 403.
      expect(res.status).toBe(403);

      // 4. The rejection is RolesGuard's, not the auth guard's or the pipe's:
      //    401 would mean JwtAuthGuard, 400 would mean ValidationPipe. The
      //    message is the one RolesGuard throws.
      expect(res.body.message).toBe('Not authorized for this action');

      // 5. The controller handler never ran.
      expect(controllerCreateSpy).not.toHaveBeenCalled();

      // 6. The creation service never ran.
      expect(serviceCreateSpy).not.toHaveBeenCalled();

      // 7. Database state is unchanged — checked through the ORM and again
      //    with a raw driver-level count.
      expect(await pickupCount()).toBe(countBefore);
      expect(await rawPickupRowCount()).toBe(rawBefore);
    });

    it('rejects driver POST /pickups the same way (driver is staff-tier, not manager-tier)', async () => {
      const rawBefore = await rawPickupRowCount();

      const res = await request(app.getHttpServer())
        .post('/pickups')
        .set('Authorization', `Bearer ${driverToken}`)
        .send(pickupPayload);

      expect(res.status).toBe(403);
      expect(controllerCreateSpy).not.toHaveBeenCalled();
      expect(serviceCreateSpy).not.toHaveBeenCalled();
      expect(await rawPickupRowCount()).toBe(rawBefore);
    });

    it('rejects an anonymous POST /pickups with 401 at JwtAuthGuard', async () => {
      const rawBefore = await rawPickupRowCount();

      const res = await request(app.getHttpServer())
        .post('/pickups')
        .send(pickupPayload);

      expect(res.status).toBe(401);
      expect(controllerCreateSpy).not.toHaveBeenCalled();
      expect(serviceCreateSpy).not.toHaveBeenCalled();
      expect(await rawPickupRowCount()).toBe(rawBefore);
    });

    /**
     * Guard-order control. Admin is permitted by @Roles('admin', 'manager'),
     * so the identical request must clear both guards and fail later, in the
     * global ValidationPipe, which Nest runs strictly after guards.
     *
     * That 400 is a genuine functional defect in POST /pickups, separate from
     * this authorization gate and reported separately: tsconfig targets
     * ES2023, so CreatePickupDto's fields are emitted as real own properties
     * on every instance, while the DTO carries no class-validator decorators.
     * `whitelist` therefore treats all five as non-whitelisted and
     * `forbidNonWhitelisted` rejects — for every role, and for any body,
     * including an empty one. It is asserted here only to pin down that
     * staff's 403 is RolesGuard's and could not have come from the pipe.
     */
    it('control: admin POST /pickups clears both guards and fails later, at the pipe', async () => {
      const res = await request(app.getHttpServer())
        .post('/pickups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(pickupPayload);

      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Bad Request');
    });

    /**
     * Route-registration control. A spy that dropped the controller's route
     * metadata would make every request 404, and "the handler was not
     * called" would then be true for an entirely uninteresting reason. A 403
     * rather than a 404 proves POST /pickups is a live, mapped route that
     * authorization actively refused.
     */
    it('control: POST /pickups is a live mapped route, so the 403 is a refusal and not a missing route', async () => {
      const staffRes = await request(app.getHttpServer())
        .post('/pickups')
        .set('Authorization', `Bearer ${staffToken}`)
        .send(pickupPayload);

      expect(staffRes.status).not.toBe(404);
      expect(staffRes.status).toBe(403);
    });

    /**
     * Spy-integrity and database-writability control, and the reason the
     * "was not called" and "row count unchanged" assertions above carry
     * weight: without it they would pass just as happily against spies that
     * can never fire and a table that can never be written.
     *
     * The create path cannot be reached over HTTP by anyone while the DTO
     * defect above stands, so it is driven directly here — deliberately
     * bypassing the guards, which is sound for a control whose only job is
     * to show the instruments work.
     */
    it('control: the create spies are live and this database does accept a pickup INSERT', async () => {
      const rawBefore = await rawPickupRowCount();

      const controller = app.get(PickupsController);
      const created: any = await controller.create({
        address: '1 Control Street, Calgary AB',
      } as any);

      // Both frames that staff never reached do fire when they are executed.
      expect(controllerCreateSpy).toHaveBeenCalledTimes(1);
      expect(serviceCreateSpy).toHaveBeenCalledTimes(1);

      // And the INSERT that stayed absent under staff genuinely can happen.
      expect(await rawPickupRowCount()).toBe(rawBefore + 1);

      // Left as found, so no later count can be read off a polluted table.
      await dataSource.getRepository(Pickup).delete(created.id);
      expect(await rawPickupRowCount()).toBe(rawBefore);
    });
  });

  describe('CHECK 9 — authenticated staff may read pickups', () => {
    it('allows staff GET /pickups: authorization succeeds and the handler runs', async () => {
      const res = await request(app.getHttpServer())
        .get('/pickups')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(controllerFindAllSpy).toHaveBeenCalledTimes(1);
      expect(serviceFindAllSpy).toHaveBeenCalledTimes(1);
    });

    it('allows driver GET /pickups', async () => {
      const res = await request(app.getHttpServer())
        .get('/pickups')
        .set('Authorization', `Bearer ${driverToken}`);

      expect(res.status).toBe(200);
      expect(controllerFindAllSpy).toHaveBeenCalledTimes(1);
    });

    it('rejects an anonymous GET /pickups with 401', async () => {
      const res = await request(app.getHttpServer()).get('/pickups');

      expect(res.status).toBe(401);
      expect(controllerFindAllSpy).not.toHaveBeenCalled();
      expect(serviceFindAllSpy).not.toHaveBeenCalled();
    });
  });
});
