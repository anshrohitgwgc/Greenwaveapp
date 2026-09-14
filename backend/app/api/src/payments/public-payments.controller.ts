import { Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { PublicRateLimitGuard, RateLimit } from '../common/guards/public-rate-limit.guard';
import { getRequestId } from '../common/request-id';
import { PublicPaymentsService } from './public-payments.service';

/**
 * Customer-facing payment API used by pay.gwgcservers.ca. Authorized only by
 * the opaque link token; rate limited per client IP against enumeration.
 */
@Controller('public/pay')
@UseGuards(PublicRateLimitGuard)
export class PublicPaymentsController {
  constructor(private readonly payments: PublicPaymentsService) {}

  @Get(':token')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @RateLimit({ bucket: 'pay-view', limit: 60, windowSeconds: 60 })
  getInvoice(@Param('token') token: string) {
    return this.payments.getPublicInvoice(token);
  }

  @Get(':token/status')
  @RateLimit({ bucket: 'pay-status', limit: 120, windowSeconds: 60 })
  getStatus(@Param('token') token: string) {
    return this.payments.getStatus(token);
  }

  @Post(':token/intent')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ bucket: 'pay-intent', limit: 10, windowSeconds: 60 })
  createIntent(@Param('token') token: string, @Req() req: Request) {
    return this.payments.createIntent(token, getRequestId(req));
  }
}
