import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

interface Tx {
  warehouseId: string;
  materialId: string;
  type: 'inbound' | 'outbound' | 'adjustment';
  xl: number;
  l: number;
  m: number;
  s: number;
  total: number;
}

function calculateTotal(xl: number, l: number, m: number, s: number): number {
  return Math.round((Number(xl || 0) + Number(l || 0) + Number(m || 0) + Number(s || 0)) * 1000) / 1000;
}

function calculateBalances(transactions: Tx[], warehouseId?: string, materialId?: string) {
  const filtered = transactions.filter(
    (t) => (!warehouseId || t.warehouseId === warehouseId) && (!materialId || t.materialId === materialId),
  );

  let xl = 0;
  let l = 0;
  let m = 0;
  let s = 0;
  let total = 0;
  let inbound = 0;
  let outbound = 0;
  let adjustment = 0;

  for (const t of filtered) {
    if (t.type === 'inbound') {
      xl += t.xl;
      l += t.l;
      m += t.m;
      s += t.s;
      total += t.total;
      inbound += t.total;
    } else if (t.type === 'outbound') {
      xl -= t.xl;
      l -= t.l;
      m -= t.m;
      s -= t.s;
      total -= t.total;
      outbound += t.total;
    } else if (t.type === 'adjustment') {
      xl += t.xl;
      l += t.l;
      m += t.m;
      s += t.s;
      total += t.total;
      adjustment += t.total;
    }
  }

  return {
    xl: Math.round(xl * 1000) / 1000,
    l: Math.round(l * 1000) / 1000,
    m: Math.round(m * 1000) / 1000,
    s: Math.round(s * 1000) / 1000,
    total: Math.round(total * 1000) / 1000,
    inbound: Math.round(inbound * 1000) / 1000,
    outbound: Math.round(outbound * 1000) / 1000,
    adjustment: Math.round(adjustment * 1000) / 1000,
  };
}

describe('Unit: Inventory Engine & Excel Formula Workflow', () => {
  it('1. Automatically calculates TOTAL = XL + L + M + S without manual user formula', () => {
    const total = calculateTotal(100, 200, 300, 400);
    assert.equal(total, 1000);

    const totalFromExcelSample = calculateTotal(0, 0, 3581, 0);
    assert.equal(totalFromExcelSample, 3581);

    const complexTotal = calculateTotal(1417, 1400, 780, 0);
    assert.equal(complexTotal, 3597);
  });

  it('2. Correctly updates stock balances from Inbound + Outbound + Adjustment transactions', () => {
    const ledger: Tx[] = [
      // Receive 3581 M Synguard 100
      {
        warehouseId: 'CGY',
        materialId: 'synguard-100',
        type: 'inbound',
        xl: 0,
        l: 0,
        m: 3581,
        s: 0,
        total: 3581,
      },
      // Ship 500 M Synguard 100
      {
        warehouseId: 'CGY',
        materialId: 'synguard-100',
        type: 'outbound',
        xl: 0,
        l: 0,
        m: 500,
        s: 0,
        total: 500,
      },
      // Adjust +5 M Synguard 100
      {
        warehouseId: 'CGY',
        materialId: 'synguard-100',
        type: 'adjustment',
        xl: 0,
        l: 0,
        m: 5,
        s: 0,
        total: 5,
      },
    ];

    const balance = calculateBalances(ledger, 'CGY', 'synguard-100');
    assert.equal(balance.m, 3086);
    assert.equal(balance.total, 3086);
    assert.equal(balance.inbound, 3581);
    assert.equal(balance.outbound, 500);
    assert.equal(balance.adjustment, 5);
  });

  it('3. Guarantees Multi-Warehouse Isolation (Calgary transactions NEVER alter Ontario or BC stock)', () => {
    const ledger: Tx[] = [
      {
        warehouseId: 'CGY',
        materialId: 'synguard-100',
        type: 'inbound',
        xl: 100,
        l: 200,
        m: 300,
        s: 400,
        total: 1000,
      },
      {
        warehouseId: 'ON',
        materialId: 'synguard-100',
        type: 'inbound',
        xl: 50,
        l: 50,
        m: 50,
        s: 50,
        total: 200,
      },
    ];

    // Outbound in Calgary
    ledger.push({
      warehouseId: 'CGY',
      materialId: 'synguard-100',
      type: 'outbound',
      xl: 100,
      l: 50,
      m: 0,
      s: 0,
      total: 150,
    });

    const cgyBal = calculateBalances(ledger, 'CGY', 'synguard-100');
    const onBal = calculateBalances(ledger, 'ON', 'synguard-100');
    const mrBal = calculateBalances(ledger, 'MR', 'synguard-100');

    // Calgary stock reduced
    assert.equal(cgyBal.xl, 0);
    assert.equal(cgyBal.l, 150);
    assert.equal(cgyBal.total, 850);

    // Ontario stock completely unchanged
    assert.equal(onBal.xl, 50);
    assert.equal(onBal.l, 50);
    assert.equal(onBal.total, 200);

    // Maple Ridge is zero
    assert.equal(mrBal.total, 0);
  });
});
