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
import { UserDivision } from '../src/divisions/entities/user-division.entity';
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
import { InvoicesModule } from '../src/invoices/invoices.module';
import { Invoice } from '../src/invoices/entities/invoice.entity';
import { InvoiceItem } from '../src/invoices/entities/invoice-item.entity';
import { Customer } from '../src/customers/entities/customer.entity';
import { CustomersModule } from '../src/customers/customers.module';
import { grantDivisions } from './fixtures/divisions-test.helper';
import { ACCOUNTING_ENTITIES } from '../src/accounting/accounting.module';
import { EmailOutbox } from '../src/mail/entities/email-outbox.entity';
import { PAYMENT_ENTITIES } from '../src/payments/payments.module';

describe('E2E Security: Server-Side Session Authentication & Cookie Lifecycle', () => {
  jest.setTimeout(30000);
  let app: INestApplication;
  let dataSource: DataSource;

  const WAREHOUSE_MR = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          dropSchema: true,
          entities: [
            ...PAYMENT_ENTITIES,
            ...ACCOUNTING_ENTITIES,
            EmailOutbox,
            User,
            AuditEvent,
            Warehouse,
            UserWarehouse,
            UserDivision,
            Role,
            Permission,
            RolePermission,
            UserRole,
            Invoice,
            InvoiceItem,
            Customer,
          ],
          synchronize: true,
        }),
        AuthModule,
        UsersModule,
        WarehousesModule,
        RolesModule,
        InvoicesModule,
        CustomersModule,
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

    // Replicate URL path rewriting middleware from main.ts
    app.use((req: any, res: any, next: any) => {
      // Cookie parsing
      if (req.headers.cookie) {
        req.cookies = {};
        for (const pair of req.headers.cookie.split(';')) {
          const idx = pair.indexOf('=');
          if (idx !== -1) {
            req.cookies[pair.slice(0, idx).trim()] = decodeURIComponent(
              pair.slice(idx + 1).trim(),
            );
          }
        }
      } else {
        req.cookies = {};
      }

      if (req.url.startsWith('/api/')) {
        req.url = req.url.substring(4);
      } else if (req.url === '/api') {
        req.url = '/';
      }
      next();
    });

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    dataSource = moduleRef.get(DataSource);

    await dataSource
      .getRepository(Warehouse)
      .save([{ id: WAREHOUSE_MR, name: 'Maple Ridge, BC', code: 'MR', active: true }]);

    const passwordHash = await bcrypt.hash('SecurePassword123!', 10);
    const userRepo = dataSource.getRepository(User);

    await userRepo.save([
      {
        fullName: 'Global Admin',
        email: 'admin@greenwave.test',
        password: passwordHash,
        role: 'admin',
        status: 'active',
      },
      {
        fullName: 'Warehouse Staff',
        email: 'staff@greenwave.test',
        password: passwordHash,
        role: 'staff',
        status: 'active',
      },
      {
        fullName: 'Deactivated User',
        email: 'disabled@greenwave.test',
        password: passwordHash,
        role: 'staff',
        status: 'inactive',
      },
    ]);

    await grantDivisions(
      dataSource,
      (await userRepo.find()).map((u) => u.id),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Authentication via Login & Safe Representation', () => {
    it('sets HttpOnly session cookie and readable CSRF cookie on successful login', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@greenwave.test', password: 'SecurePassword123!' })
        .expect(200);

      const raw = res.headers['set-cookie'];
      const cookies: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const sessionCookie = cookies.find((c: string) => c.startsWith('gw_session='));
      const csrfCookie = cookies.find((c: string) => c.startsWith('gw_csrf='));

      expect(sessionCookie).toBeTruthy();
      expect(sessionCookie).toMatch(/HttpOnly/i);
      expect(sessionCookie).toMatch(/Path=\//i);
      expect(sessionCookie).toMatch(/SameSite=Lax/i);

      expect(csrfCookie).toBeTruthy();
      expect(csrfCookie).not.toMatch(/HttpOnly/i); // Must be readable by client JS for CSRF header

      expect(res.body.user).toBeTruthy();
      expect(res.body.user.email).toBe('admin@greenwave.test');
      expect(res.body.user.password).toBeUndefined(); // Never returns password or hash
      expect(res.body.user.passwordHash).toBeUndefined();
    });

    it('rejects invalid password with generic error message', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@greenwave.test', password: 'WrongPassword!' })
        .expect(401);

      expect(res.body.message).toBe('Invalid credentials');
    });

    it('rejects non-existent user with identical generic error message', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'nonexistent@greenwave.test', password: 'WrongPassword!' })
        .expect(401);

      expect(res.body.message).toBe('Invalid credentials');
    });

    it('rejects disabled/inactive user', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'disabled@greenwave.test', password: 'SecurePassword123!' })
        .expect(401);

      expect(res.body.message).toBe('Invalid credentials');
    });
  });

  describe('2. Session Cookie Verification on Protected Routes', () => {
    let adminSessionCookie: string;
    let adminCsrfToken: string;

    beforeAll(async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@greenwave.test', password: 'SecurePassword123!' });

      const raw = loginRes.headers['set-cookie'];
      const cookies: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const rawSession = cookies.find((c: string) => c.startsWith('gw_session='));
      const rawCsrf = cookies.find((c: string) => c.startsWith('gw_csrf='));

      adminSessionCookie = rawSession!.split(';')[0];
      adminCsrfToken = rawCsrf!.split(';')[0].split('=')[1];
    });

    it('authenticates GET /api/auth/me using only the session cookie (no Bearer token)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', adminSessionCookie)
        .expect(200);

      expect(res.body.email).toBe('admin@greenwave.test');
      expect(res.body.role).toBe('admin');
      expect(res.body.password).toBeUndefined();
    });

    it('rejects unauthenticated request to /api/auth/me (401)', async () => {
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .expect(401);
    });

    it('rejects tampered or forged session cookie (401)', async () => {
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', 'gw_session=forged-random-fake-session-id')
        .expect(401);
    });

    it('logout invalidates server session and clears session cookie', async () => {
      // 1. Execute logout
      const logoutRes = await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Cookie', adminSessionCookie)
        .expect(200);

      const rawCleared = logoutRes.headers['set-cookie'];
      const clearedCookies: string[] = Array.isArray(rawCleared) ? rawCleared : rawCleared ? [rawCleared] : [];
      const clearedSession = clearedCookies.find((c: string) => c.startsWith('gw_session='));
      expect(clearedSession).toBeTruthy();

      // 2. Subsequent call with old session cookie must now 401
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', adminSessionCookie)
        .expect(401);
    });
  });
});
