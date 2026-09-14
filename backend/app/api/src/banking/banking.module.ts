import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountingModule } from '../accounting/accounting.module';
import { LedgerAccount } from '../accounting/entities/ledger-account.entity';
import { GlobalFinanceAccessGuard } from '../common/guards/global-finance-access.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { BillPayment } from '../payables/entities/bill-payment.entity';
import { Bill } from '../payables/entities/bill.entity';
import { StripePayout } from '../payments/entities/stripe-payout.entity';
import { BankingController } from './banking.controller';
import { BankingService } from './banking.service';
import { BankReconciliation } from './entities/bank-reconciliation.entity';
import { FinancialAccount } from './entities/financial-account.entity';
import { FinancialTransaction } from './entities/financial-transaction.entity';
import { ImportBatch } from './entities/import-batch.entity';
import { ImportBatchRow } from './entities/import-batch-row.entity';
import { TransactionSplit } from './entities/transaction-split.entity';

export const BANKING_ENTITIES = [
  FinancialAccount,
  FinancialTransaction,
  ImportBatch,
  ImportBatchRow,
  BankReconciliation,
  TransactionSplit,
];

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ...BANKING_ENTITIES,
      LedgerAccount,
      Bill,
      BillPayment,
      StripePayout,
    ]),
    AccountingModule,
  ],
  controllers: [BankingController],
  providers: [BankingService, PermissionsGuard, GlobalFinanceAccessGuard],
  exports: [BankingService, TypeOrmModule],
})
export class BankingModule {}
