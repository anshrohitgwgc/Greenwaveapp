import { Column, ViewEntity } from 'typeorm';

/**
 * Read-only mapping onto the `inventory_balances` SQL view (see migrations
 * 007 & 011). Current stock is always computed at read time from the ledger:
 * Inbound - Outbound +/- Adjustments per size (XL, L, M, S) and overall Total.
 * There is no editable "stock total" column anywhere to drift out of sync.
 */
@ViewEntity({
  name: 'inventory_balances',
  expression: `
    SELECT
      warehouse_id,
      division,
      material_id,
      SUM(CASE WHEN type = 'inbound' THEN xl WHEN type = 'outbound' THEN -xl WHEN type = 'adjustment' THEN xl ELSE 0 END) AS xl_balance,
      SUM(CASE WHEN type = 'inbound' THEN l WHEN type = 'outbound' THEN -l WHEN type = 'adjustment' THEN l ELSE 0 END) AS l_balance,
      SUM(CASE WHEN type = 'inbound' THEN m WHEN type = 'outbound' THEN -m WHEN type = 'adjustment' THEN m ELSE 0 END) AS m_balance,
      SUM(CASE WHEN type = 'inbound' THEN s WHEN type = 'outbound' THEN -s WHEN type = 'adjustment' THEN s ELSE 0 END) AS s_balance,
      SUM(CASE WHEN type = 'inbound' THEN total WHEN type = 'outbound' THEN -total WHEN type = 'adjustment' THEN total ELSE 0 END) AS balance,
      SUM(CASE WHEN type = 'inbound' THEN total ELSE 0 END) AS inbound_total,
      SUM(CASE WHEN type = 'outbound' THEN total ELSE 0 END) AS outbound_total,
      SUM(CASE WHEN type = 'adjustment' THEN total ELSE 0 END) AS adjustment_total
    FROM inventory_transactions
    GROUP BY warehouse_id, division, material_id
  `,
})
export class InventoryBalance {
  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId: string;

  @Column({ type: 'varchar', length: 32, default: 'recycling' })
  division: string;

  @Column({ name: 'material_id', type: 'uuid' })
  materialId: string;

  @Column({ name: 'xl_balance', type: 'numeric', default: 0 })
  xlBalance: string;

  @Column({ name: 'l_balance', type: 'numeric', default: 0 })
  lBalance: string;

  @Column({ name: 'm_balance', type: 'numeric', default: 0 })
  mBalance: string;

  @Column({ name: 's_balance', type: 'numeric', default: 0 })
  sBalance: string;

  @Column({ type: 'numeric', default: 0 })
  balance: string;

  @Column({ name: 'inbound_total', type: 'numeric', default: 0 })
  inboundTotal: string;

  @Column({ name: 'outbound_total', type: 'numeric', default: 0 })
  outboundTotal: string;

  @Column({ name: 'adjustment_total', type: 'numeric', default: 0 })
  adjustmentTotal: string;
}
