import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

/**
 * GreenWave Operations Platform - Excel Workflow & Staging Acceptance Tests
 * Authoritative Business Verification:
 * USER INPUT -> AUTO CALCULATION -> TRANSACTION -> INVENTORY BALANCE -> CONTAINER/OUTBOUND -> FINAL STOCK -> AUDIT -> CSV EXPORT
 */

interface SizeQuantities {
  xl: number;
  l: number;
  m: number;
  s: number;
}

interface InventoryTransaction {
  id: string;
  warehouseId: string;
  materialId: string;
  materialName: string;
  type: 'inbound' | 'outbound' | 'adjustment';
  orderNumber?: string;
  containerNumber?: string;
  sealNumber?: string;
  shippingLine?: string;
  blNumber?: string;
  eta?: string;
  xl: number;
  l: number;
  m: number;
  s: number;
  total: number;
  reason?: string;
  notes?: string;
  createdBy: number;
  actorRole: string;
  createdAt: string;
}

interface ContainerRecord {
  id: string;
  warehouseId: string;
  containerNumber: string;
  sealNumber: string;
  orderNumber?: string;
  blNumber?: string;
  shippingLine?: string;
  eta?: string;
  productName: string;
  materialId: string;
  xl: number;
  l: number;
  m: number;
  s: number;
  total: number;
  status: 'in_transit' | 'received' | 'dispatched' | 'adjusted';
  notes?: string;
  createdBy: number;
  createdAt: string;
}

interface AuditRecord {
  id: string;
  actorUserId: number;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  warehouseId: string;
  summary: string;
}

class GreenWaveInventoryEngine {
  private transactions: InventoryTransaction[] = [];
  private containers: ContainerRecord[] = [];
  private audits: AuditRecord[] = [];

  // Core formula: XL + L + M + S = TOTAL
  static calculateTotal(sizes: Partial<SizeQuantities>): number {
    const xl = Math.max(0, Number(sizes.xl) || 0);
    const l = Math.max(0, Number(sizes.l) || 0);
    const m = Math.max(0, Number(sizes.m) || 0);
    const s = Math.max(0, Number(sizes.s) || 0);
    return Math.round((xl + l + m + s) * 1000) / 1000;
  }

  // Adjustments can be positive or negative per size
  static calculateAdjustmentTotal(sizes: Partial<SizeQuantities>): number {
    const xl = Number(sizes.xl) || 0;
    const l = Number(sizes.l) || 0;
    const m = Number(sizes.m) || 0;
    const s = Number(sizes.s) || 0;
    return Math.round((xl + l + m + s) * 1000) / 1000;
  }

  recordInbound(
    warehouseId: string,
    materialId: string,
    materialName: string,
    orderNumber: string,
    sizes: SizeQuantities,
    actor: { id: number; role: string; email: string },
    meta?: { containerNumber?: string; sealNumber?: string; notes?: string; date?: string },
  ): InventoryTransaction {
    const total = GreenWaveInventoryEngine.calculateTotal(sizes);
    const tx: InventoryTransaction = {
      id: 'tx-' + (this.transactions.length + 1),
      warehouseId,
      materialId,
      materialName,
      type: 'inbound',
      orderNumber,
      containerNumber: meta?.containerNumber,
      sealNumber: meta?.sealNumber,
      notes: meta?.notes,
      xl: sizes.xl,
      l: sizes.l,
      m: sizes.m,
      s: sizes.s,
      total,
      createdBy: actor.id,
      actorRole: actor.role,
      createdAt: meta?.date || new Date().toISOString(),
    };
    this.transactions.push(tx);

    if (meta?.containerNumber || meta?.sealNumber) {
      this.containers.push({
        id: 'cnt-' + (this.containers.length + 1),
        warehouseId,
        containerNumber: meta.containerNumber || 'UNKNOWN',
        sealNumber: meta.sealNumber || 'UNKNOWN',
        orderNumber,
        productName: materialName,
        materialId,
        xl: sizes.xl,
        l: sizes.l,
        m: sizes.m,
        s: sizes.s,
        total,
        status: 'received',
        notes: meta.notes,
        createdBy: actor.id,
        createdAt: tx.createdAt,
      });
    }

    this.audits.push({
      id: 'aud-' + (this.audits.length + 1),
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'inventory.inbound',
      entityType: 'inventory_transaction',
      entityId: tx.id,
      warehouseId,
      summary: `${actor.email} recorded inbound of ${total} (${materialName})`,
    });

    return tx;
  }

  recordOutbound(
    warehouseId: string,
    materialId: string,
    materialName: string,
    orderNumber: string,
    sizes: SizeQuantities,
    actor: { id: number; role: string; email: string },
    meta?: {
      containerNumber?: string;
      sealNumber?: string;
      shippingLine?: string;
      blNumber?: string;
      eta?: string;
      notes?: string;
      date?: string;
    },
  ): InventoryTransaction {
    const total = GreenWaveInventoryEngine.calculateTotal(sizes);
    const tx: InventoryTransaction = {
      id: 'tx-' + (this.transactions.length + 1),
      warehouseId,
      materialId,
      materialName,
      type: 'outbound',
      orderNumber,
      containerNumber: meta?.containerNumber,
      sealNumber: meta?.sealNumber,
      shippingLine: meta?.shippingLine,
      blNumber: meta?.blNumber,
      eta: meta?.eta,
      notes: meta?.notes,
      xl: sizes.xl,
      l: sizes.l,
      m: sizes.m,
      s: sizes.s,
      total,
      createdBy: actor.id,
      actorRole: actor.role,
      createdAt: meta?.date || new Date().toISOString(),
    };
    this.transactions.push(tx);

    if (meta?.containerNumber || meta?.sealNumber) {
      this.containers.push({
        id: 'cnt-' + (this.containers.length + 1),
        warehouseId,
        containerNumber: meta.containerNumber || 'UNKNOWN',
        sealNumber: meta.sealNumber || 'UNKNOWN',
        orderNumber,
        blNumber: meta.blNumber,
        shippingLine: meta.shippingLine,
        eta: meta.eta,
        productName: materialName,
        materialId,
        xl: sizes.xl,
        l: sizes.l,
        m: sizes.m,
        s: sizes.s,
        total,
        status: 'dispatched',
        notes: meta.notes,
        createdBy: actor.id,
        createdAt: tx.createdAt,
      });
    }

    this.audits.push({
      id: 'aud-' + (this.audits.length + 1),
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'inventory.outbound',
      entityType: 'inventory_transaction',
      entityId: tx.id,
      warehouseId,
      summary: `${actor.email} recorded outbound of ${total} (${materialName})`,
    });

    return tx;
  }

  recordAdjustment(
    warehouseId: string,
    materialId: string,
    materialName: string,
    sizes: SizeQuantities,
    reason: string,
    actor: { id: number; role: string; email: string },
  ): InventoryTransaction {
    if (!['admin', 'manager'].includes(actor.role)) {
      const err = new Error('Forbidden: Adjustments require a manager or administrator');
      (err as any).status = 403;
      throw err;
    }
    if (!reason || !reason.trim()) {
      const err = new Error('Bad Request: Adjustment reason is required');
      (err as any).status = 400;
      throw err;
    }

    const total = GreenWaveInventoryEngine.calculateAdjustmentTotal(sizes);
    const tx: InventoryTransaction = {
      id: 'tx-' + (this.transactions.length + 1),
      warehouseId,
      materialId,
      materialName,
      type: 'adjustment',
      reason,
      xl: sizes.xl,
      l: sizes.l,
      m: sizes.m,
      s: sizes.s,
      total,
      createdBy: actor.id,
      actorRole: actor.role,
      createdAt: new Date().toISOString(),
    };
    this.transactions.push(tx);

    this.audits.push({
      id: 'aud-' + (this.audits.length + 1),
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'inventory.adjustment',
      entityType: 'inventory_transaction',
      entityId: tx.id,
      warehouseId,
      summary: `${actor.email} adjusted stock by ${total} (reason: ${reason})`,
    });

    return tx;
  }

  // Live calculation of balances scoped strictly by warehouse
  getBalance(warehouseId: string, materialId: string) {
    const txs = this.transactions.filter(
      (t) => t.warehouseId === warehouseId && t.materialId === materialId,
    );

    let xl = 0, l = 0, m = 0, s = 0, total = 0, inbound = 0, outbound = 0, adj = 0;
    for (const t of txs) {
      if (t.type === 'inbound') {
        xl += t.xl; l += t.l; m += t.m; s += t.s; total += t.total; inbound += t.total;
      } else if (t.type === 'outbound') {
        xl -= t.xl; l -= t.l; m -= t.m; s -= t.s; total -= t.total; outbound += t.total;
      } else if (t.type === 'adjustment') {
        xl += t.xl; l += t.l; m += t.m; s += t.s; total += t.total; adj += t.total;
      }
    }

    return {
      warehouseId,
      materialId,
      xl: Math.round(xl * 1000) / 1000,
      l: Math.round(l * 1000) / 1000,
      m: Math.round(m * 1000) / 1000,
      s: Math.round(s * 1000) / 1000,
      total: Math.round(total * 1000) / 1000,
      inbound: Math.round(inbound * 1000) / 1000,
      outbound: Math.round(outbound * 1000) / 1000,
      adjustment: Math.round(adj * 1000) / 1000,
    };
  }

  listTransactions(filters: { warehouseId: string; search?: string; type?: string; materialId?: string }) {
    return this.transactions.filter((t) => {
      if (t.warehouseId !== filters.warehouseId) return false;
      if (filters.type && t.type !== filters.type) return false;
      if (filters.materialId && t.materialId !== filters.materialId) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const matches =
          (t.orderNumber || '').toLowerCase().includes(q) ||
          (t.containerNumber || '').toLowerCase().includes(q) ||
          (t.sealNumber || '').toLowerCase().includes(q) ||
          (t.materialName || '').toLowerCase().includes(q) ||
          (t.notes || '').toLowerCase().includes(q) ||
          (t.reason || '').toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }

  listContainers(warehouseId: string, search?: string) {
    return this.containers.filter((c) => {
      if (c.warehouseId !== warehouseId) return false;
      if (search) {
        const q = search.toLowerCase();
        const matches =
          (c.containerNumber || '').toLowerCase().includes(q) ||
          (c.sealNumber || '').toLowerCase().includes(q) ||
          (c.orderNumber || '').toLowerCase().includes(q) ||
          (c.blNumber || '').toLowerCase().includes(q) ||
          (c.productName || '').toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }

  getAudits(warehouseId: string) {
    return this.audits.filter((a) => a.warehouseId === warehouseId);
  }

  // Export to RFC 4180 compliant CSV
  generateBalancesCsv(warehouseId: string, warehouseName: string): string {
    const balances = this.transactions
      .filter((t) => t.warehouseId === warehouseId)
      .reduce((acc, t) => {
        if (!acc[t.materialId]) {
          acc[t.materialId] = this.getBalance(warehouseId, t.materialId);
        }
        return acc;
      }, {} as Record<string, ReturnType<GreenWaveInventoryEngine['getBalance']>>);

    let csv = 'Warehouse,Product ID,XL Balance,L Balance,M Balance,S Balance,Current Stock,Inbound Total,Outbound Total,Net Adjustment\r\n';
    for (const matId of Object.keys(balances)) {
      const b = balances[matId];
      csv += `"${warehouseName.replace(/"/g, '""')}","${matId}",${b.xl},${b.l},${b.m},${b.s},${b.total},${b.inbound},${b.outbound},${b.adjustment}\r\n`;
    }
    return csv;
  }
}

describe('End-to-End Excel Parity & Staging Acceptance Audit', () => {
  const adminActor = { id: 1, role: 'admin', email: 'admin@greenwaverecycling.ca' };
  const managerActor = { id: 2, role: 'manager', email: 'manager@greenwaverecycling.ca' };
  const staffActor = { id: 3, role: 'staff', email: 'staff@greenwaverecycling.ca' };

  it('Phase 2 — Calculation Parity: Exact Total = XL + L + M + S across all sample cases', () => {
    // Example A
    assert.equal(GreenWaveInventoryEngine.calculateTotal({ xl: 100, l: 200, m: 300, s: 400 }), 1000);
    // Example B
    assert.equal(GreenWaveInventoryEngine.calculateTotal({ xl: 0, l: 125, m: 250, s: 75 }), 450);
    // Example C
    assert.equal(GreenWaveInventoryEngine.calculateTotal({ xl: 17, l: 23, m: 19, s: 11 }), 70);
    // Zeroes & Undefined
    assert.equal(GreenWaveInventoryEngine.calculateTotal({ xl: 0, l: 0, m: 0, s: 0 }), 0);
    assert.equal(GreenWaveInventoryEngine.calculateTotal({}), 0);
  });

  it('Phase 3 — Staging Inbound Workflow: TEST-IN-001 at Calgary, AB', () => {
    const engine = new GreenWaveInventoryEngine();
    const inboundTx = engine.recordInbound(
      'CALGARY',
      'synguard-100',
      'Synguard 100',
      'TEST-IN-001',
      { xl: 100, l: 200, m: 300, s: 400 },
      adminActor,
      { notes: 'Initial stock receipt' },
    );

    assert.equal(inboundTx.total, 1000);
    assert.equal(inboundTx.orderNumber, 'TEST-IN-001');

    const bal = engine.getBalance('CALGARY', 'synguard-100');
    assert.deepEqual(bal, {
      warehouseId: 'CALGARY',
      materialId: 'synguard-100',
      xl: 100,
      l: 200,
      m: 300,
      s: 400,
      total: 1000,
      inbound: 1000,
      outbound: 0,
      adjustment: 0,
    });

    const audits = engine.getAudits('CALGARY');
    assert.equal(audits.length, 1);
    assert.ok(audits[0].summary.includes('1000'));
  });

  it('Phase 4 — Staging Outbound Workflow: TEST-OUT-001 with TESTCONTAINER001 & TESTSEAL001', () => {
    const engine = new GreenWaveInventoryEngine();
    // Inbound: 100, 200, 300, 400 = 1000
    engine.recordInbound('CALGARY', 'synguard-100', 'Synguard 100', 'TEST-IN-001', { xl: 100, l: 200, m: 300, s: 400 }, adminActor);

    // Outbound: 20, 30, 40, 50 = 140
    const outTx = engine.recordOutbound(
      'CALGARY',
      'synguard-100',
      'Synguard 100',
      'TEST-OUT-001',
      { xl: 20, l: 30, m: 40, s: 50 },
      adminActor,
      { containerNumber: 'TESTCONTAINER001', sealNumber: 'TESTSEAL001', shippingLine: 'Test Line', blNumber: 'TEST-BL-001' },
    );

    assert.equal(outTx.total, 140);

    const bal = engine.getBalance('CALGARY', 'synguard-100');
    assert.equal(bal.xl, 80);
    assert.equal(bal.l, 170);
    assert.equal(bal.m, 260);
    assert.equal(bal.s, 350);
    assert.equal(bal.total, 860);
    assert.equal(bal.inbound, 1000);
    assert.equal(bal.outbound, 140);

    const containers = engine.listContainers('CALGARY');
    assert.equal(containers.length, 1);
    assert.equal(containers[0].containerNumber, 'TESTCONTAINER001');
    assert.equal(containers[0].sealNumber, 'TESTSEAL001');
    assert.equal(containers[0].total, 140);
  });

  it('Phase 5 — Staging Adjustment: XL +10, L -5 with required reason and role check', () => {
    const engine = new GreenWaveInventoryEngine();
    engine.recordInbound('CALGARY', 'synguard-100', 'Synguard 100', 'TEST-IN-001', { xl: 100, l: 200, m: 300, s: 400 }, adminActor);
    engine.recordOutbound('CALGARY', 'synguard-100', 'Synguard 100', 'TEST-OUT-001', { xl: 20, l: 30, m: 40, s: 50 }, adminActor);

    // Unauthorized staff attempt should fail with 403
    assert.throws(
      () => engine.recordAdjustment('CALGARY', 'synguard-100', 'Synguard 100', { xl: 10, l: -5, m: 0, s: 0 }, 'Recount', staffActor),
      (err: any) => err.status === 403,
    );

    // Authorized manager adjustment
    const adjTx = engine.recordAdjustment(
      'CALGARY',
      'synguard-100',
      'Synguard 100',
      { xl: 10, l: -5, m: 0, s: 0 },
      'Physical recount verified against pallet tags',
      managerActor,
    );

    assert.equal(adjTx.total, 5);

    const bal = engine.getBalance('CALGARY', 'synguard-100');
    assert.equal(bal.xl, 90);
    assert.equal(bal.l, 165);
    assert.equal(bal.m, 260);
    assert.equal(bal.s, 350);
    assert.equal(bal.total, 865);
    assert.equal(bal.adjustment, 5);
  });

  it('Phase 6 — Multi-Warehouse Isolation: Calgary (1000), Ontario (2500), Maple Ridge (750)', () => {
    const engine = new GreenWaveInventoryEngine();

    engine.recordInbound('CALGARY', 'synguard-100', 'Synguard 100', 'CGY-01', { xl: 250, l: 250, m: 250, s: 250 }, adminActor);
    engine.recordInbound('ONTARIO', 'synguard-100', 'Synguard 100', 'ON-01', { xl: 500, l: 1000, m: 500, s: 500 }, adminActor);
    engine.recordInbound('MAPLE_RIDGE', 'synguard-100', 'Synguard 100', 'MR-01', { xl: 150, l: 200, m: 200, s: 200 }, adminActor);

    const cgyBal = engine.getBalance('CALGARY', 'synguard-100');
    const onBal = engine.getBalance('ONTARIO', 'synguard-100');
    const mrBal = engine.getBalance('MAPLE_RIDGE', 'synguard-100');

    assert.equal(cgyBal.total, 1000);
    assert.equal(onBal.total, 2500);
    assert.equal(mrBal.total, 750);

    // Queries scoped to Calgary must contain ONLY Calgary transactions
    const cgyTxs = engine.listTransactions({ warehouseId: 'CALGARY' });
    assert.equal(cgyTxs.length, 1);
    assert.equal(cgyTxs[0].orderNumber, 'CGY-01');
  });

  it('Phase 8 & 9 — Inventory Search, Filtering, and RFC 4180 CSV Export', () => {
    const engine = new GreenWaveInventoryEngine();
    engine.recordInbound(
      'CALGARY',
      'synguard-100',
      'Synguard 100',
      'ORDER-ALPHA-99',
      { xl: 50, l: 50, m: 50, s: 50 },
      adminActor,
      { containerNumber: 'MSMU6896930', sealNumber: '0336695', notes: 'Cross dock transfer' },
    );

    // Search by container
    const resContainer = engine.listTransactions({ warehouseId: 'CALGARY', search: 'MSMU6896930' });
    assert.equal(resContainer.length, 1);

    // Search by seal
    const resSeal = engine.listTransactions({ warehouseId: 'CALGARY', search: '0336695' });
    assert.equal(resSeal.length, 1);

    // Search by order
    const resOrder = engine.listTransactions({ warehouseId: 'CALGARY', search: 'ALPHA-99' });
    assert.equal(resOrder.length, 1);

    // CSV generation
    const csv = engine.generateBalancesCsv('CALGARY', 'Calgary, AB');
    assert.ok(csv.startsWith('Warehouse,Product ID,XL Balance,L Balance'));
    assert.ok(csv.includes('"Calgary, AB"'));
    assert.ok(csv.includes('"synguard-100"'));
    assert.ok(csv.includes('200')); // Total current stock
  });
});
