import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RecyclingFinanceGuard } from '../common/guards/recycling-finance.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { getRequestId } from '../common/request-id';
import { CreateRefundDto } from './dto/create-refund.dto';
import { ListPaymentsQueryDto, PaymentSummaryQueryDto } from './dto/list-payments.query';
import { SendInvoiceDto } from './dto/send-invoice.dto';
import { PaymentsService } from './payments.service';
import { StripeSyncService } from './stripe-sync.service';

@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, RecyclingFinanceGuard)
@Roles('admin', 'manager')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly sync: StripeSyncService,
  ) {}

  // Static routes first so they are never captured by ':id'.

  @Get()
  @RequirePermissions('payments:read_all')
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListPaymentsQueryDto) {
    return this.payments.list(actor, query);
  }

  @Get('metrics')
  @RequirePermissions('payments:read_all')
  metrics(@CurrentUser() actor: AuthenticatedUser, @Query('warehouseId', new ParseUUIDPipe({ optional: true })) warehouseId?: string) {
    return this.payments.metrics(actor, warehouseId);
  }

  @Get('summary')
  @RequirePermissions('payments:read_all')
  summary(@CurrentUser() actor: AuthenticatedUser, @Query() query: PaymentSummaryQueryDto) {
    return this.payments.summary(actor, query);
  }

  @Get('stripe/overview')
  @RequirePermissions('payments:read_all')
  stripeOverview(@CurrentUser() actor: AuthenticatedUser) {
    return this.payments.stripeOverview(actor);
  }

  @Get('stripe/sync-runs')
  @Roles('admin')
  @RequirePermissions('payments:sync')
  syncRuns() {
    return this.sync.listRuns();
  }

  @Post('stripe/sync')
  @Roles('admin')
  @RequirePermissions('payments:sync')
  @HttpCode(HttpStatus.ACCEPTED)
  startSync(@CurrentUser() actor: AuthenticatedUser) {
    return this.sync.startInBackground('MANUAL', actor);
  }

  @Post('invoices/:invoiceId/link')
  @RequirePermissions('payments:manage')
  getPaymentLink(@Param('invoiceId', ParseUUIDPipe) invoiceId: string, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.payments.getPaymentLink(invoiceId, actor, 'get', getRequestId(req));
  }

  @Post('invoices/:invoiceId/link/regenerate')
  @RequirePermissions('payments:manage')
  regeneratePaymentLink(@Param('invoiceId', ParseUUIDPipe) invoiceId: string, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.payments.getPaymentLink(invoiceId, actor, 'regenerate', getRequestId(req));
  }

  @Post('invoices/:invoiceId/link/revoke')
  @RequirePermissions('payments:manage')
  revokePaymentLink(@Param('invoiceId', ParseUUIDPipe) invoiceId: string, @CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.payments.revokePaymentLink(invoiceId, actor, getRequestId(req));
  }

  @Post('invoices/:invoiceId/send')
  @RequirePermissions('payments:manage')
  sendInvoice(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() dto: SendInvoiceDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.payments.sendInvoice(invoiceId, actor, dto, getRequestId(req));
  }

  @Get(':id')
  @RequirePermissions('payments:read_all')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.payments.get(id, actor);
  }

  /** Admin-only (payments:refund is not granted to managers by migration 014). */
  @Post(':id/refunds')
  @Roles('admin')
  @RequirePermissions('payments:refund')
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRefundDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.payments.refund(id, actor, dto, idempotencyKey, getRequestId(req));
  }
}
