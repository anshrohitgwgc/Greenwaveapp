/**
 * Exact fixed-point decimal arithmetic for money.
 *
 * `roundCurrency` in ./rounding.ts multiplies and rounds in IEEE-754 doubles.
 * That is fine for the small per-line figures invoices deal in, but a purchase
 * order multiplies a *weight* by a unit price -- e.g. 54 850 lbs x 0.40 -- and
 * `54850 * 0.4` evaluates to 21940.000000000004 in a double. One line rounds
 * back to the right cent; a hundred lines summed as doubles need not, and a PO
 * total that is a cent off a supplier's own arithmetic is a real dispute.
 *
 * So PO amounts are computed here instead: inputs are converted to BigInt at a
 * fixed scale, multiplied exactly, and rounded once, at the end, half-away-from
 * -zero. Nothing in this module goes through a float.
 *
 * The scales match the NUMERIC column definitions in migration 018:
 *   quantity   NUMERIC(14,3)
 *   unit_price NUMERIC(12,4)
 *   amount     NUMERIC(14,2)
 */

export const QUANTITY_SCALE = 3;
export const PRICE_SCALE = 4;
export const MONEY_SCALE = 2;

/** 10n ** BigInt(n), without pulling in an exponent operator on numbers. */
function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/**
 * Renders a JS number as the shortest decimal string that round-trips to it,
 * with exponent notation expanded.
 *
 * A value that reached us as JSON `0.40` is the double nearest 0.4; `String()`
 * gives back "0.4", which is what the user actually typed. Going through the
 * shortest representation is therefore the most faithful reading of the input,
 * not a lossy one.
 */
function toPlainDecimalString(value: number | string): string {
  if (typeof value === 'string') return value.trim();
  if (!Number.isFinite(value)) {
    throw new RangeError(`Not a finite number: ${String(value)}`);
  }

  const raw = String(value);
  const exponent = /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(raw);
  if (!exponent) return raw;

  const [, sign, intPart, fracPart = '', expPart] = exponent;
  const exp = Number(expPart);
  const digits = intPart + fracPart;
  const pointAt = intPart.length + exp;

  if (pointAt <= 0) return `${sign}0.${'0'.repeat(-pointAt)}${digits}`;
  if (pointAt >= digits.length) {
    return `${sign}${digits}${'0'.repeat(pointAt - digits.length)}`;
  }
  return `${sign}${digits.slice(0, pointAt)}.${digits.slice(pointAt)}`;
}

/**
 * Converts a decimal value to a BigInt scaled by 10^scale, rounding
 * half-away-from-zero if the input carries more decimal places than `scale`.
 *
 * Throws on anything that is not a decimal number, so a malformed value can
 * never be silently read as 0 and quietly zero out a line amount.
 */
export function toScaled(value: number | string, scale: number): bigint {
  const text = toPlainDecimalString(value);
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) {
    throw new RangeError(`Not a decimal number: ${text}`);
  }

  const [, sign, intPart, fracPart = ''] = match;
  const negative = sign === '-';

  const kept = fracPart.slice(0, scale).padEnd(scale, '0');
  let units = BigInt((intPart || '0') + kept);

  // Round half-away-from-zero on the first discarded digit.
  const dropped = fracPart.slice(scale);
  if (dropped.length > 0 && dropped.charCodeAt(0) >= '5'.charCodeAt(0)) {
    units += 1n;
  }

  return negative ? -units : units;
}

/** Renders a scaled BigInt back to a fixed-point decimal string. */
export function fromScaled(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units)
    .toString()
    .padStart(scale + 1, '0');
  const intPart = digits.slice(0, digits.length - scale);
  const fracPart = scale > 0 ? `.${digits.slice(digits.length - scale)}` : '';
  return `${negative ? '-' : ''}${intPart}${fracPart}`;
}

/** Divides exactly, rounding half-away-from-zero. */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  // +half then truncate == round half-up on a non-negative value.
  const rounded = (abs * 2n + denominator) / (denominator * 2n);
  return negative ? -rounded : rounded;
}

/**
 * quantity x unitPrice, exact, rounded once to cents.
 *
 * Returns the amount in cents as a BigInt so a caller summing many lines adds
 * integers rather than re-parsing decimal strings.
 */
export function lineAmountCents(
  quantity: number | string,
  unitPrice: number | string,
): bigint {
  const qty = toScaled(quantity, QUANTITY_SCALE);
  const price = toScaled(unitPrice, PRICE_SCALE);

  // Product carries QUANTITY_SCALE + PRICE_SCALE decimals; reduce to cents.
  const product = qty * price;
  const excessScale = QUANTITY_SCALE + PRICE_SCALE - MONEY_SCALE;
  return divideRounded(product, pow10(excessScale));
}

/** Cents -> a NUMERIC(_, 2)-compatible string, e.g. 2194000n -> "21940.00". */
export function centsToMoneyString(cents: bigint): string {
  return fromScaled(cents, MONEY_SCALE);
}

/** Sums exact cent amounts. Integer addition — no rounding error to accumulate. */
export function sumCents(amounts: readonly bigint[]): bigint {
  return amounts.reduce((acc, n) => acc + n, 0n);
}
