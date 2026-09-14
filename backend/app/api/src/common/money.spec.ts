import { addDays, businessDayStartUtc, daysBetween, isIsoDate, toBusinessDate } from './dates';
import { decimalToMinor, formatMinor, minorToDecimalString, normalizeCurrency } from './money';

describe('money (integer minor units)', () => {
  it('converts decimal strings exactly, without float error', () => {
    expect(decimalToMinor('4850.00', 'CAD')).toBe(485000);
    expect(decimalToMinor('0.1', 'CAD') + decimalToMinor('0.2', 'CAD')).toBe(30);
    expect(decimalToMinor(21940.000000000004, 'CAD')).toBe(2194000);
    expect(decimalToMinor('19.995', 'USD')).toBe(2000);
  });

  it('round-trips and formats', () => {
    expect(minorToDecimalString(485000, 'CAD')).toBe('4850.00');
    expect(minorToDecimalString(5, 'CAD')).toBe('0.05');
    expect(formatMinor(485000, 'cad')).toBe('CAD 4,850.00');
    expect(formatMinor(-1234567, 'USD')).toBe('-USD 12,345.67');
  });

  it('rejects unsupported currencies and malformed amounts', () => {
    expect(() => normalizeCurrency('EUR')).toThrow(RangeError);
    expect(() => decimalToMinor('12,00', 'CAD')).toThrow(RangeError);
    expect(() => decimalToMinor('abc', 'CAD')).toThrow(RangeError);
    expect(() => minorToDecimalString(1.5, 'CAD')).toThrow(RangeError);
  });
});

describe('business dates', () => {
  it('uses the business timezone, not UTC', () => {
    // 2026-09-01 03:00 UTC is still Aug 31 in Edmonton (UTC-6 in summer).
    expect(toBusinessDate(new Date('2026-09-01T03:00:00Z'), 'America/Edmonton')).toBe('2026-08-31');
    expect(businessDayStartUtc('2026-09-01', 'America/Edmonton').toISOString()).toBe('2026-09-01T06:00:00.000Z');
    expect(businessDayStartUtc('2026-01-15', 'America/Edmonton').toISOString()).toBe('2026-01-15T07:00:00.000Z');
  });

  it('validates and does calendar arithmetic', () => {
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-01-01', '2026-03-01')).toBe(59);
  });
});
