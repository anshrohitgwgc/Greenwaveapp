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
import { UserDivision } from '../src/divisions/entities/user-division.entity';
import { PurchaseOrderItem } from '../src/purchase-orders/entities/purchase-order-item.entity';
import { PurchaseOrder } from '../src/purchase-orders/entities/purchase-order.entity';
import { PurchaseOrdersModule } from '../src/purchase-orders/purchase-orders.module';
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
 * Purchase Orders: authorization, numbering and server-side arithmetic.
 *
 * The three things this suite exists to prove:
 *   1. Admin-only is enforced by the *server*. Every test here talks straight
 *      to the API with a hand-made request, exactly as someone bypassing the
 *      UI would -- hiding a button proves nothing.
 *   2. Numbers come from the database, start at PO-0001, are sequential, and
 *      are never reissued after a delete.
 *   3. Amounts and totals are recomputed server-side, so a client that sends
 *      its own figures cannot influence what is stored.
 */
describe('E2E: Purchase Orders — admin RBAC, numbering & server-side totals', () => {
  jest.setTimeout(30000);
  let app: INestApplication;
  let dataSource: DataSource;

  const WAREHOUSE_MR = '11111111-1111-4111-8111-111111111111';

  let adminToken: string;
  let managerToken: string;
  let staffToken: string;
  let driverToken: string;

  /**
   * Normalises a NUMERIC column to a fixed 2-decimal string.
   *
   * The `pg` driver returns NUMERIC as a string ("21940.00") to avoid
   * precision loss, while better-sqlite3 — which this suite runs on — hands
   * back a JS number (21940). Asserting the raw representation would therefore
   * pass on one driver and fail on the other while the *stored value* is
   * identical. Comparing normalised cents keeps the assertion exact and true
   * on both.
   */
  const money = (value: unknown): string => Number(value).toFixed(2);

  /** A complete, valid create payload. Tests clone and tweak it. */
  const validPayload = (overrides: Record<string, unknown> = {}) => ({
    orderDate: '2026-09-07',
    expectedDate: '2026-09-21',
    currency: 'USD',
    supplierName: 'Greenwave Recycling',
    supplierAddress: '23394, Fisherman Rd',
    supplierCity: 'Maple Ridge',
    supplierProvince: 'BC',
    supplierPostalCode: 'V3W 1B9',
    supplierCountry: 'CANADA',
    supplierPhone: '1-672-472-0423',
    supplierEmail: 'sales@greenwaverecycling.ca',
    division: 'greenwave',
    items: [
      {
        code: 'UTL',
        resin: 'HDPE',
        description: 'PE100 REPRO',
        color: 'Noir',
        quantity: 54850,
        unit: 'lbs',
        unitPrice: 0.4,
      },
    ],
    ...overrides,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        TypeOrmModule.forRoot({
          ...gateDatabase('po'),
          entities: [
            User,
            AuditEvent,
            Warehouse,
            UserWarehouse,
            UserDivision,
            PurchaseOrder,
            PurchaseOrderItem,
            Role,
            Permission,
            RolePermission,
            UserRole,
          ],
        }),
        AuthModule,
        UsersModule,
        WarehousesModule,
        RolesModule,
        PurchaseOrdersModule,
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
    // Mirrors main.ts exactly, including forbidNonWhitelisted — the tests below
    // rely on an unknown field being *rejected*, not silently stripped.
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

    // PO numbering falls back to this counter table on non-PostgreSQL drivers
    // (see purchase-orders.service.ts#allocateSequenceNumber). No entity maps
    // to it, so synchronize:true does not create it.
    await dataSource.query(
      `CREATE TABLE IF NOT EXISTS purchase_order_number_counter (id INT PRIMARY KEY, next_value BIGINT)`,
    );

    const passwordHash = await bcrypt.hash('TestPass123!', 10);
    const userRepo = dataSource.getRepository(User);
    for (const [fullName, email, role] of [
      ['Global Admin', 'admin@greenwave.test', 'admin'],
      ['Ops Manager', 'manager@greenwave.test', 'manager'],
      ['Warehouse Staff', 'staff@greenwave.test', 'staff'],
      ['Route Driver', 'driver@greenwave.test', 'driver'],
    ]) {
      await userRepo.save({
        fullName,
        email,
        password: passwordHash,
        role,
        status: 'active',
      });
    }

    // Division access held constant: this suite asserts *role* behaviour.
    // Purchase orders are Recycling-only (RecyclingFinanceGuard), and a
    // multi-division actor must name its context, so grant Recycling alone;
    // the division boundary itself is covered by
    // invoice-po-division-isolation.e2e-spec.ts.
    await grantDivisions(
      dataSource,
      (await userRepo.find()).map((u) => u.id),
      ['greenwave'],
    );

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
  });

  afterAll(async () => {
    await app.close();
  });

  // --------------------------------------------------------------------------
  describe('1. Sequential numbering starting at PO-0001', () => {
    const created: string[] = [];

    it('previews PO-0001 before anything has been created, without consuming it', async () => {
      const res = await request(app.getHttpServer())
        .get('/purchase-orders/next-number')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.nextNumber).toBe('PO-0001');
      expect(res.body.preview).toBe(true);

      // Asking twice must not advance the series.
      const again = await request(app.getHttpServer())
        .get('/purchase-orders/next-number')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(again.body.nextNumber).toBe('PO-0001');
    });

    it('issues PO-0001 to the first purchase order', async () => {
      const res = await request(app.getHttpServer())
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload())
        .expect(201);

      expect(res.body.poNumber).toBe('PO-0001');
      created.push(res.body.id);
    });

    it('issues PO-0002 and PO-0003 to the next two', async () => {
      for (const expected of ['PO-0002', 'PO-0003']) {
        const res = await request(app.getHttpServer())
          .post('/purchase-orders')
          .set('Authorization', `Bearer ${adminToken}`)
          .send(validPayload())
          .expect(201);
        expect(res.body.poNumber).toBe(expected);
        created.push(res.body.id);
      }
    });

    it('never reuses the number of a deleted purchase order', async () => {
      const doomed = created.pop()!; // PO-0003
      await request(app.getHttpServer())
        .delete(`/purchase-orders/${doomed}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload())
        .expect(201);

      // The series continues past the deleted number rather than refilling it.
      expect(res.body.poNumber).toBe('PO-0004');
      expect(res.body.poNumber).not.toBe('PO-0003');
      created.push(res.body.id);
    });

    it('issues a unique number to every purchase order ever created', async () => {
      const all = await request(app.getHttpServer())
        .get('/purchase-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const numbers = all.body.map((po: any) => po.poNumber);
      expect(new Set(numbers).size).toBe(numbers.length);
    });

    it('ignores a client-supplied poNumber instead of honouring it', async () => {
      // forbidNonWhitelisted means the attempt is rejected outright — the
      // number cannot be set even to a value that would collide.
      await request(app.getHttpServer())
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload({ poNumber: 'PO-0001', sequenceNumber: 1 }))
        .expect(400);
    });
  });

  // --------------------------------------------------------------------------
  describe('2. Admin-only authorization, enforced server-side', () => {
    let adminPoId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload());
      adminPoId = res.body.id;
    });

    it('admin can create, read, edit and delete', async () => {
      const created = await request(app.getHttpServer())
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload())
        .expect(201);

      await request(app.getHttpServer())
        .get(`/purchase-orders/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/purchase-orders/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ supplierName: 'Renamed Supplier' })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/purchase-orders/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    // A manager may manage invoices, so this is the case most likely to be got
    // wrong by copying the invoice controller: purchase orders are stricter.
    for (const [label, tokenFor] of [
      ['manager', () => managerToken],
      ['staff', () => staffToken],
      ['driver', () => driverToken],
    ] as const) {
      describe(`a ${label} constructing the request by hand`, () => {
        it('is refused on create (403)', async () => {
          await request(app.getHttpServer())
            .post('/purchase-orders')
            .set('Authorization', `Bearer ${tokenFor()}`)
            .send(validPayload())
            .expect(403);
        });

        it('is refused on edit (403)', async () => {
          await request(app.getHttpServer())
            .patch(`/purchase-orders/${adminPoId}`)
            .set('Authorization', `Bearer ${tokenFor()}`)
            .send({ supplierName: 'Hijacked' })
            .expect(403);
        });

        it('is refused on delete (403)', async () => {
          await request(app.getHttpServer())
            .delete(`/purchase-orders/${adminPoId}`)
            .set('Authorization', `Bearer ${tokenFor()}`)
            .expect(403);
        });

        it('is refused on list and read — supplier pricing is not theirs to see (403)', async () => {
          await request(app.getHttpServer())
            .get('/purchase-orders')
            .set('Authorization', `Bearer ${tokenFor()}`)
            .expect(403);

          await request(app.getHttpServer())
            .get(`/purchase-orders/${adminPoId}`)
            .set('Authorization', `Bearer ${tokenFor()}`)
            .expect(403);
        });

        it('is refused the next-number preview (403)', async () => {
          await request(app.getHttpServer())
            .get('/purchase-orders/next-number')
            .set('Authorization', `Bearer ${tokenFor()}`)
            .expect(403);
        });
      });
    }

    it('a forged role claim in the request body changes nothing', async () => {
      // The role is resolved from the JWT server-side; nothing in the body is
      // consulted. The unknown field is rejected before it is ever looked at.
      await request(app.getHttpServer())
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${staffToken}`)
        .send(validPayload({ role: 'admin', isAdmin: true }))
        .expect(403);
    });

    it('rejects an unauthenticated request (401)', async () => {
      await request(app.getHttpServer())
        .get('/purchase-orders')
        .expect(401);

      await request(app.getHttpServer())
        .post('/purchase-orders')
        .send(validPayload())
        .expect(401);
    });

    it('rejects a tampered bearer token (401)', async () => {
      await request(app.getHttpServer())
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${adminToken.slice(0, -3)}xyz`)
        .send(validPayload())
        .expect(401);
    });

    it('the purchase order survived every unauthorized attempt above, unmodified', async () => {
      const res = await request(app.getHttpServer())
        .get(`/purchase-orders/${adminPoId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.supplierName).toBe('Greenwave Recycling');
    });
  });

  // --------------------------------------------------------------------------
  describe('3. Server-side recalculation — client figures are never trusted', () => {
    it('recomputes the line amount and total from quantity x unit price', async () => {
      const res = await request(app.getHttpServer())
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload())
        .expect(201);

      expect(money(res.body.items[0].amount)).toBe('21940.00');
      expect(money(res.body.total)).toBe('21940.00');
    });

    it('rejects a client-supplied line amount rather than storing it', async () => {
      await request(app.getHttpServer())
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(
          validPayload({
            items: [
              {
                description: 'PE100 REPRO',
                quantity: 54850,
                unitPrice: 0.4,
                amount: '1.00', // attacker-supplied
              },
            ],
          }),
        )
        .expect(400);
    });

    it('rejects a client-supplied total rather than storing it', async () => {
      await request(app.getHttpServer())
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload({ total: '1.00' }))
        .expect(400);
    });

    it('recomputes the total on edit, even when only the items change', async () => {
      const created = await request(app.getHttpServer())
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload())
        .expect(201);
      expect(money(created.body.total)).toBe('21940.00');

      const updated = await request(app.getHttpServer())
        .patch(`/purchase-orders/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [
            { description: 'Line A', quantity: 100, unitPrice: 1.5 },
            { description: 'Line B', quantity: 10, unitPrice: 0.25 },
          ],
        })
        .expect(200);

      expect(updated.body.items).toHaveLength(2);
      expect(updated.body.items.map((i: any) => money(i.amount))).toEqual([
        '150.00',
        '2.50',
      ]);
      expect(money(updated.body.total)).toBe('152.50');
    });

    it('sums many line items exactly', async () => {
      const res = await request(app.getHttpServer())
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(
          validPayload({
            items: Array.from({ length: 10 }, (_, i) => ({
              description: `Line ${i + 1}`,
              quantity: 1,
              unitPrice: 0.1,
            })),
          }),
        )
        .expect(201);

      // 10 x 0.10 — exactly 1.00, with no floating-point drift.
      expect(money(res.body.total)).toBe('1.00');
    });

    it('keeps line order stable so the document renders as entered', async () => {
      const res = await request(app.getHttpServer())
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(
          validPayload({
            items: ['first', 'second', 'third'].map((d) => ({
              description: d,
              quantity: 1,
              unitPrice: 1,
            })),
          }),
        )
        .expect(201);

      expect(res.body.items.map((i: any) => i.description)).toEqual([
        'first',
        'second',
        'third',
      ]);
      expect(res.body.items.map((i: any) => i.sortOrder)).toEqual([0, 1, 2]);
    });
  });

  // --------------------------------------------------------------------------
  describe('4. Validation', () => {
    const invalid: Array<[string, Record<string, unknown>]> = [
      ['no line items', { items: [] }],
      ['a missing supplier name', { supplierName: undefined }],
      ['a blank supplier name', { supplierName: '' }],
      ['a missing order date', { orderDate: undefined }],
      ['a malformed order date', { orderDate: 'not-a-date' }],
      ['a malformed expected date', { expectedDate: '31/02/2026' }],
      ['an unsupported currency', { currency: 'EUR' }],
      ['a malformed supplier email', { supplierEmail: 'not-an-email' }],
      [
        'a zero quantity',
        { items: [{ description: 'X', quantity: 0, unitPrice: 1 }] },
      ],
      [
        'a negative quantity',
        { items: [{ description: 'X', quantity: -5, unitPrice: 1 }] },
      ],
      [
        'a negative unit price',
        { items: [{ description: 'X', quantity: 1, unitPrice: -1 }] },
      ],
      [
        'a line item with no description',
        { items: [{ quantity: 1, unitPrice: 1 }] },
      ],
      [
        'a non-numeric quantity',
        { items: [{ description: 'X', quantity: 'lots', unitPrice: 1 }] },
      ],
    ];

    for (const [label, overrides] of invalid) {
      it(`rejects ${label} with 400`, async () => {
        await request(app.getHttpServer())
          .post('/purchase-orders')
          .set('Authorization', `Bearer ${adminToken}`)
          .send(validPayload(overrides))
          .expect(400);
      });
    }

    it('accepts CAD as well as USD', async () => {
      const res = await request(app.getHttpServer())
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload({ currency: 'CAD' }))
        .expect(201);
      expect(res.body.currency).toBe('CAD');
    });

    it('returns 404 for an unknown id, and 400 for a malformed one', async () => {
      await request(app.getHttpServer())
        .get('/purchase-orders/99999999-9999-4999-8999-999999999999')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .get('/purchase-orders/not-a-uuid')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('does not leak internals in the not-found message', async () => {
      const res = await request(app.getHttpServer())
        .get('/purchase-orders/99999999-9999-4999-8999-999999999999')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      expect(res.body.message).toBe('Purchase order not found');
      expect(JSON.stringify(res.body)).not.toMatch(
        /SELECT|sqlite|postgres|stack|node_modules/i,
      );
    });
  });

  // --------------------------------------------------------------------------
  describe('5. Editing preserves the assigned number', () => {
    it('keeps the PO number across an edit that changes every other field', async () => {
      const created = await request(app.getHttpServer())
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload())
        .expect(201);

      const originalNumber = created.body.poNumber;

      const updated = await request(app.getHttpServer())
        .patch(`/purchase-orders/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          orderDate: '2026-10-01',
          expectedDate: '2026-10-15',
          currency: 'CAD',
          supplierName: 'Another Supplier Ltd.',
          supplierAddress: '1 Elsewhere Rd',
          supplierCity: 'Vancouver',
          supplierProvince: 'BC',
          supplierPostalCode: 'V6B 1A1',
          supplierCountry: 'CANADA',
          supplierPhone: '1-604-000-0000',
          supplierEmail: 'buyer@example.com',
          notes: 'Revised terms',
          footerDate: '2026-10-02',
          status: 'issued',
          items: [
            {
              code: 'ABC',
              resin: 'PP',
              description: 'Polypropylene regrind',
              color: 'Natural',
              quantity: 1000,
              unit: 'kg',
              unitPrice: 1.25,
            },
          ],
        })
        .expect(200);

      expect(updated.body.poNumber).toBe(originalNumber);
      expect(updated.body.supplierName).toBe('Another Supplier Ltd.');
      expect(updated.body.currency).toBe('CAD');
      expect(updated.body.status).toBe('issued');
      expect(money(updated.body.total)).toBe('1250.00');
    });

    it('clears an optional date when null is sent, rather than ignoring it', async () => {
      const created = await request(app.getHttpServer())
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload({ expectedDate: '2026-09-21', footerDate: '2026-09-07' }))
        .expect(201);
      expect(created.body.expectedDate).toBe('2026-09-21');

      // An absent field means "leave unchanged", so the editor sends an
      // explicit null to clear one. Both dates must actually clear.
      const cleared = await request(app.getHttpServer())
        .patch(`/purchase-orders/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expectedDate: null, footerDate: null })
        .expect(200);

      expect(cleared.body.expectedDate).toBeNull();
      expect(cleared.body.footerDate).toBeNull();
      // ...and an omitted field still leaves its value alone.
      const untouched = await request(app.getHttpServer())
        .patch(`/purchase-orders/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'only the notes changed' })
        .expect(200);
      expect(untouched.body.supplierName).toBe('Greenwave Recycling');
      expect(untouched.body.orderDate).toBe('2026-09-07');
    });

    it('replaces line items wholesale rather than appending them', async () => {
      const created = await request(app.getHttpServer())
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(
          validPayload({
            items: [
              { description: 'A', quantity: 1, unitPrice: 1 },
              { description: 'B', quantity: 1, unitPrice: 1 },
              { description: 'C', quantity: 1, unitPrice: 1 },
            ],
          }),
        )
        .expect(201);

      const updated = await request(app.getHttpServer())
        .patch(`/purchase-orders/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ description: 'Only one now', quantity: 2, unitPrice: 3 }] })
        .expect(200);

      expect(updated.body.items).toHaveLength(1);
      expect(money(updated.body.total)).toBe('6.00');
    });
  });

  // --------------------------------------------------------------------------
  describe('6. Deletion', () => {
    it('removes the purchase order and its line items', async () => {
      const created = await request(app.getHttpServer())
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload())
        .expect(201);

      const id = created.body.id;

      await request(app.getHttpServer())
        .delete(`/purchase-orders/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/purchase-orders/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      const orphans = await dataSource
        .getRepository(PurchaseOrderItem)
        .count({ where: { purchaseOrderId: id } });
      expect(orphans).toBe(0);
    });

    it('is a 404, not a 500, when deleting something already gone', async () => {
      await request(app.getHttpServer())
        .delete('/purchase-orders/99999999-9999-4999-8999-999999999999')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  // --------------------------------------------------------------------------
  describe('7. Audit trail', () => {
    it('records create, update and delete against the acting admin', async () => {
      const created = await request(app.getHttpServer())
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload())
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/purchase-orders/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'audited' })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/purchase-orders/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const events = await dataSource
        .getRepository(AuditEvent)
        .find({ where: { entityId: created.body.id } });

      expect(events.map((e) => e.action).sort()).toEqual([
        'purchase_order.created',
        'purchase_order.deleted',
        'purchase_order.updated',
      ]);
      for (const e of events) {
        expect(e.actorRole).toBe('admin');
      }
    });
  });

  // --------------------------------------------------------------------------
  describe('8. Acceptance — the reference purchase order end to end', () => {
    it('stores and returns every field from the PURCHASE.docx reference', async () => {
      const res = await request(app.getHttpServer())
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(
          validPayload({
            footerDate: '2026-09-07',
            notes: 'Reference acceptance order',
            companyInfo: {
              name: 'GreenWave Recycling Inc.',
              line1: '23394, Fisherman Rd',
              line2: 'Maple Ridge, BC, V3W 1B9, CANADA',
              phone: '1-672-472-0423',
              email: 'sales@greenwaverecycling.ca',
            },
          }),
        )
        .expect(201);

      const po = res.body;

      expect(po.poNumber).toMatch(/^PO-\d{4,}$/);
      expect(po.orderDate).toBe('2026-09-07');
      expect(po.expectedDate).toBe('2026-09-21');
      expect(po.currency).toBe('USD');

      expect(po.supplierName).toBe('Greenwave Recycling');
      expect(po.supplierAddress).toBe('23394, Fisherman Rd');
      expect(po.supplierCity).toBe('Maple Ridge');
      expect(po.supplierProvince).toBe('BC');
      expect(po.supplierPostalCode).toBe('V3W 1B9');
      expect(po.supplierCountry).toBe('CANADA');
      expect(po.supplierPhone).toBe('1-672-472-0423');
      expect(po.supplierEmail).toBe('sales@greenwaverecycling.ca');

      expect(po.companyInfo.name).toBe('GreenWave Recycling Inc.');
      expect(po.footerDate).toBe('2026-09-07');

      const line = po.items[0];
      expect(line.code).toBe('UTL');
      expect(line.resin).toBe('HDPE');
      expect(line.description).toBe('PE100 REPRO');
      expect(line.color).toBe('Noir');
      expect(Number(line.quantity)).toBe(54850);
      expect(line.unit).toBe('lbs');
      expect(Number(line.unitPrice)).toBe(0.4);
      expect(money(line.amount)).toBe('21940.00');

      expect(money(po.total)).toBe('21940.00');

      // And it reads back identically through GET, not just from the create
      // response.
      const fetched = await request(app.getHttpServer())
        .get(`/purchase-orders/${po.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(money(fetched.body.total)).toBe('21940.00');
      expect(money(fetched.body.items[0].amount)).toBe('21940.00');
    });
  });
});
