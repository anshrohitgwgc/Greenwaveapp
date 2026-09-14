import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, In } from 'typeorm';

import { isIsoDate } from '../common/dates';
import { isUniqueViolation } from '../common/db-types';
import { normalizeCurrency } from '../common/money';
import { DEFAULT_CHART, SystemAccountKey } from './chart-of-accounts';
import { JournalEntry, JournalEntryStatus } from './entities/journal-entry.entity';
import { JournalLine } from './entities/journal-line.entity';
import { LedgerAccount } from './entities/ledger-account.entity';

export interface PostLineInput {
  /** Exactly one of accountKey / accountId. */
  accountKey?: SystemAccountKey;
  accountId?: string;
  debitMinor?: number;
  creditMinor?: number;
  description?: string | null;
  customerId?: string | null;
  vendorId?: string | null;
}

export interface PostEntryInput {
  entryDate: string;
  description: string;
  reference?: string | null;
  currency: string;
  sourceType: string;
  /** With sourceEvent, makes the posting exactly-once. Null for free manual entries. */
  sourceId?: string | null;
  sourceEvent?: string | null;
  /** Set only by LedgerService.reverse. */
  reversalOf?: string | null;
  lines: PostLineInput[];
  status?: Extract<JournalEntryStatus, 'DRAFT' | 'POSTED'>;
  createdBy?: number | null;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface PostResult {
  entry: JournalEntry;
  /** false when an entry for this source already existed (idempotent replay). */
  created: boolean;
}

export class UnbalancedEntryError extends BadRequestException {}

/**
 * Pure validation of a set of lines. Exported so it can be tested without a
 * database and reused by manual-entry DTO validation.
 */
export function assertBalancedLines(lines: PostLineInput[]): { totalMinor: number } {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new UnbalancedEntryError('A journal entry needs at least two lines');
  }
  let debits = 0;
  let credits = 0;
  lines.forEach((line, i) => {
    const d = line.debitMinor ?? 0;
    const c = line.creditMinor ?? 0;
    if (!Number.isSafeInteger(d) || !Number.isSafeInteger(c) || d < 0 || c < 0) {
      throw new UnbalancedEntryError(`Line ${i + 1}: amounts must be non-negative integer minor units`);
    }
    if ((d > 0) === (c > 0)) {
      throw new UnbalancedEntryError(`Line ${i + 1}: must be either a debit or a credit`);
    }
    if (!!line.accountKey === !!line.accountId) {
      throw new UnbalancedEntryError(`Line ${i + 1}: specify exactly one account`);
    }
    debits += d;
    credits += c;
    if (!Number.isSafeInteger(debits) || !Number.isSafeInteger(credits)) {
      throw new UnbalancedEntryError('Entry total out of range');
    }
  });
  if (debits !== credits) {
    throw new UnbalancedEntryError(`Debits (${debits}) must equal credits (${credits})`);
  }
  return { totalMinor: debits };
}

/**
 * The general ledger. The only code path that writes journal entries.
 *
 * Invariants (also enforced by migration 020 triggers in Postgres):
 * balanced, one side per line, immutable once POSTED, exactly-once per source.
 */
@Injectable()
export class LedgerService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private run<T>(manager: EntityManager | undefined, fn: (m: EntityManager) => Promise<T>): Promise<T> {
    return manager ? fn(manager) : this.dataSource.transaction(fn);
  }

  /** Inserts any missing default accounts (by code). Idempotent. Migration 020 does this in Postgres. */
  async ensureDefaultChart(manager?: EntityManager): Promise<void> {
    await this.run(manager, async (m) => {
      const repo = m.getRepository(LedgerAccount);
      const existing = await repo.find({ select: ['code'] });
      const have = new Set(existing.map((a) => a.code));
      const missing = DEFAULT_CHART.filter((s) => !have.has(s.code));
      if (missing.length === 0) return;
      await repo.save(
        missing.map((s) =>
          repo.create({
            id: randomUUID(),
            code: s.code,
            name: s.name,
            type: s.type,
            subtype: s.subtype,
            normalBalance: s.normalBalance,
            systemKey: s.systemKey,
            isActive: true,
          }),
        ),
      );
    });
  }

  async findBySource(
    sourceType: string,
    sourceId: string,
    sourceEvent: string,
    manager?: EntityManager,
  ): Promise<JournalEntry | null> {
    const repo = (manager ?? this.dataSource.manager).getRepository(JournalEntry);
    return repo.findOne({ where: { sourceType, sourceId, sourceEvent } });
  }

  async post(input: PostEntryInput, manager?: EntityManager): Promise<PostResult> {
    if (!isIsoDate(input.entryDate)) throw new BadRequestException('entryDate must be YYYY-MM-DD');
    const description = String(input.description ?? '').trim();
    if (!description) throw new BadRequestException('description is required');
    const currency = normalizeCurrency(input.currency);
    assertBalancedLines(input.lines);
    const exactlyOnce = !!input.sourceId && !!input.sourceEvent;

    try {
      return await this.run(manager, async (m) => {
        if (exactlyOnce) {
          const existing = await this.findBySource(input.sourceType, input.sourceId!, input.sourceEvent!, m);
          if (existing) return { entry: existing, created: false };
        }

        const accountIds = await this.resolveAccounts(input.lines, m);
        const status = input.status ?? 'POSTED';
        const entryRepo = m.getRepository(JournalEntry);
        const entry = await entryRepo.save(
          entryRepo.create({
            id: randomUUID(),
            entryDate: input.entryDate,
            description: description.slice(0, 255),
            reference: input.reference?.slice(0, 100) ?? null,
            status,
            currency,
            sourceType: input.sourceType,
            sourceId: input.sourceId ?? null,
            sourceEvent: input.sourceEvent ?? null,
            reversalOf: input.reversalOf ?? null,
            reversedBy: null,
            createdBy: input.createdBy ?? null,
            postedAt: status === 'POSTED' ? new Date() : null,
            requestId: input.requestId ?? null,
            metadata: input.metadata ?? null,
          }),
        );

        const lineRepo = m.getRepository(JournalLine);
        entry.lines = await lineRepo.save(
          input.lines.map((line, i) =>
            lineRepo.create({
              id: randomUUID(),
              entryId: entry.id,
              lineNo: i + 1,
              accountId: accountIds[i],
              debitMinor: line.debitMinor ?? 0,
              creditMinor: line.creditMinor ?? 0,
              description: line.description?.slice(0, 255) ?? null,
              customerId: line.customerId ?? null,
              vendorId: line.vendorId ?? null,
            }),
          ),
        );
        return { entry, created: true };
      });
    } catch (err) {
      // Concurrent duplicate posting lost the race. Only recoverable when we own
      // the transaction; inside a caller's transaction Postgres has aborted it,
      // so the error propagates and the caller retries (webhooks are retried).
      if (exactlyOnce && !manager && isUniqueViolation(err)) {
        const existing = await this.findBySource(input.sourceType, input.sourceId!, input.sourceEvent!);
        if (existing) return { entry: existing, created: false };
      }
      throw err;
    }
  }

  /** Posts a DRAFT entry. Re-validates balance against stored lines. */
  async postDraft(entryId: string, manager?: EntityManager): Promise<JournalEntry> {
    return this.run(manager, async (m) => {
      const repo = m.getRepository(JournalEntry);
      const entry = await repo.findOne({ where: { id: entryId }, lock: this.lockMode(m) });
      if (!entry) throw new NotFoundException('Journal entry not found');
      if (entry.status !== 'DRAFT') throw new ConflictException(`Entry is ${entry.status}`);
      const lines = await m.getRepository(JournalLine).find({ where: { entryId } });
      assertBalancedLines(lines.map((l) => ({ accountId: l.accountId, debitMinor: l.debitMinor, creditMinor: l.creditMinor })));
      entry.status = 'POSTED';
      entry.postedAt = new Date();
      return repo.save(entry);
    });
  }

  /**
   * Posts the mirror image of a POSTED entry and marks the original REVERSED.
   * Exactly-once: reversing an already-reversed entry returns the existing reversal.
   */
  async reverse(
    entryId: string,
    opts: { entryDate: string; reason: string; createdBy?: number | null; sourceEvent?: string; requestId?: string | null },
    manager?: EntityManager,
  ): Promise<PostResult> {
    return this.run(manager, async (m) => {
      const repo = m.getRepository(JournalEntry);
      const original = await repo.findOne({ where: { id: entryId }, lock: this.lockMode(m) });
      if (!original) throw new NotFoundException('Journal entry not found');
      if (original.reversedBy) {
        const existing = await repo.findOne({ where: { id: original.reversedBy } });
        if (existing) return { entry: existing, created: false };
      }
      if (original.status !== 'POSTED') {
        throw new ConflictException(`Only POSTED entries can be reversed (entry is ${original.status})`);
      }
      if (original.reversalOf) throw new ConflictException('A reversal entry cannot itself be reversed');

      const lines = await m.getRepository(JournalLine).find({ where: { entryId }, order: { lineNo: 'ASC' } });
      const result = await this.post(
        {
          entryDate: opts.entryDate,
          description: `Reversal: ${original.description}`.slice(0, 255),
          reference: original.reference,
          currency: original.currency,
          sourceType: original.sourceType,
          sourceId: original.sourceId ?? original.id,
          sourceEvent: opts.sourceEvent ?? `reversal:${original.id}`,
          reversalOf: original.id,
          createdBy: opts.createdBy ?? null,
          requestId: opts.requestId ?? null,
          metadata: { reason: opts.reason.slice(0, 500), reversalOf: original.id },
          lines: lines.map((l) => ({
            accountId: l.accountId,
            debitMinor: l.creditMinor,
            creditMinor: l.debitMinor,
            description: l.description,
            customerId: l.customerId,
            vendorId: l.vendorId,
          })),
        },
        m,
      );
      await repo.update(original.id, { status: 'REVERSED', reversedBy: result.entry.id });
      return result;
    });
  }

  private lockMode(m: EntityManager): { mode: 'pessimistic_write' } | undefined {
    // sqlite (tests) has no row locks; Postgres gets SELECT ... FOR UPDATE.
    return m.connection.options.type === 'postgres' ? { mode: 'pessimistic_write' } : undefined;
  }

  private async resolveAccounts(lines: PostLineInput[], m: EntityManager): Promise<string[]> {
    const repo = m.getRepository(LedgerAccount);
    const keys = [...new Set(lines.map((l) => l.accountKey).filter((k): k is SystemAccountKey => !!k))];
    const ids = [...new Set(lines.map((l) => l.accountId).filter((k): k is string => !!k))];

    const byKey = new Map<string, LedgerAccount>();
    if (keys.length) {
      for (const a of await repo.find({ where: { systemKey: In(keys) } })) byKey.set(a.systemKey!, a);
    }
    const byId = new Map<string, LedgerAccount>();
    if (ids.length) {
      for (const a of await repo.find({ where: { id: In(ids) } })) byId.set(a.id, a);
    }

    return lines.map((line, i) => {
      const account = line.accountKey ? byKey.get(line.accountKey) : byId.get(line.accountId!);
      if (!account) {
        throw new BadRequestException(`Line ${i + 1}: account ${line.accountKey ?? line.accountId} does not exist`);
      }
      if (!account.isActive) {
        throw new BadRequestException(`Line ${i + 1}: account ${account.code} is inactive`);
      }
      return account.id;
    });
  }
}
