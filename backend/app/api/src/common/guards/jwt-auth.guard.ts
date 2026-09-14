import {
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

import { SessionService, SessionData } from '../../auth/session.service';
import { DivisionsService } from '../../divisions/divisions.service';
import { RolesService } from '../../roles/roles.service';
import { UsersService } from '../../users/users.service';
import { WarehousesService } from '../../warehouses/warehouses.service';

interface RequestWithAuthExtensions extends Request {
  cookies: Record<string, string>;
  authMethod?: string;
  session?: SessionData;
}

function parseCookiesFromHeader(header?: string): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx !== -1) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      cookies[key] = decodeURIComponent(val);
    }
  }
  return cookies;
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    @Optional() private readonly sessionService?: SessionService,
    @Optional() private readonly usersService?: UsersService,
    @Optional() private readonly rolesService?: RolesService,
    @Optional() private readonly warehousesService?: WarehousesService,
    @Optional() private readonly divisionsService?: DivisionsService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<RequestWithAuthExtensions>();

    // 1. Check for opaque session cookie
    const cookies =
      request.cookies || parseCookiesFromHeader(request.headers?.cookie);
    const sessionId: string | undefined = cookies['gw_session'];

    if (sessionId && this.sessionService && this.usersService) {
      const session = await this.sessionService.getSession(sessionId);
      if (session) {
        const user = await this.usersService.findOne(session.userId);
        if (user && (!user.status || user.status === 'active')) {
          const permissions = this.rolesService
            ? await this.rolesService.getPermissionsForRole(user.role)
            : [];
          const hasGlobalAccess = permissions.includes(
            'warehouses:global_access',
          );
          const warehouseIds = this.warehousesService
            ? await this.warehousesService.getUserAuthorizedWarehouseIds(
                user.id,
                user.role,
                permissions,
              )
            : [];
          const divisions = this.divisionsService
            ? await this.divisionsService.getUserDivisions(user.id)
            : [];

          request.user = {
            id: user.id,
            email: user.email,
            role: user.role,
            fullName: user.fullName,
            permissions,
            warehouseIds,
            hasGlobalAccess,
            divisions,
          };
          request.authMethod = 'cookie';
          request.session = session;
          return true;
        } else {
          await this.sessionService.invalidateSession(sessionId);
          throw new UnauthorizedException(
            'Account is not active or no longer exists',
          );
        }
      }
    }

    // 2. Fall back to Passport JWT (Bearer token / ?token= SSE parameter)
    try {
      const result = (await super.canActivate(context)) as boolean;
      if (result) {
        request.authMethod = 'bearer';
      }
      return result;
    } catch {
      throw new UnauthorizedException('Authentication required');
    }
  }
}
