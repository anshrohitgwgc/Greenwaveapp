import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthenticatedUser {
  id: number;
  email: string;
  role: string;
  fullName: string;
  permissions?: string[];
  warehouseIds?: string[];
  hasGlobalAccess?: boolean;
  /**
   * Canonical division keys this user has been explicitly granted
   * (`greenwave` / `healthcare`). Resolved server-side on every request by
   * JwtStrategy — never read from the token body or the client. An empty
   * array means no division-scoped data is readable at all.
   */
  divisions?: string[];
  /** Set only by the finance guard after membership/context validation. */
  activeFinanceDivision?: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user;
  },
);
