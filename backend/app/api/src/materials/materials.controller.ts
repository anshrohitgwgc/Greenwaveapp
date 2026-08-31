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

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateMaterialDto } from './dto/create-material.dto';
import { UpdateMaterialDto } from './dto/update-material.dto';
import { MaterialsService } from './materials.service';

@Controller('materials')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MaterialsController {
  constructor(private readonly materialsService: MaterialsService) {}

  @Post()
  @Roles('admin', 'manager')
  create(
    @Body() dto: CreateMaterialDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.materialsService.create(dto, actor);
  }

  @Get()
  findAll(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('includeInactive') includeInactive?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('division') division?: string,
  ) {
    return this.materialsService.findAll(actor, {
      includeInactive: includeInactive === 'true',
      warehouseId,
      division,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.materialsService.findOne(id);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMaterialDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.materialsService.update(id, dto, actor);
  }
}
