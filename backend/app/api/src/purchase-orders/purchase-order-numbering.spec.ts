import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PURCHASE_ORDER_NUMBER_START,
  PurchaseOrdersService,
  formatPurchaseOrderNumber,
} from './purchase-orders.service';

/**
 * Purchase order numbering contract.
 *
 * The number must come from the database, be allocated atomically, and never
 * be reissued -- including after a purchase order is deleted. These tests pin
 * the *mechanism* (a PostgreSQL sequence), not just the happy-path value,
 * because every wrong implementation of this (COUNT(*)+1, MAX()+1, array
 * length, a timestamp) looks correct until two admins save at the same moment
 * or a record is deleted.
 */

type QueryLog = { sql: string; params?: unknown[] };

function serviceWith(dbType: string, responder: (sql: string) => unknown) {
  const log: QueryLog[] = [];
  const service = Object.create(
    PurchaseOrdersService.prototype,
  ) as PurchaseOrdersService & { dataSource: unknown };
  Object.defineProperty(service, 'dataSource', {
    value: { options: { type: dbType } },
    writable: true,
  });
  const queryRunner = {
    query: (sql: string, params?: unknown[]) => {
      log.push({ sql, params });
      return Promise.resolve(responder(sql));
    },
  };
  return { service, queryRunner, log };
}

function allocate(service: unknown, queryRunner: unknown): Promise<string> {
  return (
    service as { allocateSequenceNumber(qr: unknown): Promise<string> }
  ).allocateSequenceNumber(queryRunner);
}

describe('purchase order numbering', () => {
  it('starts the series at 1, rendered PO-0001', () => {
    expect(PURCHASE_ORDER_NUMBER_START).toBe(1);
    expect(formatPurchaseOrderNumber(PURCHASE_ORDER_NUMBER_START)).toBe(
      'PO-0001',
    );
  });

  describe('on PostgreSQL', () => {
    it('allocates via nextval() on purchase_order_number_seq', async () => {
      const { service, queryRunner, log } = serviceWith('postgres', () => [
        { value: '1' },
      ]);

      await expect(allocate(service, queryRunner)).resolves.toBe('1');
      expect(log).toHaveLength(1);
      expect(log[0].sql).toContain("nextval('purchase_order_number_seq')");
    });

    it('returns each sequence value verbatim, so numbers strictly increase', async () => {
      const values = ['1', '2', '3'];
      let i = 0;
      const { service, queryRunner } = serviceWith('postgres', () => [
        { value: values[i++] },
      ]);

      expect(await allocate(service, queryRunner)).toBe('1');
      expect(await allocate(service, queryRunner)).toBe('2');
      expect(await allocate(service, queryRunner)).toBe('3');
    });

    it('never derives a number from COUNT(*), MAX() or a row lock', async () => {
      const { service, queryRunner, log } = serviceWith('postgres', () => [
        { value: '7' },
      ]);

      await allocate(service, queryRunner);

      const sql = log
        .map((q) => q.sql)
        .join(' ')
        .toUpperCase();
      expect(sql).not.toContain('COUNT(');
      expect(sql).not.toContain('MAX(');
      expect(sql).not.toContain('FOR UPDATE');
    });

    it('fails loudly rather than inventing a number when the sequence returns nothing', async () => {
      const { service, queryRunner } = serviceWith('postgres', () => []);

      await expect(allocate(service, queryRunner)).rejects.toThrow(
        /purchase_order_number_seq/,
      );
    });

    it('keeps a bigint that exceeds Number.MAX_SAFE_INTEGER exact', async () => {
      const huge = '9007199254740993';
      const { service, queryRunner } = serviceWith('postgres', () => [
        { value: huge },
      ]);

      await expect(allocate(service, queryRunner)).resolves.toBe(huge);
    });
  });

  describe('on the sqlite counter fallback', () => {
    const originalEnv = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('claims the value below the incremented counter row', async () => {
      const { service, queryRunner, log } = serviceWith(
        'better-sqlite3',
        (sql) => (sql.includes('SELECT next_value') ? [{ next_value: 2 }] : []),
      );

      // The row holds the *next* value to issue, so having just incremented it
      // to 2 the number claimed is 1.
      await expect(allocate(service, queryRunner)).resolves.toBe('1');
      expect(log.some((q) => q.sql.includes('UPDATE'))).toBe(true);
    });

    it('refuses to run in production, where PostgreSQL is required', async () => {
      process.env.NODE_ENV = 'production';
      const { service, queryRunner } = serviceWith('better-sqlite3', () => [
        { next_value: 2 },
      ]);

      await expect(allocate(service, queryRunner)).rejects.toThrow(
        /requires PostgreSQL/,
      );
    });
  });

  /**
   * The migration is the actual guarantee, so assert its shape too: a code
   * change alone cannot make numbering safe if the sequence is not there.
   */
  describe('migration 018', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '../../../../database/migrations/018_purchase_orders.sql',
      ),
      'utf8',
    );

    it('creates the sequence starting at 1', () => {
      expect(sql).toMatch(
        /CREATE SEQUENCE IF NOT EXISTS purchase_order_number_seq/,
      );
      expect(sql).toMatch(/START WITH 1/);
    });

    it('constrains both the rendered number and the raw sequence to be unique', () => {
      expect(sql).toMatch(/po_number VARCHAR\(32\) UNIQUE NOT NULL/);
      expect(sql).toMatch(/sequence_number BIGINT UNIQUE NOT NULL/);
    });

    it('resumes above the highest number ever allocated rather than re-seeding', () => {
      expect(sql).toContain("setval('purchase_order_number_seq'");
      expect(sql).toContain('MAX(sequence_number)');
      expect(sql).toContain(
        "pg_sequence_last_value('purchase_order_number_seq')",
      );
      // Guarded, because setval(seq, 0, true) is illegal at MINVALUE 1 and a
      // fresh install must be left alone so its first nextval() returns 1.
      expect(sql).toMatch(/WHERE resume_from >= 1/);
    });

    it('stores monetary and quantity columns as NUMERIC, never floats', () => {
      expect(sql).toMatch(/total NUMERIC\(14, 2\)/);
      expect(sql).toMatch(/quantity NUMERIC\(14, 3\)/);
      expect(sql).toMatch(/unit_price NUMERIC\(12, 4\)/);
      expect(sql).toMatch(/amount NUMERIC\(14, 2\)/);
      expect(sql).not.toMatch(/\b(FLOAT|REAL|DOUBLE PRECISION)\b/i);
    });

    it('cascades line items so deleting a PO cannot orphan rows', () => {
      expect(sql).toMatch(
        /purchase_order_id UUID NOT NULL REFERENCES purchase_orders\(id\) ON DELETE CASCADE/,
      );
    });
  });
});
