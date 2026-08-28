import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import request from 'supertest';

import { AuditModule } from '../audit/audit.module';
import { AuditEvent } from '../audit/entities/audit-event.entity';
import { RedisService } from '../redis/redis.service';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { AuthModule } from './auth.module';

/**
 * Exercises the real HTTP layer (guards, JWT strategy, ValidationPipe,
 * RolesGuard) against an in-memory sqlite database. This is "tested
 * locally", not "integration tested" against the real stack — it does not
 * touch Postgres/Redis/MinIO, which this sandbox doesn't have running. See
 * docs/V2_IMPLEMENTATION.md for what still needs a real docker-compose run.
 */
describe('Auth + RBAC (sqlite, no external infra)', () => {
  let app: INestApplication;
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
          entities: [User, AuditEvent],
          synchronize: true,
        }),
        AuditModule,
        UsersModule,
        AuthModule,
      ],
    })
      .overrideProvider(RedisService)
      .useValue({
        getClient: () => ({
          incr: async () => 1,
          expire: async () => undefined,
        }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('bootstraps the first account as admin via POST /auth/register', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ fullName: 'Admin', email: 'Admin@Test.local', password: 'Password1' })
      .expect(201);

    expect(res.body.user.role).toBe('admin');
    expect(res.body.user.email).toBe('admin@test.local'); // normalized
    expect(res.body.access_token).toBeDefined();
    adminToken = res.body.access_token;
  });

  it('refuses a second bootstrap once a user exists', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ fullName: 'Second', email: 'second@test.local', password: 'Password1' })
      .expect(409);
  });

  it('rejects login for an unknown email', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'nobody@test.local', password: 'whatever' })
      .expect(401);
  });

  it('rejects login with the wrong password', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@test.local', password: 'WrongPassword1' })
      .expect(401);
  });

  it('logs in with the correct password (200 OK, matches API-CONTRACT.md)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@test.local', password: 'Password1' })
      .expect(200);

    expect(res.body.access_token).toBeDefined();
    expect(res.body.user.password).toBeUndefined();
  });

  it('rejects an unauthenticated request to a protected route', async () => {
    await request(app.getHttpServer()).get('/users').expect(401);
  });

  it('lets an admin create a staff user', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'Staff Person', email: 'staff@test.local', password: 'Password1', role: 'staff' })
      .expect(201);

    expect(res.body.role).toBe('staff');
    expect(res.body.password).toBeUndefined();

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'staff@test.local', password: 'Password1' })
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
      .send({ fullName: 'Sneaky Admin', email: 'sneaky@test.local', password: 'Password1', role: 'admin' })
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

    expect(res.body.email).toBe('staff@test.local');
  });
});
