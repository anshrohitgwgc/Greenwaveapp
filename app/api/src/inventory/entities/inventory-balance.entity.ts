import { Column, ViewEntity } from 'typeorm';

/**
 * Read-only mapping onto the `inventory_balances` SQL view (see migration
 * 007). Current stock is always SUM(inbound) - SUM(outbound) +/-
 * SUM(adjustment) computed at read time — there is no editable "stock
 * total" column anywhere to drift out of sync with the ledger.
 */
@ViewEntity({
  name: 'inventory_balances',
  expression: `
    SELECT
      warehouse_id,
      material_id,
      SUM(CASE WHEN type = 'inbound' THEN total
               WHEN type = 'outbound' THEN -total
               WHEN type = 'adjustment' THEN total
               ELSE 0 END) AS balance
    FROM inventory_transactions
    GROUP BY warehouse_id, material_id
  `,
})
export class InventoryBalance {
  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId: string;

  @Column({ name: 'material_id', type: 'uuid' })
  materialId: string;

  @Column({ type: 'numeric' })
  balance: string;
}
