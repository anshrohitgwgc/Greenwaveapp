import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { formatMinor } from '../common/money';
import { CreateManualEntryDto, JournalListQueryDto, ReverseEntryDto } from './dto/accounting.dto';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalLine } from './entities/journal-line.entity';
import { LedgerAccount } from './entities/ledger-account.entity';
import { LedgerService } from './ledger.service';

/** Browsing the journal and creating manual (adjusting) entries. */
@Injectable()
export class JournalService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly ledger: LedgerService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async list(q: JournalListQueryDto) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const qb = this.ds.getRepository(JournalEntry).createQueryBuilder('e');
    if (q.from) qb.andWhere('e.entryDate >= :from', { from: q.from });
    if (q.to) qb.andWhere('e.entryDate <= :to', { to: q.to });
    if (q.sourceType) qb.andWhere('e.sourceType = :sourceType', { sourceType: q.sourceType });
    if (q.status) qb.andWhere('e.status = :status', { status: q.status });
    if (q.currency) qb.andWhere('e.currency = :currency', { currency: q.currency });
    if (q.q?.trim()) {
      const like = `%${q.q.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      qb.andWhere("(LOWER(e.description) LIKE :like ESCAPE '\\' OR LOWER(e.reference) LIKE :like ESCAPE '\\')", { like });
    }
    const [entries, total] = await qb
      .orderBy('e.entryDate', 'DESC')
      .addOrderBy('e.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    const ids = entries.map((e) => e.id);
    const sums = ids.length
      ? await this.ds
          .getRepository(JournalLine)
          .createQueryBuilder('l')
          .select('l.entryId', 'entryId')
          .addSelect('COALESCE(SUM(l.debitMinor), 0)', 'total')
          .where('l.entryId IN (:...ids)', { ids })
          .groupBy('l.entryId')
          .getRawMany<{ entryId: string; total: string | number }>()
      : [];
    const totalOf = new Map(sums.map((s) => [s.entryId, Number(s.total)]));
    return {
      page,
      pageSize,
      total,
      items: entries.map((e) => ({
        id: e.id,
        entryDate: e.entryDate,
        description: e.description,
        reference: e.reference,
        status: e.status,
        currency: e.currency,
        sourceType: e.sourceType,
        sourceId: e.sourceId,
        sourceEvent: e.sourceEvent,
        reversalOf: e.reversalOf,
        reversedBy: e.reversedBy,
        totalMinor: totalOf.get(e.id) ?? 0,
        createdAt: e.createdAt,
      })),
    };
  }

  async get(id: string) {
    const entry = await this.ds.getRepository(JournalEntry).findOne({ where: { id } });
    if (!entry) throw new NotFoundException('Journal entry not found');
    const lines = await this.ds.getRepository(JournalLine).find({ where: { entryId: id }, order: { lineNo: 'ASC' } });
    const accounts = await this.ds.getRepository(LedgerAccount).find({ where: { id: In(lines.map((l) => l.accountId)) } });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return {
      ...entry,
      lines: lines.map((l) => ({
        lineNo: l.lineNo,
        accountId: l.accountId,
        accountCode: byId.get(l.accountId)?.code ?? null,
        accountName: byId.get(l.accountId)?.name ?? null,
        debitMinor: l.debitMinor,
        creditMinor: l.creditMinor,
        description: l.description,
        customerId: l.customerId,
      })),
    };
  }

  async createManual(dto: CreateManualEntryDto, actor: AuthenticatedUser, requestId: string | null) {
    const { entry } = await this.ledger.post({
      entryDate: dto.entryDate,
      description: dto.description,
      reference: dto.reference ?? null,
      currency: dto.currency,
      sourceType: 'manual',
      sourceId: null,
      sourceEvent: null,
      status: dto.post ? 'POSTED' : 'DRAFT',
      createdBy: actor.id,
      requestId,
      lines: dto.lines.map((l) => ({
        accountId: l.accountId,
        debitMinor: l.debitMinor ?? 0,
        creditMinor: l.creditMinor ?? 0,
        description: l.description ?? null,
      })),
    });
    const total = dto.lines.reduce((s, l) => s + (l.debitMinor ?? 0), 0);
    await this.audit?.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: dto.post ? 'journal.manual_posted' : 'journal.manual_drafted',
      entityType: 'journal_entry',
      entityId: entry.id,
      summary: `${actor.email} ${dto.post ? 'posted' : 'drafted'} manual entry "${entry.description}" (${formatMinor(total, dto.currency)})`,
      metadata: { entryDate: dto.entryDate, lineCount: dto.lines.length, totalMinor: total, requestId },
    });
    return this.get(entry.id);
  }

  async post(id: string, actor: AuthenticatedUser, requestId: string | null) {
    const entry = await this.ds.getRepository(JournalEntry).findOne({ where: { id } });
    if (!entry) throw new NotFoundException('Journal entry not found');
    if (entry.sourceType !== 'manual') throw new ConflictException('Only manual entries can be posted here');
    await this.ledger.postDraft(id);
    await this.audit?.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'journal.manual_posted',
      entityType: 'journal_entry',
      entityId: id,
      summary: `${actor.email} posted manual entry "${entry.description}"`,
      metadata: { requestId },
    });
    return this.get(id);
  }

  async reverse(id: string, dto: ReverseEntryDto, actor: AuthenticatedUser, requestId: string | null) {
    const entry = await this.ds.getRepository(JournalEntry).findOne({ where: { id } });
    if (!entry) throw new NotFoundException('Journal entry not found');
    if (entry.sourceType !== 'manual') {
      throw new ConflictException('System-generated entries are reversed by the workflow that created them (void, refund, reset)');
    }
    const result = await this.ledger.reverse(id, { entryDate: dto.entryDate, reason: dto.reason, createdBy: actor.id, requestId });
    if (result.created) {
      await this.audit?.record({
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'journal.manual_reversed',
        entityType: 'journal_entry',
        entityId: id,
        summary: `${actor.email} reversed manual entry "${entry.description}"`,
        metadata: { reversalEntryId: result.entry.id, reason: dto.reason, requestId },
      });
    }
    return this.get(result.entry.id);
  }
}
