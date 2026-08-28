import { SetMetadata } from '@nestjs/common';

export type AppRole = 'admin' | 'manager' | 'staff' | 'driver';

export const ROLES_KEY = 'roles';

/**
 * Marks a route as requiring one of the given roles. Enforced by RolesGuard
 * server-side — the frontend hiding a control is not authorization.
 */
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);
