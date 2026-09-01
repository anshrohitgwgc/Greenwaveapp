import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { INVOICE_NUMBER_START, InvoicesService } from './invoices.service';

/**
 * Invoice numbering contract.
 *
 * The number must come from the database, be allocated atomically, and never
 * be reissued -- including after an invoice is deleted. These tests pin the
 * mechanism (a PostgreSQL sequence) rather than just the happy-path value,
 * because the previous implementation's fallback (`1115 + COUNT(*)`) looked
 * correct while silently reusing numbers after a delete.
 */

type QueryLog = { sql: string; params?: unknown[] };

function serviceWith(dbType: string, responder: (sql: string) => unknown) {
  const log: QueryLog[] = [];
  const service = Object.create(
    InvoicesService.prototype,
  ) as InvoicesService & {
    dataSource: unknown;
  };
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
    service as { allocateInvoiceNumber(qr: unknown): Promise<string> }
  ).allocateInvoiceNumber(queryRunner);
}

describe('invoice numbering', () => {
  it('starts the series at 10000', () => {
    expect(INVOICE_NUMBER_START).toBe(10000);
  });

  describe('on PostgreSQL', () => {
    it('allocates via nextval() on the invoice_number_seq sequence', async () => {
      const { service, queryRunner, log } = serviceWith('postgres', () => [
        { value: '10000' },
      ]);

      const number = await allocate(service, queryRunner);

      expect(number).toBe('10000');
      expect(log).toHaveLength(1);
      expect(log[0].sql).toContain("nextval('invoice_number_seq')");
    });

    it('returns each sequence value verbatim, so numbers strictly increase', async () => {
      const values = ['10000', '10001', '10002'];
      let i = 0;
      const { service, queryRunner } = serviceWith('postgres', () => [
        { value: values[i++] },
      ]);

      expect(await allocate(service, queryRunner)).toBe('10000');
      expect(await allocate(service, queryRunner)).toBe('10001');
      expect(await allocate(service, queryRunner)).toBe('10002');
    });

    it('never derives a number from COUNT(*) or MAX(), which would reuse deleted numbers', async () => {
      const { service, queryRunner, log } = serviceWith('postgres', () => [
        { value: '10007' },
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
        /invoice_number_seq/,
      );
    });
  });

  describe('on non-PostgreSQL drivers (integration specs)', () => {
    it('claims the counter row value and advances it', async () => {
      const { service, queryRunner, log } = serviceWith(
        'better-sqlite3',
        (sql) =>
          sql.includes('SELECT next_value') ? [{ next_value: 10001 }] : [],
      );

      // The row holds the *next* value to issue; after the increment it reads
      // 10001, so the number just claimed is 10000.
      expect(await allocate(service, queryRunner)).toBe('10000');

      const statements = log.map((q) => q.sql).join(' ');
      expect(statements).toContain('UPDATE invoice_number_counter');
      expect(statements).toContain(String(INVOICE_NUMBER_START));
    });
  });
});

describe('invoice numbering migration', () => {
  const sql = readFileSync(
    join(
      __dirname,
      '../../../../database/migrations/016_invoice_number_sequence.sql',
    ),
    'utf8',
  );

  it('creates the sequence starting at 10000', () => {
    expect(sql).toContain('CREATE SEQUENCE IF NOT EXISTS invoice_number_seq');
    expect(sql).toContain('START WITH 10000');
  });

  it('seeds above any number already issued, so existing invoices are never renumbered or reused', () => {
    expect(sql).toContain('setval');
    expect(sql).toContain('MAX(invoice_number::BIGINT)');
    expect(sql).toContain("pg_sequence_last_value('invoice_number_seq')");
    expect(sql).toContain('GREATEST');
  });

  it('does not drop the legacy counter table, keeping rollback possible', () => {
    expect(sql).not.toMatch(/DROP\s+TABLE\s+invoice_number_counter/i);
  });
});
