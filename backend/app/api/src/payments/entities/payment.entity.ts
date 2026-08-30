import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'payments' })
export class Payment {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string | null;

  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId: string | null;

  @Column({ type: 'varchar', length: 32, default: 'stripe' })
  provider: string;

  @Column({
    name: 'provider_payment_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  providerPaymentId: string | null;

  @Column({
    name: 'provider_checkout_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  providerCheckoutId: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  @Column({ type: 'varchar', length: 8, default: 'CAD' })
  currency: string;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
  status: string; // 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded'

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  @Column({ type: 'simple-json', nullable: true })
  metadata: Record<string, any> | null;

  @Column({
    name: 'paid_at',
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz',
    nullable: true,
  })
  paidAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
