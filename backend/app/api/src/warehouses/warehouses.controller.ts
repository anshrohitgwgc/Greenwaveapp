import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { WarehousesService } from './warehouses.service';

@Controller('warehouses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WarehousesController {
  constructor(
    private readonly warehousesService: WarehousesService,
    private readonly auditService: AuditService,
  ) {}

  @Post()
  @Roles('admin')
  async create(
    @Body() dto: CreateWarehouseDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const warehouse = await this.warehousesService.create(dto, actor.id);
    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'warehouse.created',
      entityType: 'warehouse',
      entityId: warehouse.id,
      warehouseId: warehouse.id,
      summary: `${actor.email} created warehouse ${warehouse.name}`,
    });
    return warehouse;
  }

  // Returns ONLY warehouses the authenticated user is authorized to access
  @Get()
  findAll(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.warehousesService.getUserAuthorizedWarehouses(
      actor.id,
      actor.role,
      actor.permissions,
      includeInactive === 'true',
    );
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    await this.warehousesService.assertWarehouseAccess(actor, id);
    return this.warehousesService.findOne(id);
  }

  @Patch(':id')
  @Roles('admin')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateWarehouseDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const warehouse = await this.warehousesService.update(id, dto, actor.id);
    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'warehouse.updated',
      entityType: 'warehouse',
      entityId: warehouse.id,
      warehouseId: warehouse.id,
      summary: `${actor.email} updated warehouse ${warehouse.name}`,
    });
    return warehouse;
  }
}
