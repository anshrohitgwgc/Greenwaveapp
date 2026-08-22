import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

function calculatePickupPrice(weightKg: number, wasteType: string): number {
  if (weightKg <= 0) return 0;
  const baseRates: Record<string, number> = {
    electronics: 1.50,
    'commercial-plastics': 0.85,
    metals: 0.60,
    organic: 0.40,
  };
  const rate = baseRates[wasteType] || 1.00;
  const subtotal = weightKg * rate;
  const dispatchFee = 25.00;
  return Math.round((subtotal + dispatchFee) * 100) / 100;
}

describe('Unit: Pricing Engine', () => {
  it('1. Calculates correct price with base rate and dispatch fee', () => {
    const price = calculatePickupPrice(100, 'electronics');
    // 100 * 1.50 + 25.00 = 175.00
    assert.equal(price, 175.00);
  });

  it('2. Handles zero or negative weight gracefully', () => {
    assert.equal(calculatePickupPrice(0, 'metals'), 0);
    assert.equal(calculatePickupPrice(-10, 'metals'), 0);
  });
});
