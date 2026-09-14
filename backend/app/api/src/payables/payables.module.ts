import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountingModule } from '../accounting/accounting.module';
import { GlobalFinanceAccessGuard } from '../common/guards/global-finance-access.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { BillPayment } from './entities/bill-payment.entity';
import { Bill } from './entities/bill.entity';
import { Vendor } from './entities/vendor.entity';
import { PayablesController } from './payables.controller';
import { PayablesService } from './payables.service';

export const PAYABLES_ENTITIES = [Vendor, Bill, BillPayment];

@Module({
  imports: [TypeOrmModule.forFeature(PAYABLES_ENTITIES), AccountingModule],
  controllers: [PayablesController],
  providers: [PayablesService, PermissionsGuard, GlobalFinanceAccessGuard],
  exports: [PayablesService],
})
export class PayablesModule {}
