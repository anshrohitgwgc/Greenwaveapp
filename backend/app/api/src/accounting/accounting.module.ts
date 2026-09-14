import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { GlobalFinanceAccessGuard } from '../common/guards/global-finance-access.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Customer } from '../customers/entities/customer.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { AccountingPostingService } from './accounting-posting.service';
import { AccountingReportsService } from './accounting-reports.service';
import { AccountingController } from './accounting.controller';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalLine } from './entities/journal-line.entity';
import { LedgerAccount } from './entities/ledger-account.entity';
import { JournalService } from './journal.service';
import { LedgerService } from './ledger.service';

export const ACCOUNTING_ENTITIES = [LedgerAccount, JournalEntry, JournalLine];

@Module({
  imports: [TypeOrmModule.forFeature([...ACCOUNTING_ENTITIES, Invoice, Customer])],
  controllers: [AccountingController],
  providers: [
    LedgerService,
    AccountingPostingService,
    AccountingReportsService,
    ChartOfAccountsService,
    JournalService,
    PermissionsGuard,
    GlobalFinanceAccessGuard,
  ],
  exports: [LedgerService, AccountingPostingService, AccountingReportsService, TypeOrmModule],
})
export class AccountingModule {}
