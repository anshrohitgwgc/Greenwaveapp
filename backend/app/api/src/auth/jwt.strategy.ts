import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { DivisionsService } from '../divisions/divisions.service';
import { RolesService } from '../roles/roles.service';
import { UsersService } from '../users/users.service';
import { WarehousesService } from '../warehouses/warehouses.service';

export interface JwtPayload {
  sub: number;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly rolesService: RolesService,
    private readonly warehousesService: WarehousesService,
    private readonly divisionsService: DivisionsService,
  ) {
    super({
      // The `/chat/stream` SSE endpoint is consumed via the browser
      // EventSource API, which cannot set an Authorization header — the
      // frontend (Api.chatStreamUrl()) passes the token as `?token=`
      // instead. Every other endpoint keeps using the standard bearer
      // header; the query param is only ever consulted as a fallback.
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: Request) => (req?.query?.token as string) || null,
      ]),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('JWT_SECRET') ?? 'insecure-dev-only-secret',
    });
  }

  async validate(payload: JwtPayload) {
    // Re-read the user on every request rather than trusting the token's
    // embedded role: a role change or deactivation takes effect immediately
    // instead of waiting up to 24h for the token to expire.
    const user = await this.usersService.findOne(payload.sub);

    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }

    const permissions = await this.rolesService.getPermissionsForRole(
      user.role,
    );
    const hasGlobalAccess = permissions.includes('warehouses:global_access');
    const warehouseIds =
      await this.warehousesService.getUserAuthorizedWarehouseIds(
        user.id,
        user.role,
        permissions,
      );
    // Division grants are read fresh here for the same reason the role is:
    // revoking a division takes effect on the next request, not whenever the
    // token happens to expire.
    const divisions = await this.divisionsService.getUserDivisions(user.id);

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
      permissions,
      warehouseIds,
      hasGlobalAccess,
      divisions,
    };
  }
}
