/**
 * Business rounding rules, configurable via env rather than hardcoded in
 * a single component. Defaults match the precision already in production
 * invoices/inventory (e.g. "3.658 t").
 */
export function roundQuantity(
  value: number,
  decimals = Number(process.env.INVENTORY_ROUNDING_DECIMALS ?? 3),
): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function roundCurrency(
  value: number,
  decimals = Number(process.env.CURRENCY_ROUNDING_DECIMALS ?? 2),
): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
