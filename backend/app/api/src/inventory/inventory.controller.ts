import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateContainerDto } from './dto/create-container.dto';
import { CreateInventoryTransactionDto } from './dto/create-inventory-transaction.dto';
import { AttachInventoryPhotosDto } from './dto/attach-inventory-photos.dto';
import { InventoryService } from './inventory.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post('containers')
  @Roles('admin', 'manager', 'staff', 'driver')
  createContainer(
    @Body() dto: CreateContainerDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.inventoryService.createContainer(dto, actor);
  }

  @Get('containers')
  @Roles('admin', 'manager', 'staff', 'driver')
  listContainers(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('warehouseId') warehouseId?: string,
    @Query('division') division?: string,
    @Query('search') search?: string,
  ) {
    return this.inventoryService.listContainers(
      actor,
      warehouseId,
      division,
      search,
    );
  }

  @Post('inventory/transactions')
  @Roles('admin', 'manager', 'staff', 'driver')
  createTransaction(
    @Body() dto: CreateInventoryTransactionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.inventoryService.createTransaction(dto, actor);
  }

  @Get('inventory/transactions')
  @Roles('admin', 'manager', 'staff', 'driver')
  listTransactions(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('warehouseId') warehouseId?: string,
    @Query('division') division?: string,
    @Query('materialId') materialId?: string,
    @Query('type') type?: string,
    @Query('orderNumber') orderNumber?: string,
    @Query('containerNumber') containerNumber?: string,
    @Query('search') search?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.inventoryService.listTransactions(actor, {
      warehouseId,
      division,
      materialId,
      type,
      orderNumber,
      containerNumber,
      search,
      startDate,
      endDate,
    });
  }

  @Get('inventory/transactions/:id')
  @Roles('admin', 'manager', 'staff', 'driver')
  getTransaction(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.inventoryService.getTransactionById(id, actor);
  }

  @Post('inventory/transactions/:id/photos')
  @Roles('admin', 'manager', 'staff')
  attachPhotos(
    @Param('id') id: string,
    @Body() dto: AttachInventoryPhotosDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.inventoryService.attachPhotos(id, dto.photoIds, actor);
  }

  @Delete('inventory/transactions/:id/photos/:photoId')
  @Roles('admin', 'manager', 'staff')
  detachPhoto(
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.inventoryService.detachPhoto(id, photoId, actor);
  }

  @Get('inventory/balances')
  @Roles('admin', 'manager', 'staff', 'driver')
  getBalances(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('warehouseId') warehouseId?: string,
    @Query('division') division?: string,
  ) {
    return this.inventoryService.getBalances(actor, warehouseId, division);
  }
}
