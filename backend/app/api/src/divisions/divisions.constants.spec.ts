import {
  ALL_DIVISIONS,
  DIVISION_GREENWAVE,
  DIVISION_HEALTHCARE,
  DIVISION_STORAGE_WRITE_VALUE,
  divisionLabel,
  divisionStorageValues,
  isDivision,
  normalizeDivision,
} from './divisions.constants';

describe('division vocabulary', () => {
  describe('normalizeDivision', () => {
    it('canonicalises the legacy `recycling` storage value to `greenwave`', () => {
      expect(normalizeDivision('recycling')).toBe(DIVISION_GREENWAVE);
    });

    it('accepts the canonical key itself', () => {
      expect(normalizeDivision('greenwave')).toBe(DIVISION_GREENWAVE);
      expect(normalizeDivision('healthcare')).toBe(DIVISION_HEALTHCARE);
    });

    it('is case- and whitespace-insensitive', () => {
      expect(normalizeDivision('  HealthCare ')).toBe(DIVISION_HEALTHCARE);
      expect(normalizeDivision('GreenWave Recycling')).toBe(DIVISION_GREENWAVE);
    });

    it('returns null for anything that is not a division — never a default', () => {
      for (const bogus of [
        'admin',
        'green',
        '',
        '   ',
        'healthcare2',
        'GREENWAVE;DROP TABLE users',
        null,
        undefined,
        42,
        {},
        [],
      ]) {
        expect(normalizeDivision(bogus)).toBeNull();
      }
    });

    it('does not silently coerce an unknown value to recycling', () => {
      // The whole point of the feature: a typo must be rejected, not treated
      // as "the default business unit".
      expect(normalizeDivision('recyceling')).not.toBe(DIVISION_GREENWAVE);
      expect(normalizeDivision('recyceling')).toBeNull();
    });
  });

  describe('divisionStorageValues', () => {
    it('expands greenwave to every value the column may already hold', () => {
      expect(divisionStorageValues([DIVISION_GREENWAVE]).sort()).toEqual(
        ['greenwave', 'recycling'].sort(),
      );
    });

    it('never lets healthcare match a recycling row', () => {
      expect(divisionStorageValues([DIVISION_HEALTHCARE])).toEqual([
        'healthcare',
      ]);
      expect(divisionStorageValues([DIVISION_HEALTHCARE])).not.toContain(
        'recycling',
      );
    });

    it('returns an empty list for no divisions, so callers scope to nothing', () => {
      expect(divisionStorageValues([])).toEqual([]);
    });
  });

  it('writes greenwave rows as `recycling` to stay compatible with the column default', () => {
    expect(DIVISION_STORAGE_WRITE_VALUE[DIVISION_GREENWAVE]).toBe('recycling');
    expect(DIVISION_STORAGE_WRITE_VALUE[DIVISION_HEALTHCARE]).toBe(
      'healthcare',
    );
  });

  it('exposes exactly the two supported divisions', () => {
    expect([...ALL_DIVISIONS]).toEqual(['greenwave', 'healthcare']);
  });

  it('labels divisions for display without inventing one for junk', () => {
    expect(divisionLabel('recycling')).toBe('GreenWave Recycling');
    expect(divisionLabel('healthcare')).toBe('Healthcare');
    expect(divisionLabel('nonsense')).toBe('Unassigned');
  });

  it('isDivision agrees with normalizeDivision', () => {
    expect(isDivision('recycling')).toBe(true);
    expect(isDivision('nope')).toBe(false);
  });
});
