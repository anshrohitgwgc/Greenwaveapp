import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ProcessRefundDto } from './dto/process-refund.dto';
import { SendInvoiceEmailDto } from './dto/send-invoice-email.dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'manager')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('metrics')
  getMetrics(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.paymentsService.getPaymentMetrics(actor, warehouseId);
  }

  @Post('invoices/:invoiceId/link')
  getPaymentLink(
    @Param('invoiceId') invoiceId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paymentsService.getOrCreatePaymentLink(invoiceId, actor);
  }

  @Post('invoices/:invoiceId/send')
  sendInvoiceEmail(
    @Param('invoiceId') invoiceId: string,
    @Body() dto: SendInvoiceEmailDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paymentsService.sendInvoiceEmail(invoiceId, actor, dto);
  }

  @Post('refund/:paymentId')
  refundPayment(
    @Param('paymentId') paymentId: string,
    @Body() dto: ProcessRefundDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paymentsService.refundPayment(paymentId, actor, dto);
  }
}
