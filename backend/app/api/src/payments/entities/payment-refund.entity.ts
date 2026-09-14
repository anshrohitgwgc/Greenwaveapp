import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { bigintNumberTransformer, TIMESTAMP_COLUMN_TYPE } from '../../common/db-types';

export type RefundStatus = 'REQUESTED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'REQUIRES_ACTION';

@Entity({ name: 'payment_refunds' })
export class PaymentRefund {
  @PrimaryColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'payment_id', type: 'uuid' })
  paymentId: string;

  @Column({ type: 'varchar', length: 32, default: 'stripe' })
  provider: string;

  @Index({ unique: true, where: 'provider_refund_id IS NOT NULL' })
  @Column({ name: 'provider_refund_id', type: 'varchar', length: 128, nullable: true })
  providerRefundId: string | null;

  @Column({ name: 'amount_minor', type: 'bigint', transformer: bigintNumberTransformer })
  amountMinor: number;

  @Column({ type: 'varchar', length: 8 })
  currency: string;

  @Column({ type: 'varchar', length: 24, default: 'REQUESTED' })
  status: RefundStatus;

  @Column({ type: 'varchar', length: 48, nullable: true })
  reason: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, unique: true })
  idempotencyKey: string;

  @Column({ name: 'requested_by', type: 'int', nullable: true })
  requestedBy: number | null;

  @Column({ name: 'succeeded_at', type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  succeededAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
