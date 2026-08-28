import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppRole, ROLES_KEY } from '../decorators/roles.decorator';

/**
 * DRIVER is treated as a STAFF-tier role for any route that lists STAFF —
 * it is a pre-existing role used by the pickups module, not something this
 * change introduces, and the brief's ADMIN/MANAGER/STAFF model needs
 * somewhere to put it rather than silently locking drivers out.
 */
const ROLE_ALIASES: Record<string, AppRole[]> = {
  driver: ['driver', 'staff'],
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AppRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;

    if (!user || !user.role) {
      throw new ForbiddenException('Not authorized for this action');
    }

    const role = user.role as AppRole;
    const effectiveRoles = ROLE_ALIASES[role] ?? [role];
    const allowed = effectiveRoles.some((r) => required.includes(r));

    if (!allowed) {
      throw new ForbiddenException('Not authorized for this action');
    }

    return true;
  }
}
