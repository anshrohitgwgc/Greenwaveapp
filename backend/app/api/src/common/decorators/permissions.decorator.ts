import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Requires every listed permission key (resolved server-side from the role on
 * each request by JwtAuthGuard). Enforced by PermissionsGuard.
 */
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);
