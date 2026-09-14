import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { getRequestId } from '../common/request-id';
import { WebhookVerificationError } from '../stripe/stripe.service';
import { StripeWebhookService } from './stripe-webhook.service';

/**
 * POST /api/webhooks/stripe
 *
 * Unauthenticated by session by design: the Stripe-Signature HMAC over the raw
 * body is the authentication. Nothing in the request is trusted before it is
 * verified.
 */
@Controller(['webhooks', 'payments/stripe'])
export class StripeWebhookController {
  constructor(private readonly webhooks: StripeWebhookService) {}

  @Post(['stripe', 'webhook'])
  @HttpCode(HttpStatus.OK)
  async receive(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    try {
      return await this.webhooks.handle(req.rawBody, signature, getRequestId(req));
    } catch (err) {
      if (err instanceof WebhookVerificationError) {
        if (err.reason === 'NOT_CONFIGURED') throw new ServiceUnavailableException('Webhook endpoint is not configured');
        throw new BadRequestException('Invalid webhook signature');
      }
      throw err;
    }
  }
}
