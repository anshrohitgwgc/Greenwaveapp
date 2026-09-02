/**
 * Division / business-unit vocabulary.
 *
 * There are two names for the recycling business unit in this codebase and
 * that is deliberate:
 *
 *   * `greenwave` is the **canonical** key. It is what the API accepts and
 *     returns, what `user_divisions` stores, and what the frontend sends.
 *   * `recycling` is the **legacy storage** value. Migrations 013/015 shipped
 *     `division VARCHAR(32) ... DEFAULT 'recycling'` onto materials,
 *     inventory_transactions and containers, and production rows already
 *     carry it.
 *
 * Renaming the stored value would mean an UPDATE across live business data,
 * which this task explicitly forbids. So instead the boundary translates:
 * input is normalised to the canonical key, reads match every storage synonym
 * for that key, and writes persist the canonical *storage* value so new rows
 * stay byte-compatible with the existing column default.
 */

export const DIVISION_GREENWAVE = 'greenwave';
export const DIVISION_HEALTHCARE = 'healthcare';

export type Division = typeof DIVISION_GREENWAVE | typeof DIVISION_HEALTHCARE;

export const ALL_DIVISIONS: readonly Division[] = [
  DIVISION_GREENWAVE,
  DIVISION_HEALTHCARE,
] as const;

export const DIVISION_LABELS: Record<Division, string> = {
  [DIVISION_GREENWAVE]: 'GreenWave Recycling',
  [DIVISION_HEALTHCARE]: 'Healthcare',
};

/**
 * Every value that can appear in a `division` column for a given canonical
 * division. Used to build `IN (...)` predicates so a query for `greenwave`
 * still matches the historical `recycling` rows.
 */
export const DIVISION_STORAGE_SYNONYMS: Record<Division, readonly string[]> = {
  [DIVISION_GREENWAVE]: ['recycling', 'greenwave'],
  [DIVISION_HEALTHCARE]: ['healthcare'],
};

/**
 * The single value written to a `division` column for new rows. Kept as
 * `recycling` for GreenWave so new inventory/material rows match both the
 * existing data and the column DEFAULT.
 */
export const DIVISION_STORAGE_WRITE_VALUE: Record<Division, string> = {
  [DIVISION_GREENWAVE]: 'recycling',
  [DIVISION_HEALTHCARE]: 'healthcare',
};

const NORMALISATION_TABLE: Record<string, Division> = {
  greenwave: DIVISION_GREENWAVE,
  recycling: DIVISION_GREENWAVE,
  'greenwave recycling': DIVISION_GREENWAVE,
  'greenwave-recycling': DIVISION_GREENWAVE,
  gw: DIVISION_GREENWAVE,
  healthcare: DIVISION_HEALTHCARE,
  'health-care': DIVISION_HEALTHCARE,
  hc: DIVISION_HEALTHCARE,
};

/**
 * Canonicalises anything a client may send. Returns `null` for values that are
 * not a real division — callers turn that into a 400, never into a silent
 * "default to recycling", so a typo can never widen access.
 */
export function normalizeDivision(value: unknown): Division | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  if (!key) return null;
  return NORMALISATION_TABLE[key] ?? null;
}

export function isDivision(value: unknown): value is Division {
  return normalizeDivision(value) !== null;
}

/** Canonical -> the storage values a SQL `IN (...)` should match. */
export function divisionStorageValues(
  divisions: readonly Division[],
): string[] {
  const out = new Set<string>();
  for (const d of divisions) {
    for (const synonym of DIVISION_STORAGE_SYNONYMS[d]) out.add(synonym);
  }
  return [...out];
}

/** Storage value (or anything legacy) -> canonical key, for reads. */
export function divisionFromStorage(value: unknown): Division | null {
  return normalizeDivision(value);
}

export function divisionLabel(value: unknown): string {
  const d = normalizeDivision(value);
  return d ? DIVISION_LABELS[d] : 'Unassigned';
}
