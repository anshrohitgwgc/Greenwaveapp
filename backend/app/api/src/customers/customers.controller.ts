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
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly auditService: AuditService,
  ) {}

  @Post()
  @Roles('admin', 'manager')
  async create(
    @Body() dto: CreateCustomerDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const customer = await this.customersService.create(dto, actor.id);
    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'customer.created',
      entityType: 'customer',
      entityId: customer.id,
      warehouseId: customer.warehouseId,
      summary: `${actor.email} created customer ${customer.name}`,
    });
    return customer;
  }

  @Get()
  @Roles('admin', 'manager')
  findAll(@Query('warehouseId') warehouseId?: string) {
    return this.customersService.findAll(warehouseId);
  }

  @Get(':id')
  @Roles('admin', 'manager')
  findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const customer = await this.customersService.update(id, dto, actor.id);
    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'customer.updated',
      entityType: 'customer',
      entityId: customer.id,
      warehouseId: customer.warehouseId,
      summary: `${actor.email} updated customer ${customer.name}`,
    });
    return customer;
  }
}
