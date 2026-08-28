import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Container } from './entities/container.entity';
import { InventoryBalance } from './entities/inventory-balance.entity';
import { InventoryTransaction } from './entities/inventory-transaction.entity';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Container,
      InventoryTransaction,
      InventoryBalance,
    ]),
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService, TypeOrmModule],
})
export class InventoryModule {}
