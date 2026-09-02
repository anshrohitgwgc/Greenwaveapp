import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { provideDivisionsService } from '../../test/fixtures/divisions-test.helper';
import { DivisionsService } from './divisions.service';

const actor = (id: number, divisions?: string[]): AuthenticatedUser => ({
  id,
  email: `user${id}@greenwave.test`,
  role: 'staff',
  fullName: `User ${id}`,
  ...(divisions ? { divisions } : {}),
});

describe('DivisionsService', () => {
  let service: DivisionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: provideDivisionsService({
        1: ['greenwave'],
        2: ['healthcare'],
        3: ['greenwave', 'healthcare'],
        // user 4 deliberately has no grants
      }).providers,
    }).compile();

    service = module.get(DivisionsService);
  });

  describe('getUserDivisions — grants come only from explicit rows', () => {
    it('returns the single granted division', async () => {
      await expect(service.getUserDivisions(1)).resolves.toEqual(['greenwave']);
      await expect(service.getUserDivisions(2)).resolves.toEqual([
        'healthcare',
      ]);
    });

    it('returns both when both are granted', async () => {
      await expect(service.getUserDivisions(3)).resolves.toEqual([
        'greenwave',
        'healthcare',
      ]);
    });

    it('returns NOTHING for a user with no grants (no implicit recycling)', async () => {
      await expect(service.getUserDivisions(4)).resolves.toEqual([]);
    });
  });

  describe('assertDivisionAccess', () => {
    it('allows a division the actor holds', async () => {
      await expect(
        service.assertDivisionAccess(actor(1, ['greenwave']), 'greenwave'),
      ).resolves.toBe('greenwave');
    });

    it('accepts the legacy `recycling` alias for a greenwave holder', async () => {
      await expect(
        service.assertDivisionAccess(actor(1, ['greenwave']), 'recycling'),
      ).resolves.toBe('greenwave');
    });

    it('denies a GreenWave-only actor asking for healthcare (403)', async () => {
      await expect(
        service.assertDivisionAccess(actor(1, ['greenwave']), 'healthcare'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('denies a Healthcare-only actor asking for greenwave (403)', async () => {
      await expect(
        service.assertDivisionAccess(actor(2, ['healthcare']), 'greenwave'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.assertDivisionAccess(actor(2, ['healthcare']), 'recycling'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects an invented division with 400, not a silent allow', async () => {
      await expect(
        service.assertDivisionAccess(
          actor(3, ['greenwave', 'healthcare']),
          'finance',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('falls back to the database when the actor carries no resolved divisions', async () => {
      // No `divisions` on the actor object at all — must be read from
      // user_divisions rather than treated as unrestricted.
      await expect(
        service.assertDivisionAccess(actor(1), 'healthcare'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.assertDivisionAccess(actor(1), 'greenwave'),
      ).resolves.toBe('greenwave');
    });
  });

  describe('assertStoredDivisionAccess — fails closed', () => {
    it('treats a missing stored division as GreenWave, not as unscoped', async () => {
      await expect(
        service.assertStoredDivisionAccess(actor(1, ['greenwave']), null),
      ).resolves.toBe('greenwave');

      // A healthcare-only user must NOT be able to read a row whose division
      // column is empty — that row belongs to the column's default division.
      await expect(
        service.assertStoredDivisionAccess(actor(2, ['healthcare']), null),
      ).rejects.toThrow(ForbiddenException);
    });

    it('treats an unrecognised stored division as GreenWave, not as unscoped', async () => {
      await expect(
        service.assertStoredDivisionAccess(actor(2, ['healthcare']), 'legacy'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('scopeDivisions / scopeDivisionStorageValues', () => {
    it('defaults to every division the actor holds when none is requested', async () => {
      await expect(
        service.scopeDivisions(actor(3, ['greenwave', 'healthcare'])),
      ).resolves.toEqual(['greenwave', 'healthcare']);
    });

    it('narrows to the requested division after checking access', async () => {
      await expect(
        service.scopeDivisions(
          actor(3, ['greenwave', 'healthcare']),
          'healthcare',
        ),
      ).resolves.toEqual(['healthcare']);
    });

    it('resolves to an empty scope for an actor with no divisions', async () => {
      await expect(service.scopeDivisions(actor(4, []))).resolves.toEqual([]);
      await expect(
        service.scopeDivisionStorageValues(actor(4, [])),
      ).resolves.toEqual([]);
    });

    it('expands greenwave to its legacy storage synonym for SQL matching', async () => {
      await expect(
        service.scopeDivisionStorageValues(actor(1, ['greenwave'])),
      ).resolves.toEqual(['recycling', 'greenwave']);
    });
  });

  describe('assignUserDivisions', () => {
    it('replaces the grant set', async () => {
      await expect(
        service.assignUserDivisions(1, ['healthcare'], 99),
      ).resolves.toEqual(['healthcare']);
      await expect(service.getUserDivisions(1)).resolves.toEqual([
        'healthcare',
      ]);
    });

    it('revokes everything when given an empty list', async () => {
      await expect(service.assignUserDivisions(3, [], 99)).resolves.toEqual([]);
      await expect(service.getUserDivisions(3)).resolves.toEqual([]);
    });

    it('refuses to grant a division the assigning admin does not hold (403)', async () => {
      await expect(
        service.assignUserDivisions(4, ['healthcare'], 1, ['greenwave']),
      ).rejects.toThrow(ForbiddenException);

      // and nothing was written
      await expect(service.getUserDivisions(4)).resolves.toEqual([]);
    });

    it('allows an admin to grant a division they do hold', async () => {
      await expect(
        service.assignUserDivisions(4, ['greenwave'], 1, ['greenwave']),
      ).resolves.toEqual(['greenwave']);
    });

    it('rejects an invented division with 400 before touching the table', async () => {
      await expect(
        service.assignUserDivisions(4, ['ops'], 1, ['greenwave', 'healthcare']),
      ).rejects.toThrow(BadRequestException);
      await expect(service.getUserDivisions(4)).resolves.toEqual([]);
    });

    it('de-duplicates and orders the stored grants deterministically', async () => {
      await expect(
        service.assignUserDivisions(
          4,
          ['healthcare', 'greenwave', 'healthcare'],
          1,
        ),
      ).resolves.toEqual(['greenwave', 'healthcare']);
    });
  });

  describe('listDivisions / getDivisionsForActor', () => {
    it('lists the full catalogue with display labels', () => {
      expect(service.listDivisions()).toEqual([
        { key: 'greenwave', label: 'GreenWave Recycling' },
        { key: 'healthcare', label: 'Healthcare' },
      ]);
    });

    it('returns only what the actor holds, so the UI cannot offer more', async () => {
      await expect(
        service.getDivisionsForActor(actor(1, ['greenwave'])),
      ).resolves.toEqual([{ key: 'greenwave', label: 'GreenWave Recycling' }]);
      await expect(service.getDivisionsForActor(actor(4, []))).resolves.toEqual(
        [],
      );
    });
  });
});
