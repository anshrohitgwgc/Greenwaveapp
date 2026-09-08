import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { PurchaseOrderItem } from './purchase-order-item.entity';

/**
 * A purchase order issued by GreenWave to a supplier.
 *
 * Deliberately a separate document type from Invoice: it is money going out
 * rather than in, it carries its own numbering series (`PO-0001`, see
 * migration 018), and its line items describe traded resin (code / resin /
 * colour) rather than billed services.
 */
@Entity({ name: 'purchase_orders' })
export class PurchaseOrder {
  @PrimaryColumn('uuid')
  id: string;

  /** Rendered document number, e.g. `PO-0001`. Assigned once, never changed. */
  @Column({ name: 'po_number', type: 'varchar', length: 32, unique: true })
  poNumber: string;

  /**
   * The raw value drawn from `purchase_order_number_seq` that backs poNumber.
   * Stored separately so the series can be resumed without parsing the
   * formatted string. `bigint` maps to a JS string in TypeORM to avoid
   * precision loss.
   */
  @Column({ name: 'sequence_number', type: 'bigint', unique: true })
  sequenceNumber: string;

  @Column({ name: 'order_date', type: 'date' })
  orderDate: string;

  @Column({ name: 'expected_date', type: 'date', nullable: true })
  expectedDate: string | null;

  @Column({ type: 'varchar', length: 8, default: 'USD' })
  currency: string;

  @Column({ name: 'supplier_name', type: 'varchar', length: 200 })
  supplierName: string;

  @Column({ name: 'supplier_address', type: 'text', nullable: true })
  supplierAddress: string | null;

  @Column({
    name: 'supplier_city',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  supplierCity: string | null;

  @Column({
    name: 'supplier_province',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  supplierProvince: string | null;

  @Column({
    name: 'supplier_postal_code',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  supplierPostalCode: string | null;

  @Column({
    name: 'supplier_country',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  supplierCountry: string | null;

  @Column({
    name: 'supplier_phone',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  supplierPhone: string | null;

  @Column({
    name: 'supplier_email',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  supplierEmail: string | null;

  /**
   * Letterhead snapshot, mirroring Invoice.companyInfo — the API has no
   * company-settings table, so each document keeps what was on screen when it
   * was saved.
   */
  @Column({ name: 'company_info', type: 'simple-json', nullable: true })
  companyInfo: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** Always recomputed server-side from the line items; never client-supplied. */
  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  total: string;

  /** The "Date: ____________" signature line at the foot of the document. */
  @Column({ name: 'footer_date', type: 'date', nullable: true })
  footerDate: string | null;

  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: string;

  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId: string | null;

  /**
   * Business division this PO belongs to. Storage value — `recycling` or
   * `healthcare`, see src/divisions/divisions.constants.ts. Scoping only; it
   * has no bearing on PO numbering, which is a single global sequence.
   */
  @Column({ type: 'varchar', length: 32, default: 'recycling' })
  division: string;

  @Column({ name: 'created_by', type: 'int' })
  createdBy: number;

  @Column({ name: 'updated_by', type: 'int', nullable: true })
  updatedBy: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => PurchaseOrderItem, (item) => item.purchaseOrder, {
    cascade: true,
  })
  items: PurchaseOrderItem[];
}
