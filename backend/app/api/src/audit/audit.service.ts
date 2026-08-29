import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { EntityManager, Repository } from 'typeorm';

import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { WarehousesService } from '../warehouses/warehouses.service';
import { AuditEvent } from './entities/audit-event.entity';

export interface RecordAuditEventInput {
  actorUserId: number | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  warehouseId?: string | null;
  summary: string;
  metadata?: Record<string, unknown> | null;
}

const FORBIDDEN_METADATA_KEYS = new Set([
  'password',
  'password_hash',
  'passwordhash',
  'token',
  'access_token',
  'accesstoken',
  'secret',
]);

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditEvent)
    private readonly auditRepository: Repository<AuditEvent>,
    @Inject(forwardRef(() => WarehousesService))
    private readonly warehousesService: WarehousesService,
  ) {}

  private sanitizeMetadata(
    metadata: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> | null {
    if (!metadata) return null;
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (FORBIDDEN_METADATA_KEYS.has(key.toLowerCase())) continue;
      clean[key] = value;
    }
    return clean;
  }

  async record(
    input: RecordAuditEventInput,
    manager?: EntityManager,
  ): Promise<AuditEvent> {
    const repo = manager
      ? manager.getRepository(AuditEvent)
      : this.auditRepository;

    const event = repo.create({
      id: randomUUID(),
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      warehouseId: input.warehouseId ?? null,
      summary: input.summary,
      metadata: this.sanitizeMetadata(input.metadata),
    });

    return repo.save(event);
  }

  async searchAuthorized(
    actor: AuthenticatedUser,
    filters: {
      entityType?: string;
      actorUserId?: number;
      action?: string;
      warehouseId?: string;
      from?: Date;
      to?: Date;
      limit?: number;
      offset?: number;
    },
  ): Promise<{ items: AuditEvent[]; total: number }> {
    if (filters.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(actor, filters.warehouseId);
    }

    const qb = this.auditRepository
      .createQueryBuilder('event')
      .orderBy('event.occurredAt', 'DESC')
      .take(Math.min(filters.limit ?? 50, 200))
      .skip(filters.offset ?? 0);

    if (filters.warehouseId) {
      qb.andWhere('event.warehouseId = :warehouseId', {
        warehouseId: filters.warehouseId,
      });
    } else if (
      !actor.hasGlobalAccess &&
      (!actor.permissions || !actor.permissions.includes('warehouses:global_access'))
    ) {
      const authorizedIds = await this.warehousesService.getUserAuthorizedWarehouseIds(
        actor.id,
        actor.role,
        actor.permissions,
      );
      if (authorizedIds.length === 0) {
        qb.andWhere('event.warehouseId IS NULL');
      } else {
        qb.andWhere(
          '(event.warehouseId IN (:...authorizedIds) OR event.warehouseId IS NULL)',
          { authorizedIds },
        );
      }
    }

    if (filters.entityType) {
      qb.andWhere('event.entityType = :entityType', {
        entityType: filters.entityType,
      });
    }
    if (filters.actorUserId) {
      qb.andWhere('event.actorUserId = :actorUserId', {
        actorUserId: filters.actorUserId,
      });
    }
    if (filters.action) {
      qb.andWhere('event.action = :action', { action: filters.action });
    }
    if (filters.from) {
      qb.andWhere('event.occurredAt >= :from', { from: filters.from });
    }
    if (filters.to) {
      qb.andWhere('event.occurredAt <= :to', { to: filters.to });
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  search(filters: {
    entityType?: string;
    actorUserId?: number;
    action?: string;
    warehouseId?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }) {
    const qb = this.auditRepository
      .createQueryBuilder('event')
      .orderBy('event.occurredAt', 'DESC')
      .take(Math.min(filters.limit ?? 50, 200))
      .skip(filters.offset ?? 0);

    if (filters.entityType) {
      qb.andWhere('event.entityType = :entityType', {
        entityType: filters.entityType,
      });
    }
    if (filters.actorUserId) {
      qb.andWhere('event.actorUserId = :actorUserId', {
        actorUserId: filters.actorUserId,
      });
    }
    if (filters.action) {
      qb.andWhere('event.action = :action', { action: filters.action });
    }
    if (filters.warehouseId) {
      qb.andWhere('event.warehouseId = :warehouseId', {
        warehouseId: filters.warehouseId,
      });
    }
    if (filters.from) {
      qb.andWhere('event.occurredAt >= :from', { from: filters.from });
    }
    if (filters.to) {
      qb.andWhere('event.occurredAt <= :to', { to: filters.to });
    }

    return qb.getManyAndCount().then(([items, total]) => ({ items, total }));
  }
}
