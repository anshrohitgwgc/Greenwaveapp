import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { EntityManager, Repository } from 'typeorm';

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

/**
 * Append-only at the application layer: this service exposes no update or
 * delete method, and no controller in this codebase issues PATCH/DELETE
 * against /audit. True DB-level immutability (revoking UPDATE/DELETE from
 * the app's Postgres role) is a deployment-time hardening step — see
 * docs/V2_ARCHITECTURE.md Known Limitations.
 */
@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditEvent)
    private readonly auditRepository: Repository<AuditEvent>,
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

  async search(filters: {
    entityType?: string;
    actorUserId?: number;
    action?: string;
    warehouseId?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ items: AuditEvent[]; total: number }> {
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

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }
}
