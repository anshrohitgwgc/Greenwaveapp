import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WarehousesModule } from '../warehouses/warehouses.module';
import { Material } from './entities/material.entity';
import { MaterialsController } from './materials.controller';
import { MaterialsService } from './materials.service';

@Module({
  imports: [TypeOrmModule.forFeature([Material]), WarehousesModule],
  controllers: [MaterialsController],
  providers: [MaterialsService],
  exports: [MaterialsService, TypeOrmModule],
})
export class MaterialsModule {}
