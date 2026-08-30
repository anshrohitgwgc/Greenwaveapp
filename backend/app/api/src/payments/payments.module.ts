import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Invoice } from '../invoices/entities/invoice.entity';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { Payment } from './entities/payment.entity';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PublicPaymentsController } from './public-payments.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Payment, Invoice]), WarehousesModule],
  controllers: [PaymentsController, PublicPaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
