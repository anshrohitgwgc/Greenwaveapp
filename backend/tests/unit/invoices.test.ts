import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

interface InvoiceLine {
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  isRebate: boolean;
}

const TAX_RATES: Record<string, number> = {
  AB: 0.05,
  BC: 0.05,
  SK: 0.05,
  MB: 0.05,
  ON: 0.13,
  QC: 0.05,
  NS: 0.15,
  NB: 0.15,
  NL: 0.15,
  PE: 0.15,
};

function calculateLineAmount(line: InvoiceLine): number {
  const gross = Math.round(((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0) - (Number(line.discount) || 0)) * 100) / 100;
  return line.isRebate ? -gross : gross;
}

function calculateInvoiceTotals(items: InvoiceLine[], taxRatePct: number) {
  let subtotal = 0;
  for (const item of items) {
    subtotal = Math.round((subtotal + calculateLineAmount(item)) * 100) / 100;
  }
  const tax = Math.round(subtotal * (taxRatePct / 100) * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;
  return { subtotal, tax, total, taxRatePct };
}

describe('Unit: Invoice Creator & Greenwave Ops.pdf Verification', () => {
  it('1. Exact Match to Reference PDF: sgfs line item, 5% GST, and $10,498.95 Grand Total', () => {
    const lines: InvoiceLine[] = [
      {
        description: 'sgfs',
        unit: '10',
        quantity: 1,
        unitPrice: 10000,
        discount: 1.00,
        isRebate: false,
      },
    ];

    const result = calculateInvoiceTotals(lines, 5.0);

    // Line amount: 1 * 10000 - 1.00 = 9999.00
    assert.equal(calculateLineAmount(lines[0]), 9999.00);
    // Subtotal: 9999.00
    assert.equal(result.subtotal, 9999.00);
    // GST @ 5%: 499.95
    assert.equal(result.tax, 499.95);
    // Total: 10,498.95
    assert.equal(result.total, 10498.95);
  });

  it('2. Multi-line invoice with Commodity Rebate deductions and 13% Ontario HST', () => {
    const lines: InvoiceLine[] = [
      {
        description: 'Healthcare PPE Cases Delivered',
        unit: 'cases',
        quantity: 200,
        unitPrice: 30.00,
        discount: 0,
        isRebate: false,
      },
      {
        description: 'Pallet Deposit Rebate Deduction',
        unit: 'ea',
        quantity: 20,
        unitPrice: 15.00,
        discount: 0,
        isRebate: true,
      },
    ];

    // Line 1: +6000.00
    // Line 2 (Rebate): -300.00
    // Subtotal: 5700.00
    // Ontario Tax (13% HST): 741.00
    // Grand Total: 6441.00
    const result = calculateInvoiceTotals(lines, 13.0);
    assert.equal(result.subtotal, 5700.00);
    assert.equal(result.tax, 741.00);
    assert.equal(result.total, 6441.00);
  });

  it('3. Free-text invoice lines with zero discount and fractional rates', () => {
    const lines: InvoiceLine[] = [
      {
        description: 'Cardboard Commodity Intake',
        unit: 'kg',
        quantity: 1250.5,
        unitPrice: 0.15,
        discount: 0,
        isRebate: false,
      },
    ];

    // Line: 1250.5 * 0.15 = 187.58
    const lineAmt = calculateLineAmount(lines[0]);
    assert.equal(lineAmt, 187.58);

    const result = calculateInvoiceTotals(lines, 5.0);
    assert.equal(result.subtotal, 187.58);
    assert.equal(result.tax, 9.38);
    assert.equal(result.total, 196.96);
  });
});
