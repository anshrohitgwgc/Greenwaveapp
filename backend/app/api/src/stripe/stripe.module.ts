import { Module } from '@nestjs/common';

import { STRIPE_CLIENT, StripeService } from './stripe.service';

@Module({
  providers: [
    // null in every real deployment: StripeService builds its client from
    // STRIPE_SECRET_KEY. Tests override this token with a fake API client.
    { provide: STRIPE_CLIENT, useValue: null },
    StripeService,
  ],
  exports: [StripeService],
})
export class StripeModule {}
