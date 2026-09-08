import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';

import { formatPurchaseOrderNumber } from './purchase-orders.service';

/**
 * Purchase order numbering under real concurrency.
 *
 * The unit spec pins the *statement* the service issues. It cannot prove the
 * property that actually matters -- that two simultaneous creates never
 * receive the same number -- because that is a guarantee of the PostgreSQL
 * sequence, not of our code. So this spec runs migration 018 against a
 * throwaway database and hammers the real sequence.
 *
 * Requires a reachable PostgreSQL. The rest of the suite runs on in-memory
 * SQLite with no infrastructure, so when no server answers we skip loudly
 * rather than fail the suite on a machine that never had a database.
 */

// Nest's ConfigModule is not booted here, so nothing has read .env yet.
// Real environment variables still take precedence.
loadEnv({ path: join(__dirname, '../..', '.env'), quiet: true });

const MIGRATION = readFileSync(
  join(__dirname, '../../../../database/migrations/018_purchase_orders.sql'),
  'utf8',
);

const FIRST_EXPECTED = 1;

/** Must cover the largest concurrent batch, or the pool serialises it and we
 * would be testing a queue rather than concurrency. */
const POOL_SIZE = 30;

const THROWAWAY_DB = `gw_po_seq_it_${process.pid}`;

type Conn = {
  host: string;
  port: number;
  username: string | undefined;
  password: string | undefined;
};

function conn(): Conn {
  return {
    host: process.env.DATABASE_HOST ?? process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DATABASE_PORT ?? process.env.DB_PORT ?? 5432),
    username: process.env.DATABASE_USER ?? process.env.DB_USERNAME,
    password: process.env.DATABASE_PASSWORD ?? process.env.DB_PASSWORD,
  };
}

function dataSourceFor(database: string, poolSize?: number): DataSource {
  return new DataSource({
    type: 'postgres',
    ...conn(),
    database,
    poolSize,
    synchronize: false,
    logging: false,
  });
}

/**
 * Whether a PostgreSQL we can actually authenticate against is reachable.
 * Must be answered *synchronously*: jest registers tests up front, so a flag
 * set in beforeAll would still be false when the describe below runs and would
 * silently skip everything. Hence one short child process.
 */
function postgresReachable(): boolean {
  const { host, port, username, password } = conn();
  try {
    execFileSync(
      process.execPath,
      [
        '-e',
        `const { Client } = require('pg');
         new Client({
           host: process.env.PROBE_HOST,
           port: Number(process.env.PROBE_PORT),
           user: process.env.PROBE_USER,
           password: process.env.PROBE_PASSWORD,
           database: 'postgres',
           connectionTimeoutMillis: 5000,
         }).connect().then(() => process.exit(0)).catch(() => process.exit(1));`,
      ],
      {
        cwd: join(__dirname, '../..'),
        stdio: 'ignore',
        timeout: 15_000,
        env: {
          ...process.env,
          PROBE_HOST: host,
          PROBE_PORT: String(port),
          PROBE_USER: username ?? '',
          PROBE_PASSWORD: password ?? '',
        },
      },
    );
    return true;
  } catch {
    return false;
  }
}

let ds: DataSource | undefined;

async function allocate(): Promise<number> {
  const rows = await ds!.query<Array<{ nextval: string }>>(
    `SELECT nextval('purchase_order_number_seq')`,
  );
  return Number(rows[0].nextval);
}

/** Inserts a PO carrying an allocated number, exercising the UNIQUE columns. */
async function insertPurchaseOrder(sequence: number): Promise<void> {
  await ds!.query(
    `INSERT INTO purchase_orders
       (po_number, sequence_number, order_date, supplier_name, created_by)
     VALUES ($1, $2, CURRENT_DATE, 'Test Supplier', 1)`,
    [formatPurchaseOrderNumber(sequence), sequence],
  );
}

const available = postgresReachable();
if (!available) {
  const { host, port } = conn();
  console.warn(
    `[purchase-order-numbering.integration] SKIPPED: cannot reach PostgreSQL ` +
      `at ${host}:${port}. Concurrency and no-reuse guarantees were NOT ` +
      `verified in this run.`,
  );
}
const describeIfPg = available ? describe : describe.skip;

describeIfPg(
  'purchase order numbering against a real PostgreSQL sequence',
  () => {
    beforeAll(async () => {
      const admin = dataSourceFor('postgres');
      await admin.initialize();
      await admin.query(`DROP DATABASE IF EXISTS ${THROWAWAY_DB} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${THROWAWAY_DB}`);
      await admin.destroy();

      ds = dataSourceFor(THROWAWAY_DB, POOL_SIZE);
      await ds.initialize();

      // Migration 018 references these; stand up the minimum it needs rather
      // than replaying every earlier migration.
      await ds.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
      await ds.query(`CREATE TABLE "user" (id SERIAL PRIMARY KEY)`);
      await ds.query(`INSERT INTO "user" DEFAULT VALUES`);
      await ds.query(`CREATE TABLE warehouses (id UUID PRIMARY KEY)`);

      await ds.query(MIGRATION);
    }, 60_000);

    afterAll(async () => {
      if (!ds) return;
      await ds.destroy();
      ds = undefined;

      const admin = dataSourceFor('postgres');
      await admin.initialize();
      await admin.query(`DROP DATABASE IF EXISTS ${THROWAWAY_DB} WITH (FORCE)`);
      await admin.destroy();
    }, 60_000);

    // These run in declaration order and share one sequence, which is the point:
    // the series must stay monotonic across every operation below.

    it('issues 1 first on a fresh install, rendering PO-0001', async () => {
      const first = await allocate();
      expect(first).toBe(FIRST_EXPECTED);
      expect(formatPurchaseOrderNumber(first)).toBe('PO-0001');
      await insertPurchaseOrder(first);
    });

    it('issues PO-0002 then PO-0003', async () => {
      const second = await allocate();
      expect(formatPurchaseOrderNumber(second)).toBe('PO-0002');
      await insertPurchaseOrder(second);

      const third = await allocate();
      expect(formatPurchaseOrderNumber(third)).toBe('PO-0003');
      await insertPurchaseOrder(third);
    });

    it('does not reuse the number of a deleted purchase order', async () => {
      await ds!.query(
        `DELETE FROM purchase_orders WHERE po_number = 'PO-0003'`,
      );

      const next = await allocate();

      expect(next).toBe(4);
      expect(formatPurchaseOrderNumber(next)).toBe('PO-0004');
      // The freed number is gone for good, not recycled.
      expect(next).not.toBe(3);
      await insertPurchaseOrder(next);
    });

    it('does not reissue a number burned by a rolled-back transaction', async () => {
      const runner = ds!.createQueryRunner();
      let burned: number;
      try {
        await runner.connect();
        await runner.startTransaction();
        // QueryRunner.query is untyped, unlike DataSource.query.
        const rows = (await runner.query(
          `SELECT nextval('purchase_order_number_seq')`,
        )) as Array<{ nextval: string }>;
        burned = Number(rows[0].nextval);
        await runner.rollbackTransaction();
      } finally {
        await runner.release();
      }

      await expect(allocate()).resolves.toBeGreaterThan(burned);
    });

    for (const n of [15, 25]) {
      it(`allocates ${n} concurrent numbers with no duplicates`, async () => {
        const numbers = (
          await Promise.all(Array.from({ length: n }, () => allocate()))
        ).sort((a, b) => a - b);

        expect(numbers).toHaveLength(n);
        expect(new Set(numbers).size).toBe(n);
        // Strictly allocated: the batch occupies exactly n consecutive values,
        // so nothing was skipped and nothing was handed out twice.
        expect(numbers[n - 1] - numbers[0]).toBe(n - 1);
      }, 60_000);
    }

    it('lets concurrent inserts all persist, proving no duplicate keys collide', async () => {
      const n = 20;
      const allocated = await Promise.all(
        Array.from({ length: n }, () => allocate()),
      );
      await Promise.all(allocated.map((seq) => insertPurchaseOrder(seq)));

      const rows = await ds!.query<Array<{ count: string }>>(
        `SELECT COUNT(DISTINCT po_number) AS count FROM purchase_orders`,
      );
      const distinct = Number(rows[0].count);
      const totalRows = await ds!.query<Array<{ count: string }>>(
        `SELECT COUNT(*) AS count FROM purchase_orders`,
      );
      expect(distinct).toBe(Number(totalRows[0].count));
    }, 60_000);

    it('is idempotent: re-running the migration never rewinds the series', async () => {
      const before = await allocate();
      await ds!.query(MIGRATION);
      const after = await allocate();

      expect(after).toBeGreaterThan(before);
    }, 60_000);
  },
);
