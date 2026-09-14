import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { toBusinessDate } from '../common/dates';
import { AccountingReportsService } from './accounting-reports.service';
import { AccountType, DEFAULT_NORMAL_BALANCE } from './chart-of-accounts';
import { CreateLedgerAccountDto, UpdateLedgerAccountDto } from './dto/accounting.dto';
import { LedgerAccount } from './entities/ledger-account.entity';

@Injectable()
export class ChartOfAccountsService {
  constructor(
    @InjectRepository(LedgerAccount) private readonly accounts: Repository<LedgerAccount>,
    private readonly reports: AccountingReportsService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async list(q: { includeInactive?: string; asOf?: string; currency?: string }) {
    const currency = this.reports.currencyOf(q.currency);
    const asOf = q.asOf ?? toBusinessDate(new Date());
    const [all, balances] = await Promise.all([this.reports.accounts(), this.reports.balances({ to: asOf, currency })]);
    return {
      asOf,
      currency,
      accounts: all
        .filter((a) => q.includeInactive === 'true' || a.isActive)
        .map((a) => {
          const t = balances.get(a.id);
          const balance = t ? (a.normalBalance === 'DEBIT' ? t.debit - t.credit : t.credit - t.debit) : 0;
          return {
            id: a.id,
            code: a.code,
            name: a.name,
            type: a.type,
            subtype: a.subtype,
            normalBalance: a.normalBalance,
            parentId: a.parentId,
            systemKey: a.systemKey,
            isSystem: !!a.systemKey,
            isActive: a.isActive,
            description: a.description,
            balanceMinor: balance,
          };
        }),
    };
  }

  private async assertParent(parentId: string | null | undefined, type: string, selfId?: string): Promise<void> {
    if (!parentId) return;
    if (parentId === selfId) throw new BadRequestException('An account cannot be its own parent');
    let cursor: string | null = parentId;
    for (let depth = 0; cursor && depth < 20; depth++) {
      const parent: LedgerAccount | null = await this.accounts.findOne({ where: { id: cursor } });
      if (!parent) throw new BadRequestException('Parent account not found');
      if (depth === 0 && parent.type !== type) throw new BadRequestException('Parent account must have the same type');
      if (selfId && parent.parentId === selfId) throw new BadRequestException('That parent would create a cycle');
      cursor = parent.parentId;
    }
  }

  async create(dto: CreateLedgerAccountDto, actor: AuthenticatedUser) {
    if (await this.accounts.findOne({ where: { code: dto.code } })) {
      throw new ConflictException(`Account code ${dto.code} already exists`);
    }
    const type = dto.type as AccountType;
    await this.assertParent(dto.parentId, type);
    const account = await this.accounts.save(
      this.accounts.create({
        id: randomUUID(),
        code: dto.code,
        name: dto.name.trim(),
        type,
        subtype: dto.subtype ?? null,
        normalBalance: dto.normalBalance ?? DEFAULT_NORMAL_BALANCE[type],
        parentId: dto.parentId ?? null,
        systemKey: null,
        isActive: true,
        description: dto.description ?? null,
      }),
    );
    await this.audit?.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'accounting.account_created',
      entityType: 'ledger_account',
      entityId: account.id,
      summary: `${actor.email} created account ${account.code} ${account.name}`,
      metadata: { code: account.code, type: account.type, normalBalance: account.normalBalance },
    });
    return account;
  }

  async update(id: string, dto: UpdateLedgerAccountDto, actor: AuthenticatedUser) {
    const account = await this.accounts.findOne({ where: { id } });
    if (!account) throw new NotFoundException('Account not found');
    const before = { name: account.name, subtype: account.subtype, parentId: account.parentId, isActive: account.isActive };

    if (dto.isActive === false && account.isActive) {
      if (account.systemKey) throw new ConflictException('System accounts used by automatic postings cannot be deactivated');
      const t = (await this.reports.balances({ to: '9999-12-31', currency: 'CAD', accountIds: [id] })).get(id);
      const u = (await this.reports.balances({ to: '9999-12-31', currency: 'USD', accountIds: [id] })).get(id);
      if ((t && t.debit !== t.credit) || (u && u.debit !== u.credit)) {
        throw new ConflictException('An account with a non-zero balance cannot be deactivated');
      }
    }
    if (dto.parentId !== undefined) await this.assertParent(dto.parentId, account.type, account.id);

    if (dto.name !== undefined) account.name = dto.name.trim();
    if (dto.subtype !== undefined) account.subtype = dto.subtype;
    if (dto.parentId !== undefined) account.parentId = dto.parentId ?? null;
    if (dto.description !== undefined) account.description = dto.description;
    if (dto.isActive !== undefined) account.isActive = dto.isActive;
    const saved = await this.accounts.save(account);

    await this.audit?.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'accounting.account_updated',
      entityType: 'ledger_account',
      entityId: id,
      summary: `${actor.email} updated account ${account.code}`,
      metadata: { before, after: { name: saved.name, subtype: saved.subtype, parentId: saved.parentId, isActive: saved.isActive } },
    });
    return saved;
  }
}
