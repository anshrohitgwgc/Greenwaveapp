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
  ) {}

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

    const user = await this.usersService.create(dto, actor.id);
    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'user.created',
      entityType: 'user',
      entityId: String(user.id),
      summary: `${actor.email} created user ${user.email} (${user.role})`,
    });
    return sanitize(user);
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

    const user = await this.usersService.update(id, dto, actor.id);
    if (!user) throw new NotFoundException('User not found');
    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'user.updated',
      entityType: 'user',
      entityId: String(user.id),
      summary: `${actor.email} updated user ${user.email}`,
    });
    return sanitize(user);
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
