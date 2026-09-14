import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { bigintNumberTransformer, TIMESTAMP_COLUMN_TYPE } from '../../common/db-types';
import type { PaymentStatus } from '../payment-status';

/**
 * A GreenWave payment. `id` is the business identifier; Stripe ids are
 * provider references only. Money is integer minor units (`amountMinor` etc.).
 * The legacy NUMERIC `amount` column is still written for compatibility with
 * migration 014 consumers but is never read for decisions.
 *
 * The partial unique index below mirrors migration 019 so the sqlite test
 * database enforces the same one-open-attempt rule as Postgres.
 */
@Entity({ name: 'payments' })
@Index('uq_payments_one_open_attempt', ['invoiceId'], {
  unique: true,
  where: `status IN ('CREATED','REQUIRES_ACTION','PROCESSING')`,
})
export class Payment {
  @PrimaryColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  @Index()
  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string | null;

  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId: string | null;

  @Column({ type: 'varchar', length: 32, default: 'stripe' })
  provider: string;

  @Index({ unique: true, where: 'provider_payment_id IS NOT NULL' })
  @Column({ name: 'provider_payment_id', type: 'varchar', length: 128, nullable: true })
  providerPaymentId: string | null;

  /** Legacy (simulated checkout sessions). Not written by the PaymentIntent flow. */
  @Column({ name: 'provider_checkout_id', type: 'varchar', length: 128, nullable: true })
  providerCheckoutId: string | null;

  @Index()
  @Column({ name: 'provider_charge_id', type: 'varchar', length: 128, nullable: true })
  providerChargeId: string | null;

  @Column({ name: 'provider_customer_id', type: 'varchar', length: 128, nullable: true })
  providerCustomerId: string | null;

  @Column({ name: 'provider_balance_txn_id', type: 'varchar', length: 128, nullable: true })
  providerBalanceTxnId: string | null;

  /** Legacy decimal mirror of amountMinor. */
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  @Column({ name: 'amount_minor', type: 'bigint', transformer: bigintNumberTransformer })
  amountMinor: number;

  @Column({ name: 'fee_minor', type: 'bigint', nullable: true, transformer: bigintNumberTransformer })
  feeMinor: number | null;

  @Column({ name: 'net_minor', type: 'bigint', nullable: true, transformer: bigintNumberTransformer })
  netMinor: number | null;

  @Column({ name: 'refunded_minor', type: 'bigint', default: 0, transformer: bigintNumberTransformer })
  refundedMinor: number;

  @Column({ name: 'disputed_minor', type: 'bigint', default: 0, transformer: bigintNumberTransformer })
  disputedMinor: number;

  @Column({ type: 'varchar', length: 8, default: 'CAD' })
  currency: string;

  @Index()
  @Column({ type: 'varchar', length: 32, default: 'CREATED' })
  status: PaymentStatus;

  @Column({ name: 'payment_method_type', type: 'varchar', length: 48, nullable: true })
  paymentMethodType: string | null;

  /** Display-safe only, e.g. "Visa •••• 4242". Never a full PAN. */
  @Column({ name: 'payment_method_display', type: 'varchar', length: 64, nullable: true })
  paymentMethodDisplay: string | null;

  @Column({ name: 'dispute_status', type: 'varchar', length: 48, nullable: true })
  disputeStatus: string | null;

  @Index({ unique: true, where: 'idempotency_key IS NOT NULL' })
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, nullable: true })
  idempotencyKey: string | null;

  /** `created` of the newest provider event applied; older events cannot regress state. */
  @Column({ name: 'last_event_created', type: 'bigint', nullable: true, transformer: bigintNumberTransformer })
  lastEventCreated: number | null;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  @Column({ type: 'simple-json', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ name: 'paid_at', type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  paidAt: Date | null;

  @Column({ name: 'failed_at', type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  failedAt: Date | null;

  @Column({ name: 'canceled_at', type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  canceledAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
