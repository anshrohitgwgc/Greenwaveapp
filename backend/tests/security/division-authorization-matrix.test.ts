import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  ALL_DIVISIONS,
  DIVISION_STORAGE_WRITE_VALUE,
  divisionStorageValues,
  normalizeDivision,
  type Division,
} from '../../app/api/src/divisions/divisions.constants';

/**
 * Division / business-unit authorization matrix.
 *
 * Unlike the warehouse matrix alongside it, this suite imports the **real**
 * normalisation and storage-mapping helpers the API runs, so a regression in
 * that vocabulary fails here rather than only in the Nest e2e layer. The
 * allow/deny rule itself is restated as the one-line predicate the services
 * implement: access requires an explicit grant, full stop.
 */

interface UserContext {
  id: number;
  email: string;
  role: 'admin' | 'manager' | 'staff' | 'driver';
  /** Explicit `user_divisions` grants. No role confers access implicitly. */
  divisions: Division[];
}

function evaluateDivisionAccess(
  user: UserContext,
  requested: string,
): { authorized: boolean; statusCode: number } {
  const canonical = normalizeDivision(requested);
  if (!canonical) {
    // Unknown division is a client error, never a silent default.
    return { authorized: false, statusCode: 400 };
  }
  if (!user.divisions.includes(canonical)) {
    return { authorized: false, statusCode: 403 };
  }
  return { authorized: true, statusCode: 200 };
}

/** The storage values a row must carry to be visible to this user. */
function visibleStorageValues(user: UserContext): string[] {
  return divisionStorageValues(user.divisions);
}

function rowVisible(user: UserContext, rowDivision: string | null): boolean {
  // A row with a missing/unknown division belongs to the column default
  // (GreenWave) — it is never treated as visible to everyone.
  const stored = rowDivision ?? 'recycling';
  const canonical = normalizeDivision(stored) ?? 'greenwave';
  return user.divisions.includes(canonical as Division);
}

describe('Security: Division / Business-Unit Authorization Matrix', () => {
  const greenwaveOnly: UserContext = {
    id: 201,
    email: 'gw.only@greenwave.test',
    role: 'admin',
    divisions: ['greenwave'],
  };

  const healthcareOnly: UserContext = {
    id: 202,
    email: 'hc.only@greenwave.test',
    role: 'admin',
    divisions: ['healthcare'],
  };

  const bothDivisions: UserContext = {
    id: 203,
    email: 'both@greenwave.test',
    role: 'admin',
    divisions: ['greenwave', 'healthcare'],
  };

  const freshHire: UserContext = {
    id: 204,
    email: 'fresh.hire@greenwave.test',
    role: 'staff',
    divisions: [],
  };

  describe('1-4. Core allow/deny matrix', () => {
    it('GreenWave-only user -> GreenWave = allowed (200)', () => {
      assert.equal(evaluateDivisionAccess(greenwaveOnly, 'greenwave').statusCode, 200);
      // legacy storage alias resolves to the same grant
      assert.equal(evaluateDivisionAccess(greenwaveOnly, 'recycling').statusCode, 200);
    });

    it('GreenWave-only user -> Healthcare = denied (403)', () => {
      assert.equal(evaluateDivisionAccess(greenwaveOnly, 'healthcare').statusCode, 403);
    });

    it('Healthcare-only user -> Healthcare = allowed (200)', () => {
      assert.equal(evaluateDivisionAccess(healthcareOnly, 'healthcare').statusCode, 200);
    });

    it('Healthcare-only user -> GreenWave = denied (403), including the legacy alias', () => {
      assert.equal(evaluateDivisionAccess(healthcareOnly, 'greenwave').statusCode, 403);
      assert.equal(evaluateDivisionAccess(healthcareOnly, 'recycling').statusCode, 403);
    });

    it('both-divisions user reaches both (200/200)', () => {
      assert.equal(evaluateDivisionAccess(bothDivisions, 'greenwave').statusCode, 200);
      assert.equal(evaluateDivisionAccess(bothDivisions, 'healthcare').statusCode, 200);
    });
  });

  describe('5-6. Direct object access by id is governed by the row, not the request', () => {
    const healthcareRow = 'healthcare';
    const greenwaveRow = 'recycling';

    it('a known Healthcare object id is still invisible to a GreenWave-only user', () => {
      assert.equal(rowVisible(greenwaveOnly, healthcareRow), false);
    });

    it('a known GreenWave object id is still invisible to a Healthcare-only user', () => {
      assert.equal(rowVisible(healthcareOnly, greenwaveRow), false);
    });

    it('each user can still reach their own division\'s objects', () => {
      assert.equal(rowVisible(greenwaveOnly, greenwaveRow), true);
      assert.equal(rowVisible(healthcareOnly, healthcareRow), true);
    });

    it('a row with a NULL or unrecognised division fails closed to GreenWave', () => {
      assert.equal(rowVisible(healthcareOnly, null), false);
      assert.equal(rowVisible(healthcareOnly, 'legacy-value'), false);
      assert.equal(rowVisible(greenwaveOnly, null), true);
    });
  });

  describe('9. A new account has no division access', () => {
    it('a fresh hire is denied every division', () => {
      for (const division of ALL_DIVISIONS) {
        assert.equal(evaluateDivisionAccess(freshHire, division).statusCode, 403);
      }
    });

    it('a fresh hire scopes to an empty storage-value set, so queries return nothing', () => {
      assert.deepEqual(visibleStorageValues(freshHire), []);
    });

    it('a fresh hire cannot see any row, of either division', () => {
      assert.equal(rowVisible(freshHire, 'recycling'), false);
      assert.equal(rowVisible(freshHire, 'healthcare'), false);
      assert.equal(rowVisible(freshHire, null), false);
    });
  });

  describe('Client-supplied division values cannot widen access', () => {
    it('rejects invented divisions with 400 rather than defaulting', () => {
      for (const bogus of ['finance', 'admin', 'ALL', '*', 'greenwave healthcare', '']) {
        assert.equal(evaluateDivisionAccess(bothDivisions, bogus).statusCode, 400);
      }
    });

    it('normalisation never invents a division for junk input', () => {
      assert.equal(normalizeDivision('recyceling'), null);
      assert.equal(normalizeDivision(undefined), null);
      assert.equal(normalizeDivision({} as unknown), null);
    });
  });

  describe('10. Warehouse + division isolation is a two-axis check', () => {
    const WAREHOUSES = ['calgary', 'ontario', 'maple-ridge'] as const;

    interface Row {
      warehouse: string;
      division: string;
    }

    // The six combinations the business actually runs.
    const rows: Row[] = WAREHOUSES.flatMap((warehouse) => [
      { warehouse, division: 'recycling' },
      { warehouse, division: 'healthcare' },
    ]);

    function visible(
      user: UserContext,
      authorizedWarehouses: string[],
      row: Row,
    ): boolean {
      return (
        authorizedWarehouses.includes(row.warehouse) && rowVisible(user, row.division)
      );
    }

    it('Calgary + GreenWave staff see exactly one of the six cells', () => {
      const seen = rows.filter((r) => visible(greenwaveOnly, ['calgary'], r));
      assert.deepEqual(seen, [{ warehouse: 'calgary', division: 'recycling' }]);
    });

    it('Calgary + Healthcare staff see exactly the other Calgary cell', () => {
      const seen = rows.filter((r) => visible(healthcareOnly, ['calgary'], r));
      assert.deepEqual(seen, [{ warehouse: 'calgary', division: 'healthcare' }]);
    });

    it('a two-warehouse Healthcare manager sees exactly two cells', () => {
      const seen = rows.filter((r) =>
        visible(healthcareOnly, ['ontario', 'maple-ridge'], r),
      );
      assert.deepEqual(seen, [
        { warehouse: 'ontario', division: 'healthcare' },
        { warehouse: 'maple-ridge', division: 'healthcare' },
      ]);
    });

    it('a both-divisions, all-warehouse admin sees all six cells', () => {
      const seen = rows.filter((r) => visible(bothDivisions, [...WAREHOUSES], r));
      assert.equal(seen.length, 6);
    });

    it('warehouse access alone never grants the other division', () => {
      // Authorized for every warehouse, but only GreenWave: still three cells.
      const seen = rows.filter((r) => visible(greenwaveOnly, [...WAREHOUSES], r));
      assert.equal(seen.length, 3);
      assert.ok(seen.every((r) => r.division === 'recycling'));
    });
  });

  describe('Storage vocabulary stays compatible with existing production rows', () => {
    it('GreenWave matches both the canonical key and the legacy `recycling` value', () => {
      assert.deepEqual(divisionStorageValues(['greenwave']).sort(), [
        'greenwave',
        'recycling',
      ]);
    });

    it('Healthcare never matches a recycling row', () => {
      assert.ok(!divisionStorageValues(['healthcare']).includes('recycling'));
    });

    it('new GreenWave rows are written as `recycling`, matching the column default', () => {
      assert.equal(DIVISION_STORAGE_WRITE_VALUE.greenwave, 'recycling');
      assert.equal(DIVISION_STORAGE_WRITE_VALUE.healthcare, 'healthcare');
    });
  });
});
