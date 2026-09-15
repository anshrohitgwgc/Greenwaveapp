# GreenWave Operations Platform — Excel Workflow Parity Audit

This document is the authoritative verification of how the GreenWave V2 Operations Platform translates the business workflows from the GreenWave Excel inventory workbook into a server-authoritative, multi-warehouse operational ERP system.

---

## 1. Reference Sections in GreenWave Excel Workbook

The reference Excel workbook consists of three primary operational workflows:

1. **INBOUND / INWARD**:
   - Captures arrival of shipments, order numbers, physical containers, seals, products, and size breakdowns (XL, L, M, S) with automated total summation.
2. **CONTAINER / LOADING / OUTBOUND**:
   - Captures dispatches and loading details: Container No., Seal No., Order/Ref No., BL No., Shipping Line, ETA, Product, size breakdown (XL, L, M, S), Total, Status, and operational notes (e.g. `SI SENT`, `In Transit`, `Dispatched`).
3. **STOCK / FINAL BALANCE**:
   - Reconciles current on-hand quantities per product and per size ($XL, L, M, S$) dynamically:
     $$\text{Current Stock} = \text{Total Inbound} - \text{Total Outbound} \pm \text{Valid Adjustments}$$

---

## 2. Field-by-Field Mapping & Data Architecture

| Excel Column / Concept | Application UI Field | Backend DTO / Entity | PostgreSQL Database Field | Business Logic & Calculation |
| :--- | :--- | :--- | :--- | :--- |
| **Date** | `Date` (HTML date input) | `createdAt` / `date` | `inventory_transactions.created_at` (TIMESTAMP WITH TIME ZONE) | Date when shipment was physically received or dispatched. Default: current date. |
| **Order Number** | `Order #` / `Order Number` | `orderNumber` / `reference` | `inventory_transactions.order_number` (VARCHAR 100) | Order / PO reference string (e.g. `Jul20-DIVESTPC-AB38A`). Searchable and indexed. |
| **Container No** | `Container Number` | `containerNumber` | `inventory_transactions.container_number`, `containers.container_number` | Intermodal shipping container ID (e.g. `MSMU 6896930`). Auto-links container tracking. |
| **Seal No** | `Seal Number` | `sealNumber` | `inventory_transactions.seal_number`, `containers.seal_number` | High-security bolt/cable seal number (e.g. `0336695`). Auto-links container tracking. |
| **Shipping Line** | `Shipping Line` | `shippingLine` | `containers.shipping_line` (VARCHAR 100) | Carrier/ocean line (e.g. `Maersk`, `MSC`, `Hapag-Lloyd`). |
| **BL Number** | `BL Number` | `blNumber` | `containers.bl_number` (VARCHAR 100) | Bill of Lading identifier. |
| **ETA** | `ETA / Date` | `eta` | `containers.eta` (DATE) | Estimated arrival date at destination. |
| **Product** | `Product / Material` | `materialId`, `materialName` | `inventory_transactions.material_id` (UUID FK -> `materials.id`) | Catalog product (e.g. `Synguard 100`, `Sonic 300`, `Transform 200`). |
| **XL** | `XL` quantity | `xl` (numeric) | `inventory_transactions.xl` (NUMERIC 12,3) | Extra Large case/unit quantity. Default 0. |
| **L** | `L` quantity | `l` (numeric) | `inventory_transactions.l` (NUMERIC 12,3) | Large case/unit quantity. Default 0. |
| **M** | `M` quantity | `m` (numeric) | `inventory_transactions.m` (NUMERIC 12,3) | Medium case/unit quantity. Default 0. |
| **S** | `S` quantity | `s` (numeric) | `inventory_transactions.s` (NUMERIC 12,3) | Small case/unit quantity. Default 0. |
| **Total** | `Total` | `total` (numeric) | `inventory_transactions.total` (NUMERIC 12,3) | **Auto-calculated**: $\text{TOTAL} = \text{XL} + \text{L} + \text{M} + \text{S}$. Calculated live in UI on input and enforced server-side. |
| **Status** | `Status` badge | `status` | `containers.status` (VARCHAR 32) | `received`, `dispatched`, `in_transit`, `adjusted`. |
| **Notes / Reason** | `Notes` / `Reason` | `notes` / `reason` | `inventory_transactions.notes`, `inventory_transactions.reason` | Mandatory for adjustments, optional for inbound/outbound. |

---

## 3. Mathematical Parity & Balance Formula Verification

### A. Line Total Formula
$$\text{Line Total} = \text{XL} + \text{L} + \text{M} + \text{S}$$
- Enforced on client: UI updates the `#modalAutoTotal` preview on every keystroke in `.size-input`.
- Enforced on server: `InventoryService.createTransaction` calculates `total = roundQuantity(xl + l + m + s)`. Any client attempt to override the total is discarded.

### B. Dynamic Inventory Balance View
The database view `inventory_balances` dynamically groups transactions per warehouse and per material:
```sql
CREATE OR REPLACE VIEW inventory_balances AS
SELECT
    warehouse_id,
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
GROUP BY warehouse_id, material_id;
```

---

## 4. Multi-Warehouse Isolation Verification

GreenWave operates 3 standard facilities:
1. `Calgary, AB` (`22222222-2222-4222-8222-222222222222`)
2. `Ontario` (`33333333-3333-4333-8333-333333333333`)
3. `Maple Ridge, BC` (`11111111-1111-4111-8111-111111111111`)

Every database query and API endpoint enforces strict isolation using `WHERE warehouse_id = :warehouseId`. Transactions in Calgary never alter Ontario or Maple Ridge balances.
