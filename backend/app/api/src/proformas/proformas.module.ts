import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { Customer } from '../customers/entities/customer.entity';
import { InvoicesModule } from '../invoices/invoices.module';
import { MailModule } from '../mail/mail.module';
import { Material } from '../materials/entities/material.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { ProformaInvoiceItem } from './entities/proforma-invoice-item.entity';
import { ProformaInvoice } from './entities/proforma-invoice.entity';
import { ProformasController } from './proformas.controller';
import { ProformasService } from './proformas.service';
import { RecyclingFinanceGuard } from '../common/guards/recycling-finance.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProformaInvoice,
      ProformaInvoiceItem,
      Customer,
      Material,
      Warehouse,
    ]),
    WarehousesModule,
    InvoicesModule,
    AuditModule,
    MailModule,
  ],
  controllers: [ProformasController],
  providers: [ProformasService, RecyclingFinanceGuard],
  exports: [ProformasService, TypeOrmModule],
})
export class ProformasModule {}
