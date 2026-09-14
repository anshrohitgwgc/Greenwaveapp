import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { GlobalFinanceAccessGuard } from '../common/guards/global-finance-access.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { getRequestId } from '../common/request-id';
import { AccountingReportsService } from './accounting-reports.service';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import {
  AccountsQueryDto,
  AsOfQueryDto,
  CreateLedgerAccountDto,
  CreateManualEntryDto,
  GeneralLedgerQueryDto,
  JournalListQueryDto,
  RangeQueryDto,
  ReverseEntryDto,
  UpdateLedgerAccountDto,
} from './dto/accounting.dto';
import { JournalService } from './journal.service';

@Controller('accounting')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GlobalFinanceAccessGuard)
@Roles('admin', 'manager')
export class AccountingController {
  constructor(
    private readonly chart: ChartOfAccountsService,
    private readonly journal: JournalService,
    private readonly reports: AccountingReportsService,
  ) {}

  @Get('accounts')
  @RequirePermissions('accounting:read')
  listAccounts(@Query() q: AccountsQueryDto) {
    return this.chart.list(q);
  }

  @Post('accounts')
  @Roles('admin')
  @RequirePermissions('accounting:manage_accounts')
  createAccount(@Body() dto: CreateLedgerAccountDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.chart.create(dto, actor);
  }

  @Patch('accounts/:id')
  @Roles('admin')
  @RequirePermissions('accounting:manage_accounts')
  updateAccount(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLedgerAccountDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.chart.update(id, dto, actor);
  }

  @Get('journal-entries')
  @RequirePermissions('accounting:read')
  listEntries(@Query() q: JournalListQueryDto) {
    return this.journal.list(q);
  }

  @Get('journal-entries/:id')
  @RequirePermissions('accounting:read')
  getEntry(@Param('id', ParseUUIDPipe) id: string) {
    return this.journal.get(id);
  }

  @Post('journal-entries')
  @Roles('admin')
  @RequirePermissions('accounting:post')
  createEntry(@Body() dto: CreateManualEntryDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.journal.createManual(dto, actor, getRequestId(req));
  }

  @Post('journal-entries/:id/post')
  @Roles('admin')
  @RequirePermissions('accounting:post')
  postEntry(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.journal.post(id, actor, getRequestId(req));
  }

  @Post('journal-entries/:id/reverse')
  @Roles('admin')
  @RequirePermissions('accounting:post')
  reverseEntry(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReverseEntryDto, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.journal.reverse(id, dto, actor, getRequestId(req));
  }

  @Get('reports/trial-balance')
  @RequirePermissions('accounting:read')
  trialBalance(@Query() q: AsOfQueryDto) {
    return this.reports.trialBalance(q);
  }

  @Get('reports/profit-and-loss')
  @RequirePermissions('accounting:read')
  profitAndLoss(@Query() q: RangeQueryDto) {
    return this.reports.profitAndLoss(q);
  }

  @Get('reports/balance-sheet')
  @RequirePermissions('accounting:read')
  balanceSheet(@Query() q: AsOfQueryDto) {
    return this.reports.balanceSheet(q);
  }

  @Get('reports/cash-flow')
  @RequirePermissions('accounting:read')
  cashFlow(@Query() q: RangeQueryDto) {
    return this.reports.cashFlow(q);
  }

  @Get('reports/general-ledger')
  @RequirePermissions('accounting:read')
  generalLedger(@Query() q: GeneralLedgerQueryDto) {
    return this.reports.generalLedger(q);
  }

  @Get('receivables/aging')
  @RequirePermissions('accounting:read')
  receivablesAging(@Query() q: AsOfQueryDto) {
    return this.reports.receivablesAging(q);
  }
}
