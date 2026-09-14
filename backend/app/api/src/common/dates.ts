/**
 * Business-calendar dates. Ledger entry dates and report periods are calendar
 * days in the company's timezone, not UTC — a payment at 8pm Mountain on the
 * 31st belongs to that month.
 */
const DEFAULT_TZ = 'America/Edmonton';

export function businessTimeZone(): string {
  return process.env.BUSINESS_TIMEZONE?.trim() || DEFAULT_TZ;
}

/** Date -> "YYYY-MM-DD" in the business timezone. */
export function toBusinessDate(value: Date | string | number, timeZone = businessTimeZone()): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new RangeError('Invalid date');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Strict "YYYY-MM-DD" validation, including real calendar days. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Adds whole days to a "YYYY-MM-DD" string. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both "YYYY-MM-DD"). */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The UTC instant at which a business-calendar day begins (DST-aware). */
export function businessDayStartUtc(isoDate: string, timeZone = businessTimeZone()): Date {
  if (!isIsoDate(isoDate)) throw new RangeError('Invalid date');
  const [y, m, d] = isoDate.split('-').map(Number);
  const midnightAsUtc = Date.UTC(y, m - 1, d);
  let guess = midnightAsUtc;
  for (let i = 0; i < 3; i++) {
    const next = midnightAsUtc - timeZoneOffsetMs(new Date(guess), timeZone);
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}
