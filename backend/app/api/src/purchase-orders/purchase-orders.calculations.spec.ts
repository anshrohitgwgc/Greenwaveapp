import {
  centsToMoneyString,
  fromScaled,
  lineAmountCents,
  sumCents,
  toScaled,
} from '../common/decimal';
import { roundCurrency } from '../common/rounding';
import {
  computePurchaseOrderTotals,
  formatPurchaseOrderNumber,
} from './purchase-orders.service';

describe('exact decimal helpers', () => {
  it('scales a plain decimal without going through a float', () => {
    expect(toScaled('0.40', 4)).toBe(4000n);
    expect(toScaled(0.4, 4)).toBe(4000n);
    expect(toScaled('54850', 3)).toBe(54850000n);
    expect(toScaled(-12.345, 3)).toBe(-12345n);
  });

  it('rounds half-away-from-zero when the input is finer than the scale', () => {
    expect(toScaled('0.00005', 4)).toBe(1n);
    expect(toScaled('0.00004', 4)).toBe(0n);
    expect(toScaled('-0.00005', 4)).toBe(-1n);
  });

  it('expands exponent notation rather than mis-parsing it', () => {
    expect(toScaled(1e-4, 4)).toBe(1n);
    expect(toScaled(1.5e3, 2)).toBe(150000n);
  });

  it('rejects a non-numeric value instead of silently reading it as zero', () => {
    expect(() => toScaled('twelve', 2)).toThrow(RangeError);
    expect(() => toScaled('', 2)).toThrow(RangeError);
    expect(() => toScaled(Number.NaN, 2)).toThrow(RangeError);
  });

  it('renders a scaled value back as a fixed-point string', () => {
    expect(fromScaled(2194000n, 2)).toBe('21940.00');
    expect(fromScaled(5n, 2)).toBe('0.05');
    expect(fromScaled(-5n, 2)).toBe('-0.05');
  });

  /**
   * The reason this module exists. `roundCurrency` multiplies in doubles, and
   * a product whose exact value ends in a half-cent can land just *below* it
   * once represented as a double -- 10 x 1.0005 is 10.004999999999999, not
   * 10.005 -- so the half-up rounding silently goes the wrong way and the
   * supplier is billed a cent less than the arithmetic on their own paperwork.
   * Computed exactly, the same line rounds up as it should.
   */
  it.each([
    [10, 1.0005, '10.01'],
    [30, 0.0725, '2.18'],
    [54, 2.6675, '144.05'],
  ])(
    'rounds %s x %s to %s, where a double-based multiply rounds down',
    (quantity, unitPrice, expected) => {
      expect(roundCurrency(quantity * unitPrice).toFixed(2)).not.toBe(expected);
      expect(centsToMoneyString(lineAmountCents(quantity, unitPrice))).toBe(
        expected,
      );
    },
  );

  it('computes the reference line 54 850 lbs x 0.40 as 21940.00', () => {
    expect(centsToMoneyString(lineAmountCents(54850, 0.4))).toBe('21940.00');
  });

  it('does not accumulate rounding error across many lines', () => {
    // 0.1 + 0.2 !== 0.3 in doubles; summed as cents it is exact.
    const cents = [0.1, 0.2, 0.3, 0.7, 0.9].map((p) => lineAmountCents(1, p));
    expect(centsToMoneyString(sumCents(cents))).toBe('2.20');
  });
});

describe('purchase order line amounts and total', () => {
  const PO_ID = '00000000-0000-4000-8000-000000000000';

  it('computes amount = quantity x unit price per line', () => {
    const totals = computePurchaseOrderTotals(PO_ID, [
      {
        code: 'UTL',
        resin: 'HDPE',
        description: 'PE100 REPRO',
        color: 'Noir',
        quantity: 54850,
        unit: 'lbs',
        unitPrice: 0.4,
      },
    ]);

    expect(totals.items).toHaveLength(1);
    expect(totals.items[0].amount).toBe('21940.00');
    expect(totals.total).toBe('21940.00');
  });

  it('totals many lines exactly', () => {
    const totals = computePurchaseOrderTotals(PO_ID, [
      { description: 'A', quantity: 54850, unitPrice: 0.4 },
      { description: 'B', quantity: 1000.5, unitPrice: 1.2345 },
      { description: 'C', quantity: 3, unitPrice: 0.005 },
    ]);

    expect(totals.items.map((i) => i.amount)).toEqual([
      '21940.00',
      '1235.12', // 1000.5 x 1.2345 = 1235.11725 -> 1235.12
      '0.02', //   3 x 0.005      =       0.015 -> 0.02 (half away from zero)
    ]);
    expect(totals.total).toBe('23175.14');
  });

  it('stamps sort order so the document renders in the submitted sequence', () => {
    const totals = computePurchaseOrderTotals(PO_ID, [
      { description: 'first', quantity: 1, unitPrice: 1 },
      { description: 'second', quantity: 1, unitPrice: 1 },
      { description: 'third', quantity: 1, unitPrice: 1 },
    ]);

    expect(totals.items.map((i) => i.sortOrder)).toEqual([0, 1, 2]);
    expect(totals.items.map((i) => i.description)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('gives every line its own id and links it to the purchase order', () => {
    const totals = computePurchaseOrderTotals(PO_ID, [
      { description: 'A', quantity: 1, unitPrice: 1 },
      { description: 'B', quantity: 1, unitPrice: 1 },
    ]);

    expect(totals.items[0].id).not.toBe(totals.items[1].id);
    for (const item of totals.items) {
      expect(item.purchaseOrderId).toBe(PO_ID);
    }
  });

  it('handles an order with a zero unit price without breaking the total', () => {
    const totals = computePurchaseOrderTotals(PO_ID, [
      { description: 'Free sample', quantity: 25, unitPrice: 0 },
      { description: 'Billed', quantity: 10, unitPrice: 2.5 },
    ]);

    expect(totals.items[0].amount).toBe('0.00');
    expect(totals.total).toBe('25.00');
  });
});

describe('purchase order number formatting', () => {
  it('renders the first number as PO-0001', () => {
    expect(formatPurchaseOrderNumber(1)).toBe('PO-0001');
  });

  it('zero-pads to four digits', () => {
    expect(formatPurchaseOrderNumber(2)).toBe('PO-0002');
    expect(formatPurchaseOrderNumber(42)).toBe('PO-0042');
    expect(formatPurchaseOrderNumber(388)).toBe('PO-0388');
    expect(formatPurchaseOrderNumber(9999)).toBe('PO-9999');
  });

  it('widens rather than truncating past four digits', () => {
    expect(formatPurchaseOrderNumber(10000)).toBe('PO-10000');
    expect(formatPurchaseOrderNumber('123456')).toBe('PO-123456');
  });

  it('accepts the string a bigint column reads back as', () => {
    expect(formatPurchaseOrderNumber('7')).toBe('PO-0007');
  });
});
