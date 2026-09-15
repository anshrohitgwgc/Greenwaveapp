import { computeTotals } from './invoices.service';

describe('invoice totals', () => {
  it('computes quantity * unit price for a simple line', () => {
    const result = computeTotals(
      'inv-1',
      [
        {
          description: 'Mixed load',
          quantity: 3.658,
          unit: 't',
          unitPrice: 140,
        },
      ],
      5,
    );

    // 3.658 t x $140.00 = $512.12, GST 5% = $25.61, total $537.73 — matches
    // the worked example in Greenwaveapp's own README for invoice #1114.
    expect(result.subtotal).toBeCloseTo(512.12, 2);
    expect(result.taxTotal).toBeCloseTo(25.61, 2);
    expect(result.total).toBeCloseTo(537.73, 2);
  });

  it('subtracts discount from a line before totalling', () => {
    const result = computeTotals(
      'inv-2',
      [{ description: 'Item', quantity: 10, unitPrice: 10, discount: 5 }],
      0,
    );

    expect(result.subtotal).toBeCloseTo(95, 2); // 10*10 - 5
    expect(result.discountTotal).toBeCloseTo(5, 2);
  });

  it('subtracts rebate lines instead of adding them, and can go negative', () => {
    const result = computeTotals(
      'inv-3',
      [
        { description: 'Charge', quantity: 1, unitPrice: 100 },
        {
          description: 'Rebate to customer',
          quantity: 1,
          unitPrice: 150,
          isRebate: true,
        },
      ],
      0,
    );

    expect(result.subtotal).toBeCloseTo(-50, 2);
    expect(result.total).toBeCloseTo(-50, 2);
  });

  it('applies the tax rate to the subtotal', () => {
    const result = computeTotals(
      'inv-4',
      [{ description: 'Item', quantity: 1, unitPrice: 200 }],
      13,
    ); // HST Ontario

    expect(result.taxTotal).toBeCloseTo(26, 2);
    expect(result.total).toBeCloseTo(226, 2);
  });

  it('produces one InvoiceItem per input line, in order', () => {
    const result = computeTotals(
      'inv-5',
      [
        { description: 'First', quantity: 1, unitPrice: 1 },
        { description: 'Second', quantity: 2, unitPrice: 2 },
      ],
      0,
    );

    expect(result.items).toHaveLength(2);
    expect(result.items[0].sortOrder).toBe(0);
    expect(result.items[1].sortOrder).toBe(1);
    expect(result.items[0].invoiceId).toBe('inv-5');
  });
});
