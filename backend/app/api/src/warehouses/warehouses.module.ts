import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ManagementWarehousesController } from './management-warehouses.controller';
import { UserWarehouse } from './entities/user-warehouse.entity';
import { Warehouse } from './entities/warehouse.entity';
import { WarehousesController } from './warehouses.controller';
import { WarehousesService } from './warehouses.service';

@Module({
  imports: [TypeOrmModule.forFeature([Warehouse, UserWarehouse])],
  controllers: [WarehousesController, ManagementWarehousesController],
  providers: [WarehousesService],
  exports: [WarehousesService, TypeOrmModule],
})
export class WarehousesModule {}
