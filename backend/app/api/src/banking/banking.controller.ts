import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
import { BankingService } from './banking.service';
import {
  CategorizeDto,
  CompleteReconciliationDto,
  CreateFinancialAccountDto,
  ExcludeDto,
  ImportPreviewBodyDto,
  ListTransactionsQueryDto,
  MatchDto,
  StartReconciliationDto,
  StatementMappingDto,
  UpdateFinancialAccountDto,
} from './dto/banking.dto';

const MAX_CSV_SIZE = 10 * 1024 * 1024; // 10MB

@Controller('banking')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GlobalFinanceAccessGuard)
@Roles('admin', 'manager')
export class BankingController {
  constructor(private readonly banking: BankingService) {}

  // --------------------------------------------------------------------------
  // Financial Accounts
  // --------------------------------------------------------------------------

  @Get('accounts')
  @RequirePermissions('banking:read')
  listAccounts(@Query('includeInactive') includeInactive?: string) {
    return this.banking.listAccounts(includeInactive === 'true');
  }

  @Get('accounts/:id')
  @RequirePermissions('banking:read')
  getAccount(@Param('id', ParseUUIDPipe) id: string) {
    return this.banking.getAccount(id);
  }

  @Post('accounts')
  @Roles('admin')
  @RequirePermissions('banking:manage')
  createAccount(@Body() dto: CreateFinancialAccountDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.banking.createAccount(dto, actor);
  }

  @Patch('accounts/:id')
  @Roles('admin')
  @RequirePermissions('banking:manage')
  updateAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFinancialAccountDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.banking.updateAccount(id, dto, actor);
  }

  // --------------------------------------------------------------------------
  // Transactions
  // --------------------------------------------------------------------------

  @Get('transactions')
  @RequirePermissions('banking:read')
  listTransactions(@Query() q: ListTransactionsQueryDto) {
    return this.banking.listTransactions(q);
  }

  @Get('transactions/:id')
  @RequirePermissions('banking:read')
  getTransaction(@Param('id', ParseUUIDPipe) id: string) {
    return this.banking.getTransaction(id);
  }

  @Post('transactions/:id/categorize')
  @RequirePermissions('banking:manage')
  categorize(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CategorizeDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.banking.categorize(id, dto, actor, getRequestId(req));
  }

  @Post('transactions/:id/match')
  @RequirePermissions('banking:manage')
  match(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MatchDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.banking.match(id, dto, actor, getRequestId(req));
  }

  @Post('transactions/:id/exclude')
  @RequirePermissions('banking:manage')
  exclude(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExcludeDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.banking.exclude(id, dto, actor);
  }

  // --------------------------------------------------------------------------
  // Statement Import
  // --------------------------------------------------------------------------

  @Post('import/preview')
  @Roles('admin')
  @RequirePermissions('banking:manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_CSV_SIZE } }))
  previewImport(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: ImportPreviewBodyDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException('CSV file is required');
    let mapping: StatementMappingDto;
    try {
      mapping = typeof body.mapping === 'string' ? JSON.parse(body.mapping) : body.mapping;
    } catch {
      throw new BadRequestException('Invalid JSON in mapping field');
    }
    return this.banking.previewImport(body.accountId, file.buffer, file.originalname, mapping, actor);
  }

  @Post('import/:batchId/commit')
  @Roles('admin')
  @RequirePermissions('banking:manage')
  commitImport(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.banking.commitImport(batchId, actor);
  }

  @Post('import/:batchId/discard')
  @Roles('admin')
  @RequirePermissions('banking:manage')
  discardImport(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.banking.discardImport(batchId, actor);
  }

  // --------------------------------------------------------------------------
  // Reconciliation
  // --------------------------------------------------------------------------

  @Post('reconciliations')
  @Roles('admin')
  @RequirePermissions('reconciliation:complete')
  startReconciliation(
    @Body() dto: StartReconciliationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.banking.startReconciliation(dto, actor);
  }

  @Get('reconciliations/:id')
  @RequirePermissions('banking:read')
  getReconciliation(@Param('id', ParseUUIDPipe) id: string) {
    return this.banking.getReconciliation(id);
  }

  @Post('reconciliations/:id/complete')
  @Roles('admin')
  @RequirePermissions('reconciliation:complete')
  completeReconciliation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteReconciliationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.banking.completeReconciliation(id, dto, actor);
  }
}
