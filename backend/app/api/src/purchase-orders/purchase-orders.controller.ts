import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { PurchaseOrdersService } from './purchase-orders.service';

/**
 * Purchase orders are administrator-only, end to end.
 *
 * The class-level `@Roles('admin')` is the authorization boundary — the
 * frontend hiding the nav entry is a convenience, not a control. RolesGuard
 * reads the role off the JWT-resolved request user, so a manager, staff member
 * or driver hand-crafting a request gets 403 on every verb below, including
 * the reads: a PO exposes supplier pricing that is not theirs to see.
 *
 * Note the deliberate absence of 'manager' here, which invoices *do* allow.
 * That is the brief: only admins may create, view, edit, delete or generate
 * purchase orders.
 */
@Controller('purchase-orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  @Post()
  create(
    @Body() dto: CreatePurchaseOrderDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.purchaseOrdersService.create(dto, actor);
  }

  @Get()
  findAll(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('warehouseId') warehouseId?: string,
    @Query('status') status?: string,
    @Query('division') division?: string,
    @Query('search') search?: string,
  ) {
    return this.purchaseOrdersService.findAll(actor, {
      warehouseId,
      status,
      division,
      search,
    });
  }

  /**
   * Preview of the number the next purchase order would receive, for the
   * editor's header. Declared before @Get(':id') so Nest does not route it as
   * a purchase order id.
   */
  @Get('next-number')
  nextNumber() {
    return this.purchaseOrdersService.peekNextPurchaseOrderNumber();
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.purchaseOrdersService.findOne(id, actor);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseOrderDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.purchaseOrdersService.update(id, dto, actor);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.purchaseOrdersService.remove(id, actor);
  }
}
