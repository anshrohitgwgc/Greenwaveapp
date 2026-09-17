import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Container } from '../inventory/entities/container.entity';
import { InventoryTransaction } from '../inventory/entities/inventory-transaction.entity';
import { DivisionsModule } from '../divisions/divisions.module';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { Material } from './entities/material.entity';
import { HealthcareProductCopyService } from './healthcare-product-copy.service';
import { MaterialsController } from './materials.controller';
import { MaterialsService } from './materials.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Material, InventoryTransaction, Container, Warehouse]),
    WarehousesModule,
    DivisionsModule,
  ],
  controllers: [MaterialsController],
  providers: [MaterialsService, HealthcareProductCopyService],
  exports: [MaterialsService, HealthcareProductCopyService, TypeOrmModule],
})
export class MaterialsModule {}
