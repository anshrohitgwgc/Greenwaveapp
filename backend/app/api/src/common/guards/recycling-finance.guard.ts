import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import {
  DIVISION_GREENWAVE,
  Division,
  normalizeDivision,
} from '../../divisions/divisions.constants';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';

/**
 * Authoritative security assertion:
 * Ensures the actor is authorized for the GreenWave Recycling division,
 * and a valid active division context for multi-division actors.
 * Only X-Division supplies request context; membership is server-resolved.
 *
 * Financial/accounting/banking/payment-management functionality is strictly
 * restricted to GreenWave Recycling.
 */
export function assertGreenWaveRecyclingFinanceAccess(
  user: AuthenticatedUser | undefined,
  request?: Request,
): void {
  if (!user) {
    throw new ForbiddenException('Not authorized for this action');
  }

  const rawDivisions = Array.isArray(user.divisions) ? user.divisions : [];
  const canonicalDivisions = rawDivisions
    .map((d) => normalizeDivision(d))
    .filter((d): d is Division => d !== null);

  if (!canonicalDivisions.includes(DIVISION_GREENWAVE)) {
    throw new ForbiddenException(
      'Financial operations are strictly restricted to the GreenWave Recycling division',
    );
  }

  // X-Division is the API context contract. Query/body fields cannot grant access.
  // Single-division actors may omit it; multi-division actors must choose explicitly.
  const raw = request ? request.headers?.['x-division'] : user.activeFinanceDivision;
  const active = raw === undefined && new Set(canonicalDivisions).size === 1
    ? canonicalDivisions[0]
    : typeof raw === 'string' ? normalizeDivision(raw) : null;
  if (active !== DIVISION_GREENWAVE) {
    throw new ForbiddenException(
      'Financial operations are strictly restricted to the GreenWave Recycling division; valid X-Division context is required',
    );
  }
  // Request-scoped server-validated context for service-layer checks.
  if (request) user.activeFinanceDivision = active;

}

/**
 * Guard for endpoints that are restricted to GreenWave Recycling division.
 */
@Injectable()
export class RecyclingFinanceGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    assertGreenWaveRecyclingFinanceAccess(request.user, request);
    return true;
  }
}
