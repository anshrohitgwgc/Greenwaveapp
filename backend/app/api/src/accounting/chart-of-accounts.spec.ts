import * as fs from 'fs';
import * as path from 'path';

import { DEFAULT_CHART, DEFAULT_NORMAL_BALANCE, SYSTEM_ACCOUNT_KEYS } from './chart-of-accounts';

const MIGRATIONS = ['020_accounting_ledger.sql', '021_banking_reconciliation_payables.sql'].map((f) =>
  path.resolve(__dirname, '../../../../database/migrations', f),
);

describe('default chart of accounts', () => {
  const sql = MIGRATIONS.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

  it('matches the seed rows in migrations 020/021 exactly', () => {
    for (const a of DEFAULT_CHART) {
      const key = a.systemKey ? `'${a.systemKey}'` : 'NULL';
      const pattern = new RegExp(
        `\\('${a.code}',\\s*'${a.name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}',\\s*'${a.type}',\\s*'${a.subtype}',\\s*'${a.normalBalance}',\\s*${key}\\)`,
      );
      expect({ code: a.code, found: pattern.test(sql) }).toEqual({ code: a.code, found: true });
    }
    const seeded = sql.match(/\('\d{4}',/g) ?? [];
    expect(seeded.length).toBe(DEFAULT_CHART.length);
  });

  it('has every system key exactly once and unique codes', () => {
    const keys = DEFAULT_CHART.map((a) => a.systemKey).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual([...SYSTEM_ACCOUNT_KEYS].sort());
    const codes = DEFAULT_CHART.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('uses the type default normal balance except for contra accounts', () => {
    for (const a of DEFAULT_CHART) {
      const contra = a.subtype.startsWith('CONTRA');
      expect({ code: a.code, ok: contra ? a.normalBalance !== DEFAULT_NORMAL_BALANCE[a.type] : a.normalBalance === DEFAULT_NORMAL_BALANCE[a.type] }).toEqual({ code: a.code, ok: true });
    }
  });
});
