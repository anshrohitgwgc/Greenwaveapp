import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import { GlobalFinanceAccessGuard } from './global-finance-access.guard';
import {
  RecyclingFinanceGuard,
  assertGreenWaveRecyclingFinanceAccess,
} from './recycling-finance.guard';

describe('GreenWave Recycling Finance Division Isolation', () => {
  let recyclingGuard: RecyclingFinanceGuard;
  let globalFinanceGuard: GlobalFinanceAccessGuard;

  beforeEach(() => {
    recyclingGuard = new RecyclingFinanceGuard();
    globalFinanceGuard = new GlobalFinanceAccessGuard();
  });

  function createMockContext(user?: Partial<AuthenticatedUser>, reqOverrides?: Partial<Request>): ExecutionContext {
    const req: Partial<Request> = {
      user: user as AuthenticatedUser,
      headers: {},
      query: {},
      body: {},
      ...reqOverrides,
    };
    return {
      switchToHttp: () => ({
        getRequest: () => req as Request,
        getResponse: () => ({}),
        getNext: () => ({}),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  describe('assertGreenWaveRecyclingFinanceAccess (authoritative policy)', () => {
    it('allows GreenWave Recycling admin', () => {
      const actor: AuthenticatedUser = {
        id: 1,
        email: 'admin@greenwave.test',
        role: 'admin',
        fullName: 'GW Admin',
        divisions: ['greenwave'],
      };
      expect(() => assertGreenWaveRecyclingFinanceAccess(actor)).not.toThrow();
    });

    it('allows GreenWave Recycling manager with permissions', () => {
      const actor: AuthenticatedUser = {
        id: 2,
        email: 'manager@greenwave.test',
        role: 'manager',
        fullName: 'GW Manager',
        divisions: ['greenwave'],
        permissions: ['accounting:read', 'banking:read', 'payables:read', 'payments:read_all'],
      };
      expect(() => assertGreenWaveRecyclingFinanceAccess(actor)).not.toThrow();
    });

    it('rejects Healthcare admin even though role is admin', () => {
      const actor: AuthenticatedUser = {
        id: 3,
        email: 'hc-admin@greenwave.test',
        role: 'admin',
        fullName: 'Healthcare Admin',
        divisions: ['healthcare'],
      };
      expect(() => assertGreenWaveRecyclingFinanceAccess(actor)).toThrow(
        new ForbiddenException(
          'Financial operations are strictly restricted to the GreenWave Recycling division',
        ),
      );
    });

    it('rejects Healthcare manager', () => {
      const actor: AuthenticatedUser = {
        id: 4,
        email: 'hc-manager@greenwave.test',
        role: 'manager',
        fullName: 'Healthcare Manager',
        divisions: ['healthcare'],
        permissions: ['accounting:read', 'banking:read', 'payments:read_all'],
      };
      expect(() => assertGreenWaveRecyclingFinanceAccess(actor)).toThrow(
        new ForbiddenException(
          'Financial operations are strictly restricted to the GreenWave Recycling division',
        ),
      );
    });

    it('rejects user with no divisions assigned', () => {
      const actor: AuthenticatedUser = {
        id: 5,
        email: 'nodiv@greenwave.test',
        role: 'staff',
        fullName: 'No Div Staff',
        divisions: [],
      };
      expect(() => assertGreenWaveRecyclingFinanceAccess(actor)).toThrow(
        new ForbiddenException(
          'Financial operations are strictly restricted to the GreenWave Recycling division',
        ),
      );
    });

    it('rejects Healthcare user attempting to spoof X-Division: greenwave header', () => {
      const actor: AuthenticatedUser = {
        id: 6,
        email: 'hc-attacker@greenwave.test',
        role: 'admin',
        fullName: 'Healthcare Attacker',
        divisions: ['healthcare'], // Server-resolved grants only have healthcare
      };
      const req = {
        headers: { 'x-division': 'greenwave' },
      } as unknown as Request;

      expect(() => assertGreenWaveRecyclingFinanceAccess(actor, req)).toThrow(
        new ForbiddenException(
          'Financial operations are strictly restricted to the GreenWave Recycling division',
        ),
      );
    });

    it('rejects dual-division user when active division is switched to Healthcare', () => {
      const actor: AuthenticatedUser = {
        id: 7,
        email: 'dual@greenwave.test',
        role: 'admin',
        fullName: 'Dual Admin',
        divisions: ['greenwave', 'healthcare'],
      };
      const reqWithHeader = {
        headers: { 'x-division': 'healthcare' },
      } as unknown as Request;
      const reqWithQuery = {
        headers: {},
        query: { division: 'healthcare' },
      } as unknown as Request;

      expect(() => assertGreenWaveRecyclingFinanceAccess(actor, reqWithHeader)).toThrow(
        ForbiddenException,
      );
      expect(() => assertGreenWaveRecyclingFinanceAccess(actor, reqWithQuery)).toThrow(ForbiddenException);
    });

    it('allows dual-division user when active division is Recycling / greenwave', () => {
      const actor: AuthenticatedUser = {
        id: 7,
        email: 'dual@greenwave.test',
        role: 'admin',
        fullName: 'Dual Admin',
        divisions: ['greenwave', 'healthcare'],
      };
      const reqWithHeader = {
        headers: { 'x-division': 'recycling' },
      } as unknown as Request;

      expect(() => assertGreenWaveRecyclingFinanceAccess(actor, reqWithHeader)).not.toThrow();
    });
  });

  describe('RecyclingFinanceGuard', () => {
    it('returns true for GreenWave Recycling admin', () => {
      const ctx = createMockContext({
        id: 1,
        role: 'admin',
        divisions: ['greenwave'],
      });
      expect(recyclingGuard.canActivate(ctx)).toBe(true);
    });

    it('throws ForbiddenException for Healthcare admin', () => {
      const ctx = createMockContext({
        id: 2,
        role: 'admin',
        divisions: ['healthcare'],
      });
      expect(() => recyclingGuard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException for Healthcare user calling API directly', () => {
      const ctx = createMockContext(
        {
          id: 3,
          role: 'manager',
          divisions: ['healthcare'],
          permissions: ['payments:read_all'],
        },
        { headers: { 'x-division': 'healthcare' } },
      );
      expect(() => recyclingGuard.canActivate(ctx)).toThrow(ForbiddenException);
    });
  });

  describe('GlobalFinanceAccessGuard', () => {
    it('allows GreenWave Recycling admin', () => {
      const ctx = createMockContext({
        id: 1,
        role: 'admin',
        divisions: ['greenwave'],
      });
      expect(globalFinanceGuard.canActivate(ctx)).toBe(true);
    });

    it('allows GreenWave Recycling manager with warehouses:global_access', () => {
      const ctx = createMockContext({
        id: 2,
        role: 'manager',
        divisions: ['greenwave'],
        permissions: ['warehouses:global_access', 'accounting:read'],
      });
      expect(globalFinanceGuard.canActivate(ctx)).toBe(true);
    });

    it('rejects GreenWave Recycling manager WITHOUT global warehouse access', () => {
      const ctx = createMockContext({
        id: 3,
        role: 'manager',
        divisions: ['greenwave'],
        permissions: ['accounting:read'],
      });
      expect(() => globalFinanceGuard.canActivate(ctx)).toThrow(
        new ForbiddenException('Company-wide financial records require global warehouse access'),
      );
    });

    it('rejects Healthcare admin even with admin role', () => {
      const ctx = createMockContext({
        id: 4,
        role: 'admin',
        divisions: ['healthcare'],
      });
      expect(() => globalFinanceGuard.canActivate(ctx)).toThrow(
        new ForbiddenException(
          'Financial operations are strictly restricted to the GreenWave Recycling division',
        ),
      );
    });

    it('rejects Healthcare manager even with warehouses:global_access and accounting permissions', () => {
      const ctx = createMockContext({
        id: 5,
        role: 'manager',
        divisions: ['healthcare'],
        permissions: ['warehouses:global_access', 'accounting:read'],
      });
      expect(() => globalFinanceGuard.canActivate(ctx)).toThrow(
        new ForbiddenException(
          'Financial operations are strictly restricted to the GreenWave Recycling division',
        ),
      );
    });
  });
});

 describe('Finance context fail-closed contract', () => {
  const actor = { id: 7, role: 'admin', divisions: ['greenwave', 'healthcare'] } as AuthenticatedUser;
  it.each([undefined, '', 'invalid', ['greenwave'], 'greenwave,healthcare'])('rejects missing/malformed context %p', (value) => {
    expect(() => assertGreenWaveRecyclingFinanceAccess({ ...actor }, { headers: { 'x-division': value } } as unknown as Request)).toThrow(ForbiddenException);
  });
  it('does not accept body or query as context', () => {
    expect(() => assertGreenWaveRecyclingFinanceAccess({ ...actor }, { headers: {}, body: { division: 'greenwave' }, query: { division: 'greenwave' } } as unknown as Request)).toThrow(ForbiddenException);
  });
 });
