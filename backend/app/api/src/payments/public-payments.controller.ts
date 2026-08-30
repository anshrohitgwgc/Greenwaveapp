import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { PaymentsService } from './payments.service';

@Controller()
export class PublicPaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Public: Customer accesses invoice by secure unpredictable token.
   */
  @Get('pay/:token')
  getPublicInvoice(@Param('token') token: string) {
    return this.paymentsService.getPublicInvoiceByToken(token);
  }

  /**
   * Public: Customer initiates checkout.
   */
  @Post('pay/:token/checkout')
  createCheckoutSession(@Param('token') token: string) {
    return this.paymentsService.createCheckoutSession(token);
  }

  /**
   * Public Webhook Receiver for Stripe / payment provider.
   */
  @Post(['payments/webhook', 'pay/webhook'])
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    const rawReq = req as unknown as { rawBody?: Buffer | string };
    const rawBody: string = rawReq.rawBody
      ? rawReq.rawBody.toString('utf8')
      : typeof body === 'string'
        ? body
        : JSON.stringify(body);

    return this.paymentsService.handleWebhook(signature, rawBody, body);
  }
}
