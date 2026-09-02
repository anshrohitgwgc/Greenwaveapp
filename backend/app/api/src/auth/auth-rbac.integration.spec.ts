import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { AuditModule } from '../audit/audit.module';
import { AuditEvent } from '../audit/entities/audit-event.entity';
import { RedisService } from '../redis/redis.service';
import { Permission } from '../roles/entities/permission.entity';
import { Role } from '../roles/entities/role.entity';
import { RolePermission } from '../roles/entities/role-permission.entity';
import { UserRole } from '../roles/entities/user-role.entity';
import { RolesModule } from '../roles/roles.module';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/users.service';
import { UserDivision } from '../divisions/entities/user-division.entity';
import { UserWarehouse } from '../warehouses/entities/user-warehouse.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { AuthModule } from './auth.module';

/**
 * Exercises the real HTTP layer (guards, JWT strategy, ValidationPipe,
 * RolesGuard) against an in-memory sqlite database.
 */
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
describe('Auth + RBAC (sqlite, no external infra)', () => {
  jest.setTimeout(30000);
  let app: INestApplication;
  let usersService: UsersService;
  let adminToken: string;
  let staffToken: string;

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
            Role,
            Permission,
            RolePermission,
            UserRole,
            Warehouse,
            UserWarehouse,
            UserDivision,
          ],
          synchronize: true,
        }),
        AuditModule,
        RolesModule,
        WarehousesModule,
        UsersModule,
        AuthModule,
      ],
    })
      .overrideProvider(RedisService)
      .useValue({
        getClient: () => ({
          incr: () => Promise.resolve(1),
          expire: () => Promise.resolve(undefined),
        }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    usersService = moduleRef.get(UsersService);

    // Seed initial admin account
    const hashedPassword = await bcrypt.hash('Password1', 12);
    await usersService.create({
      fullName: 'System Administrator',
      email: 'admin@greenwave.test',
      password: hashedPassword,
      role: 'admin',
    });

    // Obtain baseline admin token for authenticated admin operations
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@greenwave.test', password: 'Password1' });
    adminToken = adminLogin.body.access_token;

    // Seed baseline staff account and token so staff tests can execute independently
    await usersService.create({
      fullName: 'Baseline Staff Person',
      email: 'staff-base@greenwave.test',
      password: hashedPassword,
      role: 'staff',
    });
    const staffLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'staff-base@greenwave.test', password: 'Password1' });
    staffToken = staffLogin.body.access_token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects public registration via POST /auth/register (403 Forbidden)', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        fullName: 'Self Registered',
        email: 'self@test.local',
        password: 'Password1',
      })
      .expect(403);
  });

  it('rejects login for an unknown email', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'nobody@greenwave.test', password: 'whatever' })
      .expect(401);
  });

  it('rejects login with the wrong password', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@greenwave.test', password: 'WrongPassword1' })
      .expect(401);
  });

  it('logs in admin with correct email and password (200 OK)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@greenwave.test', password: 'Password1' })
      .expect(200);

    expect(res.body.access_token).toBeDefined();
    expect(res.body.user.email).toBe('admin@greenwave.test');
    expect(res.body.user.role).toBe('admin');
    expect(res.body.user.password).toBeUndefined();
    adminToken = res.body.access_token;
  });

  it('rejects an unauthenticated request to a protected route', async () => {
    await request(app.getHttpServer()).get('/users').expect(401);
  });

  it('lets an admin create a staff user via POST /users', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Staff Person',
        email: 'staff@greenwave.test',
        password: 'Password1',
        role: 'staff',
      })
      .expect(201);

    expect(res.body.role).toBe('staff');
    expect(res.body.email).toBe('staff@greenwave.test');
    expect(res.body.password).toBeUndefined();

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'staff@greenwave.test', password: 'Password1' })
      .expect(200);
    staffToken = login.body.access_token;
  });

  it('a staff token cannot list all users (admin/manager only route)', async () => {
    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);
  });

  it('a staff token cannot create other users (admin-only route)', async () => {
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        fullName: 'Sneaky Admin',
        email: 'sneaky@test.local',
        password: 'Password1',
        role: 'admin',
      })
      .expect(403);
  });

  it('an admin token can list all users', async () => {
    const res = await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it('any authenticated user can read their own profile via /users/me', async () => {
    const res = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);

    expect(res.body.email).toBe('staff@greenwave.test');
  });

  it('any authenticated user can read their own profile via /auth/me', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);

    expect(res.body.email).toBe('staff@greenwave.test');
    expect(res.body.permissions).toBeDefined();
    expect(res.body.warehouses).toBeDefined();
  });
});
