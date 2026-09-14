import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { GlobalFinanceAccessGuard } from '../common/guards/global-finance-access.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { getRequestId } from '../common/request-id';
import { CreateBillDto, CreateVendorDto, ListBillsQueryDto, PayablesAgingQueryDto, UpdateVendorDto } from './dto/payables.dto';
import { PayablesService } from './payables.service';

@Controller('payables')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GlobalFinanceAccessGuard)
@Roles('admin', 'manager')
export class PayablesController {
  constructor(private readonly payables: PayablesService) {}

  @Get('vendors')
  @RequirePermissions('payables:read')
  listVendors(@Query('includeInactive') includeInactive?: string) {
    return this.payables.listVendors(includeInactive === 'true');
  }

  @Post('vendors')
  @Roles('admin')
  @RequirePermissions('payables:manage')
  createVendor(@Body() dto: CreateVendorDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.payables.createVendor(dto, actor);
  }

  @Patch('vendors/:id')
  @Roles('admin')
  @RequirePermissions('payables:manage')
  updateVendor(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVendorDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.payables.updateVendor(id, dto, actor);
  }

  @Get('bills')
  @RequirePermissions('payables:read')
  listBills(@Query() q: ListBillsQueryDto) {
    return this.payables.listBills(q);
  }

  @Get('aging')
  @RequirePermissions('payables:read')
  aging(@Query() q: PayablesAgingQueryDto) {
    return this.payables.aging(q);
  }

  @Get('bills/:id')
  @RequirePermissions('payables:read')
  getBill(@Param('id', ParseUUIDPipe) id: string) {
    return this.payables.getBill(id);
  }

  @Post('bills')
  @Roles('admin')
  @RequirePermissions('payables:manage')
  createBill(@Body() dto: CreateBillDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.payables.createBill(dto, actor);
  }

  @Post('bills/:id/approve')
  @Roles('admin')
  @RequirePermissions('payables:manage')
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.payables.approveBill(id, actor, getRequestId(req));
  }

  @Post('bills/:id/void')
  @Roles('admin')
  @RequirePermissions('payables:manage')
  void(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.payables.voidBill(id, actor, getRequestId(req));
  }
}
