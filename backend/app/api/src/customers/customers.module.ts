import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WarehousesModule } from '../warehouses/warehouses.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { Customer } from './entities/customer.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Customer]), WarehousesModule],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService, TypeOrmModule],
})
export class CustomersModule {}
