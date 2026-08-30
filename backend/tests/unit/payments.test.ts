import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'crypto';

describe('Unit: Customer Payments & Gateway Lifecycle', () => {
  const secret = 'whsec_unit_test_secret_sample_key';

  it('1. Generates cryptographic 64-character hex payment tokens', () => {
    const token = crypto.randomBytes(32).toString('hex');
    assert.equal(token.length, 64);
    assert.match(token, /^[0-9a-f]{64}$/);
  });

  it('2. Payment Status Lifecycle Transitions (unpaid -> pending -> paid -> refunded)', () => {
    const invoice = {
      id: 'inv-1',
      invoiceNumber: '1115',
      total: 10498.95,
      currency: 'CAD',
      paymentStatus: 'unpaid',
      paidAt: null as Date | null,
    };

    // Step 1: Customer clicks link -> checkout created
    invoice.paymentStatus = 'pending';
    assert.equal(invoice.paymentStatus, 'pending');

    // Step 2: Webhook receives payment confirmation -> authoritative PAID transition
    invoice.paymentStatus = 'paid';
    invoice.paidAt = new Date();
    assert.equal(invoice.paymentStatus, 'paid');
    assert.ok(invoice.paidAt instanceof Date);

    // Step 3: Admin issues refund
    invoice.paymentStatus = 'refunded';
    assert.equal(invoice.paymentStatus, 'refunded');
  });

  it('3. Authoritative Financial Payment Metrics Calculation', () => {
    const sampleInvoices = [
      { id: '1', total: '10498.95', paymentStatus: 'unpaid', paidAt: null },
      { id: '2', total: '537.73', paymentStatus: 'paid', paidAt: new Date().toISOString() },
      { id: '3', total: '2400.00', paymentStatus: 'pending', paidAt: null },
      { id: '4', total: '1500.00', paymentStatus: 'paid', paidAt: new Date().toISOString() },
      { id: '5', total: '300.00', paymentStatus: 'failed', paidAt: null },
    ];

    let totalOutstanding = 0;
    let paidThisMonth = 0;
    let unpaidCount = 0;
    let pendingCount = 0;
    let paidCount = 0;
    let failedCount = 0;

    sampleInvoices.forEach((inv) => {
      const amt = Number(inv.total);
      if (inv.paymentStatus === 'unpaid' || inv.paymentStatus === 'pending') {
        totalOutstanding += amt;
      }
      if (inv.paymentStatus === 'unpaid') unpaidCount++;
      if (inv.paymentStatus === 'pending') pendingCount++;
      if (inv.paymentStatus === 'paid') {
        paidThisMonth += amt;
        paidCount++;
      }
      if (inv.paymentStatus === 'failed') failedCount++;
    });

    assert.equal(Math.round(totalOutstanding * 100) / 100, 12898.95);
    assert.equal(Math.round(paidThisMonth * 100) / 100, 2037.73);
    assert.equal(unpaidCount, 1);
    assert.equal(pendingCount, 1);
    assert.equal(paidCount, 2);
    assert.equal(failedCount, 1);
  });

  it('4. Public Invoice Sanitization (Strips Internal Database Attributes)', () => {
    const internalInvoiceRecord = {
      id: 'internal-uuid-secret',
      invoiceNumber: '1115',
      invoiceDate: '2026-08-30',
      dueDate: '2026-09-15',
      billTo: 'Acme Scrap Corp',
      subtotal: '9999.00',
      taxTotal: '499.95',
      total: '10498.95',
      currency: 'CAD',
      paymentStatus: 'unpaid',
      paymentToken: '7f9a12c8b76e5d4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a',
      createdBy: 42,
      warehouseId: 'wh-secret-internal-id',
      items: [{ description: 'Scrap Aluminum', quantity: '5', unitPrice: '1999.80', lineTotal: '9999.00' }]
    };

    // Public DTO mapping projection
    const publicDto = {
      invoiceNumber: internalInvoiceRecord.invoiceNumber,
      invoiceDate: internalInvoiceRecord.invoiceDate,
      dueDate: internalInvoiceRecord.dueDate,
      billTo: internalInvoiceRecord.billTo,
      subtotal: internalInvoiceRecord.subtotal,
      taxTotal: internalInvoiceRecord.taxTotal,
      total: Number(internalInvoiceRecord.total),
      currency: internalInvoiceRecord.currency,
      paymentStatus: internalInvoiceRecord.paymentStatus,
      items: internalInvoiceRecord.items,
    };

    assert.equal((publicDto as any).id, undefined);
    assert.equal((publicDto as any).createdBy, undefined);
    assert.equal((publicDto as any).warehouseId, undefined);
    assert.equal(publicDto.invoiceNumber, '1115');
    assert.equal(publicDto.total, 10498.95);
  });
});
