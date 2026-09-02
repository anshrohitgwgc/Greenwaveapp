import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';

/**
 * Invoice numbering under real concurrency.
 *
 * The unit spec (invoice-numbering.spec.ts) pins the *statement* the service
 * issues. It cannot prove the property that actually matters -- that two
 * simultaneous creates never receive the same number -- because that is a
 * guarantee of the PostgreSQL sequence, not of our code. So this spec runs
 * migration 016 against a throwaway database and hammers the real sequence.
 *
 * Requires a reachable PostgreSQL. The rest of the suite runs on in-memory
 * SQLite with no infrastructure, so when no server answers we skip loudly
 * rather than fail the suite on a machine that never had a database.
 */

// Nest's ConfigModule is not booted here, so nothing has read .env yet.
// Real environment variables still take precedence.
loadEnv({ path: join(__dirname, '../..', '.env'), quiet: true });

const MIGRATION = readFileSync(
  join(
    __dirname,
    '../../../../database/migrations/016_invoice_number_sequence.sql',
  ),
  'utf8',
);

/**
 * Invoice numbers that survive in production. The new series must start at
 * 10000 regardless of these -- it does NOT continue from 1126.
 */
const SURVIVING_INVOICES = ['1115', '1116', '1125', '1126'];
const FIRST_EXPECTED = 10000;

/** Must cover the largest concurrent batch, or the pool serialises the batch
 * and we would be testing a queue rather than concurrency. */
const POOL_SIZE = 30;

const THROWAWAY_DB = `gw_seq_it_${process.pid}`;

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
 *
 * This must be answered *synchronously*: jest registers tests up front, so a
 * flag set in beforeAll would still be false when the describe below runs and
 * would silently skip everything. Hence one short child process.
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
    `SELECT nextval('invoice_number_seq')`,
  );
  return Number(rows[0].nextval);
}

const available = postgresReachable();
if (!available) {
  const { host, port } = conn();
  console.warn(
    `[invoice-numbering.integration] SKIPPED: cannot reach PostgreSQL at ` +
      `${host}:${port}. Concurrency and no-reuse guarantees were NOT ` +
      `verified in this run.`,
  );
}
const describeIfPg = available ? describe : describe.skip;

describeIfPg('invoice numbering against a real PostgreSQL sequence', () => {
  beforeAll(async () => {
    const admin = dataSourceFor('postgres');
    await admin.initialize();
    await admin.query(`DROP DATABASE IF EXISTS ${THROWAWAY_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${THROWAWAY_DB}`);
    await admin.destroy();

    ds = dataSourceFor(THROWAWAY_DB, POOL_SIZE);
    await ds.initialize();

    await ds.query(
      `CREATE TABLE invoices (
         id SERIAL PRIMARY KEY,
         invoice_number TEXT UNIQUE NOT NULL
       )`,
    );
    await ds.query(
      `INSERT INTO invoices (invoice_number) SELECT unnest($1::text[])`,
      [SURVIVING_INVOICES],
    );
    // Migration 016 comments on this table, so it must exist as it does in prod.
    await ds.query(
      `CREATE TABLE invoice_number_counter (id INT PRIMARY KEY, next_value BIGINT)`,
    );
    await ds.query(`INSERT INTO invoice_number_counter VALUES (1, 1127)`);

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

  it('issues 10000 first, even though invoice 1126 exists', async () => {
    await expect(allocate()).resolves.toBe(FIRST_EXPECTED);
  });

  it('issues 10001 second', async () => {
    await expect(allocate()).resolves.toBe(FIRST_EXPECTED + 1);
  });

  it('does not reuse a deleted invoice number', async () => {
    await ds!.query(`DELETE FROM invoices WHERE invoice_number = '10001'`);

    const next = await allocate();

    expect(next).toBe(FIRST_EXPECTED + 2);
    expect(next).not.toBe(FIRST_EXPECTED + 1);
  });

  it('does not reissue a number burned by a rolled-back transaction', async () => {
    const runner = ds!.createQueryRunner();
    let burned: number;
    try {
      await runner.connect();
      await runner.startTransaction();
      // QueryRunner.query is untyped, unlike DataSource.query; cast the way
      // InvoicesService does.
      const rows = (await runner.query(
        `SELECT nextval('invoice_number_seq')`,
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
      expect(numbers[0]).toBeGreaterThanOrEqual(FIRST_EXPECTED);
    }, 60_000);
  }

  it('never renumbers the invoices that already existed', async () => {
    const rows = await ds!.query<Array<{ invoice_number: string }>>(
      `SELECT invoice_number FROM invoices
        WHERE invoice_number = ANY($1::text[])
        ORDER BY invoice_number`,
      [SURVIVING_INVOICES],
    );

    expect(rows.map((r) => r.invoice_number)).toEqual(SURVIVING_INVOICES);
  });
});
