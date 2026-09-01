import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Container } from '../inventory/entities/container.entity';
import { InventoryTransaction } from '../inventory/entities/inventory-transaction.entity';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { Material } from './entities/material.entity';
import { MaterialsController } from './materials.controller';
import { MaterialsService } from './materials.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Material, InventoryTransaction, Container]),
    WarehousesModule,
  ],
  controllers: [MaterialsController],
  providers: [MaterialsService],
  exports: [MaterialsService, TypeOrmModule],
})
export class MaterialsModule {}
