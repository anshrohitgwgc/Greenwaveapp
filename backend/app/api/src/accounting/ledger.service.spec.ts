import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { ACCOUNTING_ENTITIES, AccountingModule } from './accounting.module';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalLine } from './entities/journal-line.entity';
import { assertBalancedLines, LedgerService, UnbalancedEntryError } from './ledger.service';

describe('assertBalancedLines (pure)', () => {
  it('accepts a balanced entry and returns its total', () => {
    expect(
      assertBalancedLines([
        { accountKey: 'AR', debitMinor: 105000 },
        { accountKey: 'REVENUE_SALES', creditMinor: 100000 },
        { accountKey: 'SALES_TAX_PAYABLE', creditMinor: 5000 },
      ]),
    ).toEqual({ totalMinor: 105000 });
  });

  it.each([
    ['unbalanced', [{ accountKey: 'AR', debitMinor: 100 }, { accountKey: 'REVENUE_SALES', creditMinor: 99 }]],
    ['single line', [{ accountKey: 'AR', debitMinor: 100 }]],
    ['both sides on a line', [{ accountKey: 'AR', debitMinor: 100, creditMinor: 100 }, { accountKey: 'REVENUE_SALES', creditMinor: 0, debitMinor: 0 }]],
    ['negative', [{ accountKey: 'AR', debitMinor: -100 }, { accountKey: 'REVENUE_SALES', creditMinor: -100 }]],
    ['fractional minor units', [{ accountKey: 'AR', debitMinor: 10.5 }, { accountKey: 'REVENUE_SALES', creditMinor: 10.5 }]],
    ['no account', [{ debitMinor: 100 }, { accountKey: 'REVENUE_SALES', creditMinor: 100 }]],
    ['two accounts', [{ accountKey: 'AR', accountId: 'x', debitMinor: 100 }, { accountKey: 'REVENUE_SALES', creditMinor: 100 }]],
  ])('rejects %s', (_label, lines) => {
    expect(() => assertBalancedLines(lines as never)).toThrow(UnbalancedEntryError);
  });
});

describe('LedgerService (sqlite)', () => {
  let ledger: LedgerService;
  let ds: DataSource;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        TypeOrmModule.forRoot({ type: 'better-sqlite3', database: ':memory:', dropSchema: true, synchronize: true, entities: ACCOUNTING_ENTITIES }),
        AccountingModule,
      ],
    }).compile();
    ledger = moduleRef.get(LedgerService);
    ds = moduleRef.get(DataSource);
    await ledger.ensureDefaultChart();
    await ledger.ensureDefaultChart(); // idempotent
  });

  const sale = (sourceId: string) => ({
    entryDate: '2026-09-01',
    description: 'Invoice issued',
    currency: 'CAD',
    sourceType: 'invoice',
    sourceId,
    sourceEvent: 'invoice.issued',
    lines: [
      { accountKey: 'AR' as const, debitMinor: 1050 },
      { accountKey: 'REVENUE_SALES' as const, creditMinor: 1000 },
      { accountKey: 'SALES_TAX_PAYABLE' as const, creditMinor: 50 },
    ],
  });

  it('posts exactly once per source event', async () => {
    const first = await ledger.post(sale('inv-1'));
    const second = await ledger.post(sale('inv-1'));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.entry.id).toBe(first.entry.id);
    expect(await ds.getRepository(JournalEntry).count({ where: { sourceId: 'inv-1' } })).toBe(1);
  });

  it('refuses unknown accounts and bad dates without writing', async () => {
    await expect(
      ledger.post({ ...sale('inv-2'), lines: [{ accountId: '00000000-0000-4000-8000-000000000000', debitMinor: 5 }, { accountKey: 'AR', creditMinor: 5 }] }),
    ).rejects.toThrow(/does not exist/);
    await expect(ledger.post({ ...sale('inv-3'), entryDate: '2026-02-30' })).rejects.toThrow(/YYYY-MM-DD/);
    expect(await ds.getRepository(JournalEntry).count({ where: { sourceId: 'inv-2' } })).toBe(0);
  });

  it('reverses with a mirror entry, exactly once, and never reverses a reversal', async () => {
    const { entry } = await ledger.post(sale('inv-4'));
    const r1 = await ledger.reverse(entry.id, { entryDate: '2026-09-02', reason: 'voided' });
    const r2 = await ledger.reverse(entry.id, { entryDate: '2026-09-02', reason: 'voided again' });
    expect(r1.created).toBe(true);
    expect(r2.created).toBe(false);
    expect(r2.entry.id).toBe(r1.entry.id);
    expect(r1.entry.reversalOf).toBe(entry.id);
    const original = await ds.getRepository(JournalEntry).findOneByOrFail({ id: entry.id });
    expect(original.status).toBe('REVERSED');

    const lines = await ds.getRepository(JournalLine).find({ where: { entryId: r1.entry.id }, order: { lineNo: 'ASC' } });
    expect(lines.map((l) => [l.debitMinor, l.creditMinor])).toEqual([[0, 1050], [1000, 0], [50, 0]]);
    await expect(ledger.reverse(r1.entry.id, { entryDate: '2026-09-03', reason: 'x' })).rejects.toThrow(/cannot itself be reversed/);
  });

  it('keeps the whole ledger balanced', async () => {
    const totals = await ds
      .getRepository(JournalLine)
      .createQueryBuilder('l')
      .select('SUM(l.debitMinor)', 'd')
      .addSelect('SUM(l.creditMinor)', 'c')
      .getRawOne<{ d: number; c: number }>();
    expect(Number(totals!.d)).toBe(Number(totals!.c));
  });
});
