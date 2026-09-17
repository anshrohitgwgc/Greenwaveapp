import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DivisionsModule } from '../divisions/divisions.module';
import { Material } from '../materials/entities/material.entity';
import { PhotoAsset } from '../photos/entities/photo-asset.entity';
import { StorageModule } from '../storage/storage.module';
import { User } from '../users/entities/user.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { Container } from './entities/container.entity';
import { InventoryBalance } from './entities/inventory-balance.entity';
import { InventoryTransaction } from './entities/inventory-transaction.entity';
import { InventoryTransactionPhoto } from './entities/inventory-transaction-photo.entity';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Container,
      InventoryTransaction,
      InventoryTransactionPhoto,
      InventoryBalance,
      Material,
      User,
      Warehouse,
      PhotoAsset,
    ]),
    StorageModule,
    WarehousesModule,
    DivisionsModule,
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService, TypeOrmModule],
})
export class InventoryModule {}
