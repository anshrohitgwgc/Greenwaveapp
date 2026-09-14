import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

export function hasPermission(user: { role?: string; permissions?: string[] } | undefined, permission: string): boolean {
  if (!user) return false;
  // Matches the existing convention (e.g. payments refund check): the admin
  // role holds every permission; migrations also grant them explicitly.
  if (user.role === 'admin') return true;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const user = context.switchToHttp().getRequest<Request>().user;
    if (!user || !required.every((p) => hasPermission(user, p))) {
      throw new ForbiddenException('Not authorized for this action');
    }
    return true;
  }
}
