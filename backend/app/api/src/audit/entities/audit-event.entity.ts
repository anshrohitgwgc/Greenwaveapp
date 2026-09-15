import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity({ name: 'audit_events' })
export class AuditEvent {
  @PrimaryColumn('uuid')
  id: string;

  // No explicit `type` here so this entity's metadata can build against
  // both Postgres (real DB, timestamptz per migration 010) and sqlite
  // (used by src/auth/auth-rbac.integration.spec.ts) — TypeORM picks an
  // appropriate default per driver, and since this app never runs
  // `synchronize` against Postgres, the annotation doesn't drive real DDL.
  @CreateDateColumn({ name: 'occurred_at' })
  occurredAt: Date;

  @Index()
  @Column({ name: 'actor_user_id', type: 'int', nullable: true })
  actorUserId: number | null;

  @Column({ name: 'actor_role', type: 'varchar', length: 32, nullable: true })
  actorRole: string | null;

  @Column({ type: 'varchar', length: 100 })
  action: string;

  @Index()
  @Column({ name: 'entity_type', type: 'varchar', length: 100 })
  entityType: string;

  @Column({ name: 'entity_id', type: 'varchar', length: 100, nullable: true })
  entityId: string | null;

  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId: string | null;

  @Column({ type: 'text' })
  summary: string;

  // 'simple-json' (not 'jsonb') so this column works against both Postgres
  // and sqlite — see the note on occurredAt above.
  @Column({ type: 'simple-json', nullable: true })
  metadata: Record<string, unknown> | null;
}
