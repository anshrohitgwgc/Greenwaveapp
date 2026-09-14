import { fromScaled, toScaled } from './decimal';

/**
 * Money as integer minor units.
 *
 * Every new financial table stores BIGINT minor units (cents for CAD/USD).
 * Legacy invoice columns remain NUMERIC(12,2); conversion happens here, at the
 * boundary, through the exact BigInt arithmetic in ./decimal — never through a
 * float multiply.
 */

export const SUPPORTED_CURRENCIES = ['CAD', 'USD'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

const MINOR_UNIT_EXPONENT: Record<SupportedCurrency, number> = {
  CAD: 2,
  USD: 2,
};

export function normalizeCurrency(value: string | null | undefined): SupportedCurrency {
  const upper = String(value ?? '').trim().toUpperCase();
  if ((SUPPORTED_CURRENCIES as readonly string[]).includes(upper)) {
    return upper as SupportedCurrency;
  }
  throw new RangeError(`Unsupported currency: ${upper || '(empty)'}`);
}

export function isSupportedCurrency(value: string | null | undefined): boolean {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(String(value ?? '').trim().toUpperCase());
}

export function currencyExponent(currency: string): number {
  return MINOR_UNIT_EXPONENT[normalizeCurrency(currency)];
}

/** "4850.00" (CAD) -> 485000. Rejects values that are not exact safe integers. */
export function decimalToMinor(value: string | number, currency: string): number {
  const scaled = toScaled(value, currencyExponent(currency));
  const n = Number(scaled);
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`Amount out of range: ${String(value)}`);
  }
  return n;
}

/** 485000 (CAD) -> "4850.00". */
export function minorToDecimalString(minor: number, currency: string): string {
  if (!Number.isSafeInteger(minor)) {
    throw new RangeError(`Minor amount must be a safe integer: ${minor}`);
  }
  return fromScaled(BigInt(minor), currencyExponent(currency));
}

/** Human display, e.g. "CAD 4,850.00". Formatting only; never parse this back. */
export function formatMinor(minor: number, currency: string): string {
  const text = minorToDecimalString(Math.abs(minor), currency);
  const [intPart, frac] = text.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${minor < 0 ? '-' : ''}${normalizeCurrency(currency)} ${grouped}${frac ? `.${frac}` : ''}`;
}
