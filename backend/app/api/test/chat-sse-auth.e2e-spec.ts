/* eslint-disable */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import * as http from 'http';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AuditModule } from '../src/audit/audit.module';
import { AuditEvent } from '../src/audit/entities/audit-event.entity';
import { AuthModule } from '../src/auth/auth.module';
import { ChatMessage } from '../src/chat/entities/chat-message.entity';
import { ChatModule } from '../src/chat/chat.module';
import { Permission } from '../src/roles/entities/permission.entity';
import { Role } from '../src/roles/entities/role.entity';
import { RolePermission } from '../src/roles/entities/role-permission.entity';
import { UserRole } from '../src/roles/entities/user-role.entity';
import { RolesModule } from '../src/roles/roles.module';
import { RedisService } from '../src/redis/redis.service';
import { User } from '../src/users/entities/user.entity';
import { UsersModule } from '../src/users/users.module';
import { UserWarehouse } from '../src/warehouses/entities/user-warehouse.entity';
import { Warehouse } from '../src/warehouses/entities/warehouse.entity';
import { WarehousesModule } from '../src/warehouses/warehouses.module';

/**
 * The Chat UI's real-time delivery depends on the browser's EventSource
 * API hitting GET /chat/stream — EventSource cannot set an Authorization
 * header, so the frontend passes the JWT as `?token=`. This proves that
 * path is actually wired up server-side (JwtStrategy must accept the
 * query-param token as a fallback), not just unit-testing the extractor
 * function in isolation.
 */
describe('E2E Security: /chat/stream SSE authentication', () => {
  jest.setTimeout(20000);
  let app: INestApplication;
  let baseUrl: string;
  let token: string;

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
            ChatMessage,
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
        ChatModule,
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
    await app.listen(0);
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    const dataSource = moduleRef.get(DataSource);
    const passwordHash = await bcrypt.hash('TestPass123!', 10);
    await dataSource.getRepository(User).save({
      fullName: 'Chat Staff',
      email: 'chat-staff@greenwave.test',
      password: passwordHash,
      role: 'staff',
      status: 'active',
    });

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'chat-staff@greenwave.test', password: 'TestPass123!' });
    token = res.body.access_token;
    expect(token).toBeTruthy();
  });

  afterAll(async () => {
    await app.close();
  });

  function probeStatus(path: string, headers: http.OutgoingHttpHeaders = {}) {
    return new Promise<number>((resolve, reject) => {
      const req = http.get(baseUrl + path, { headers }, (res) => {
        const status = res.statusCode ?? 0;
        req.destroy();
        res.destroy();
        resolve(status);
      });
      req.on('error', (err: NodeJS.ErrnoException) => {
        // Destroying the socket after we already have the status races
        // with a benign ECONNRESET on some Node versions — anything else
        // is a real failure.
        if (err.code === 'ECONNRESET') return;
        reject(err);
      });
    });
  }

  it('accepts a valid token passed as ?token= (what EventSource actually sends)', async () => {
    const status = await probeStatus(`/chat/stream?token=${token}`);
    expect(status).toBe(200);
  });

  it('still accepts a standard Authorization: Bearer header', async () => {
    const status = await probeStatus('/chat/stream', {
      Authorization: `Bearer ${token}`,
    });
    expect(status).toBe(200);
  });

  it('rejects a request with no token at all', async () => {
    const status = await probeStatus('/chat/stream');
    expect(status).toBe(401);
  });

  it('rejects a garbage/forged query token', async () => {
    const status = await probeStatus('/chat/stream?token=not-a-real-jwt');
    expect(status).toBe(401);
  });
});
