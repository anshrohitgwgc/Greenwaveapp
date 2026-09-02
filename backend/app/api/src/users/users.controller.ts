import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AssignDivisionsDto } from '../divisions/dto/assign-divisions.dto';
import { DIVISION_LABELS, Division } from '../divisions/divisions.constants';
import { DivisionsService } from '../divisions/divisions.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { AssignWarehousesDto } from './dto/assign-warehouses.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

function sanitize(user: {
  id: number;
  fullName: string;
  email: string;
  role: string;
  status?: string;
  createdAt: Date;
  lastLoginAt?: Date | null;
}) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    status: user.status ?? 'active',
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
    private readonly warehousesService: WarehousesService,
    private readonly divisionsService: DivisionsService,
  ) {}

  /**
   * The divisions the acting admin is themselves allowed to hand out. An
   * admin can never grant a division they do not hold — including to
   * themselves — which is what stops a GreenWave-only admin from
   * self-escalating into Healthcare.
   */
  private async assignableDivisions(
    actor: AuthenticatedUser,
  ): Promise<Division[]> {
    return this.divisionsService.scopeDivisions(actor);
  }

  private divisionPayload(divisions: Division[]) {
    return divisions.map((key) => ({ key, label: DIVISION_LABELS[key] }));
  }

  @Post()
  @Roles('admin')
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    // Validate warehouse assignment permissions
    if (dto.warehouseIds && dto.warehouseIds.length > 0) {
      const hasGlobal =
        actor.hasGlobalAccess ||
        (actor.permissions &&
          actor.permissions.includes('warehouses:global_access'));
      if (!hasGlobal) {
        const actorWarehouseIds =
          await this.warehousesService.getUserAuthorizedWarehouseIds(
            actor.id,
            actor.role,
            actor.permissions,
          );
        const unauthorized = dto.warehouseIds.filter(
          (whId) => !actorWarehouseIds.includes(whId),
        );
        if (unauthorized.length > 0) {
          throw new ForbiddenException(
            'Cannot assign warehouse facilities you are not authorized to manage',
          );
        }
      }
    }

    if (dto.divisions && dto.divisions.length > 0) {
      const assignable = await this.assignableDivisions(actor);
      const unauthorized = dto.divisions.filter(
        (d) => !assignable.includes(d as Division),
      );
      if (unauthorized.length > 0) {
        throw new ForbiddenException(
          'Cannot assign a business division you are not authorized to manage',
        );
      }
    }

    const user = await this.usersService.create(dto, actor.id);
    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'user.created',
      entityType: 'user',
      entityId: String(user.id),
      summary: `${actor.email} created user ${user.email} (${user.role}) with divisions [${(dto.divisions ?? []).join(', ') || 'none'}]`,
    });
    return {
      ...sanitize(user),
      divisions: this.divisionPayload(
        await this.usersService.getUserDivisions(user.id),
      ),
    };
  }

  @Get()
  @Roles('admin', 'manager')
  async findAll(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('warehouseId') warehouseId?: string,
  ) {
    if (warehouseId) {
      await this.warehousesService.assertWarehouseAccess(actor, warehouseId);
      const users = await this.usersService.findByWarehouse(warehouseId);
      return Promise.all(
        users.map(async (u) => {
          const warehouses = await this.usersService.getUserWarehouses(u.id);
          return {
            ...sanitize(u),
            warehouses,
            divisions: this.divisionPayload(
              await this.usersService.getUserDivisions(u.id),
            ),
          };
        }),
      );
    }

    const users = await this.usersService.findAll();
    return Promise.all(
      users.map(async (u) => {
        const warehouses = await this.usersService.getUserWarehouses(u.id);
        return {
          ...sanitize(u),
          warehouses,
          divisions: this.divisionPayload(
            await this.usersService.getUserDivisions(u.id),
          ),
        };
      }),
    );
  }

  @Get('warehouse/:warehouseId')
  @Roles('admin', 'manager')
  async findByWarehouse(
    @Param('warehouseId') warehouseId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    await this.warehousesService.assertWarehouseAccess(actor, warehouseId);
    const users = await this.usersService.findByWarehouse(warehouseId);
    return Promise.all(
      users.map(async (u) => {
        const warehouses = await this.usersService.getUserWarehouses(u.id);
        return {
          ...sanitize(u),
          warehouses,
          divisions: this.divisionPayload(
            await this.usersService.getUserDivisions(u.id),
          ),
        };
      }),
    );
  }

  @Get('me')
  async me(@CurrentUser() actor: AuthenticatedUser) {
    const profile = await this.usersService.getUserProfile(actor.id);
    if (!profile) throw new NotFoundException('User not found');
    return profile;
  }

  @Get(':id')
  @Roles('admin', 'manager')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const profile = await this.usersService.getUserProfile(id);
    if (!profile) throw new NotFoundException('User not found');
    return profile;
  }

  @Patch(':id')
  @Roles('admin')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (id === actor.id && dto.role && dto.role !== actor.role) {
      throw new ForbiddenException('Cannot change your own role');
    }
    if (id === actor.id && dto.status && dto.status !== 'active') {
      throw new ForbiddenException('Cannot deactivate your own account');
    }

    if (dto.warehouseIds && dto.warehouseIds.length > 0) {
      const hasGlobal =
        actor.hasGlobalAccess ||
        (actor.permissions &&
          actor.permissions.includes('warehouses:global_access'));
      if (!hasGlobal) {
        const actorWarehouseIds =
          await this.warehousesService.getUserAuthorizedWarehouseIds(
            actor.id,
            actor.role,
            actor.permissions,
          );
        const unauthorized = dto.warehouseIds.filter(
          (whId) => !actorWarehouseIds.includes(whId),
        );
        if (unauthorized.length > 0) {
          throw new ForbiddenException(
            'Cannot assign warehouse facilities you are not authorized to manage',
          );
        }
      }
    }

    // A staff member cannot grant themselves anything: this route is already
    // @Roles('admin'), and an admin is further limited to the divisions they
    // hold, so there is no path from "can edit a user" to "can widen division
    // access beyond my own".
    const assignable = await this.assignableDivisions(actor);

    const user = await this.usersService.update(
      id,
      dto,
      actor.id,
      dto.divisions !== undefined ? assignable : undefined,
    );
    if (!user) throw new NotFoundException('User not found');
    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'user.updated',
      entityType: 'user',
      entityId: String(user.id),
      summary:
        dto.divisions !== undefined
          ? `${actor.email} updated user ${user.email}; division access -> [${dto.divisions.join(', ') || 'none'}]`
          : `${actor.email} updated user ${user.email}`,
    });
    return {
      ...sanitize(user),
      divisions: this.divisionPayload(
        await this.usersService.getUserDivisions(user.id),
      ),
    };
  }

  @Get(':id/divisions')
  @Roles('admin', 'manager')
  async getUserDivisionsRoute(@Param('id', ParseIntPipe) id: number) {
    return this.divisionPayload(await this.usersService.getUserDivisions(id));
  }

  /**
   * Replace a user's division access. Admin-only, and further constrained to
   * the divisions the acting admin holds. Sending an empty array revokes all
   * division access, which is a legitimate operation.
   */
  @Put(':id/divisions')
  @Roles('admin')
  async assignUserDivisions(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignDivisionsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const user = await this.usersService.findOne(id);
    if (!user) throw new NotFoundException('User not found');

    const assignable = await this.assignableDivisions(actor);
    const updated = await this.usersService.assignUserDivisions(
      id,
      dto.divisions,
      actor.id,
      assignable,
    );

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'user.division_access_updated',
      entityType: 'user',
      entityId: String(user.id),
      summary: `${actor.email} set division access for ${user.email} to [${dto.divisions.join(', ') || 'none'}]`,
    });

    return this.divisionPayload(updated);
  }

  @Get(':id/warehouses')
  @Roles('admin', 'manager')
  async getUserWarehouses(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.getUserWarehouses(id);
  }

  @Put(':id/warehouses')
  @Roles('admin')
  async assignUserWarehouses(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignWarehousesDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const user = await this.usersService.findOne(id);
    if (!user) throw new NotFoundException('User not found');

    const hasGlobal =
      actor.hasGlobalAccess ||
      (actor.permissions &&
        actor.permissions.includes('warehouses:global_access'));
    if (!hasGlobal && dto.warehouseIds && dto.warehouseIds.length > 0) {
      const actorWarehouseIds =
        await this.warehousesService.getUserAuthorizedWarehouseIds(
          actor.id,
          actor.role,
          actor.permissions,
        );
      const unauthorized = dto.warehouseIds.filter(
        (whId) => !actorWarehouseIds.includes(whId),
      );
      if (unauthorized.length > 0) {
        throw new ForbiddenException(
          'Cannot assign warehouse facilities you are not authorized to manage',
        );
      }
    }

    const updatedWarehouses = await this.usersService.assignUserWarehouses(
      id,
      dto.warehouseIds,
      actor.id,
    );

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'user.warehouse_access_updated',
      entityType: 'user',
      entityId: String(user.id),
      summary: `${actor.email} updated warehouse access for ${user.email}`,
    });

    return updatedWarehouses;
  }
}
