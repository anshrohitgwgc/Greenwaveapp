import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { HealthcareProductCopyService } from './healthcare-product-copy.service';
import { MaterialsService } from './materials.service';

@Controller('materials')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MaterialsController {
  constructor(
    private readonly materialsService: MaterialsService,
    private readonly copyService: HealthcareProductCopyService,
  ) {}

  @Get('admin/healthcare-copy-preview')
  @Roles('admin')
  healthcareCopyPreview(@Query('sourceWarehouseId') source?: string, @Query('targetWarehouseId') target?: string) {
    return this.copyService.preview(source, target);
  }

  @Post('admin/copy-healthcare-to-calgary')
  @Roles('admin')
  copyHealthcareToCalgary(@Body() body: { sourceWarehouseId?: string; targetWarehouseId?: string }) {
    return this.copyService.execute(body.sourceWarehouseId, body.targetWarehouseId);
  }

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
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.materialsService.findOne(id, actor);
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

  // Deletion is admin-only — unlike create/update, managers cannot remove a
  // product from the catalog.
  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.materialsService.remove(id, actor);
  }
}
