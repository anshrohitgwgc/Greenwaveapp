import type { ValueTransformer } from 'typeorm';

/**
 * Column type for timezone-aware timestamps. Production is Postgres
 * (`timestamptz`, per the SQL migrations); the sqlite-backed integration tests
 * need `datetime`. Same convention the existing entities use inline.
 */
export const TIMESTAMP_COLUMN_TYPE =
  process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz';

/**
 * Postgres returns BIGINT as a string. Minor-unit money columns are read back
 * as numbers, refusing anything outside the exactly-representable range rather
 * than silently losing cents.
 */
export const bigintNumberTransformer: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return value;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(n)) {
      throw new RangeError(`BIGINT value out of safe range: ${String(value)}`);
    }
    return n;
  },
};

/** True when a driver error is a unique-constraint violation (Postgres or sqlite). */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; driverError?: { code?: string }; message?: string };
  const code = e?.code ?? e?.driverError?.code;
  if (code === '23505' || code === 'SQLITE_CONSTRAINT_UNIQUE') return true;
  return typeof e?.message === 'string' && /UNIQUE constraint failed|duplicate key value/i.test(e.message);
}

/** Row lock for SELECT ... FOR UPDATE on Postgres; sqlite (tests) serializes writes itself. */
export function rowLock(manager: { connection: { options: { type: string } } }): { mode: 'pessimistic_write' } | undefined {
  return manager.connection.options.type === 'postgres' ? { mode: 'pessimistic_write' } : undefined;
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
