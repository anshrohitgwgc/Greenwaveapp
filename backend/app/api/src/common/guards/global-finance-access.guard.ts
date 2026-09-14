import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { hasPermission } from './permissions.guard';

/**
 * Ensures company-wide financial data (General Ledger, Chart of Accounts,
 * Financial Reports, Bank Accounts, Payables) is only accessible to users
 * with global administrative or multi-facility access, preventing
 * single-warehouse-scoped managers from viewing company-wide financials.
 */
@Injectable()
export class GlobalFinanceAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Not authorized for this action');
    }

    if (user.role === 'admin') {
      return true;
    }

    if (hasPermission(user, 'warehouses:global_access')) {
      return true;
    }

    throw new ForbiddenException('Company-wide financial records require global warehouse access');
  }
}
