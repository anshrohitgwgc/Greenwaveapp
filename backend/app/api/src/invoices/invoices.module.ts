import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountingModule } from '../accounting/accounting.module';
import { RecyclingFinanceGuard } from '../common/guards/recycling-finance.guard';
import { Customer } from '../customers/entities/customer.entity';
import { Payment } from '../payments/entities/payment.entity';
import { DivisionsModule } from '../divisions/divisions.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { InvoiceItem } from './entities/invoice-item.entity';
import { Invoice } from './entities/invoice.entity';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, InvoiceItem, Customer, Payment]),
    AccountingModule,
    WarehousesModule,
    DivisionsModule,
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService, RecyclingFinanceGuard],
  exports: [InvoicesService, TypeOrmModule],
})
export class InvoicesModule {}
