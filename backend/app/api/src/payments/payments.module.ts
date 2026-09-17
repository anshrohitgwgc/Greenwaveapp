import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountingModule } from '../accounting/accounting.module';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { PublicRateLimitGuard } from '../common/guards/public-rate-limit.guard';
import { RecyclingFinanceGuard } from '../common/guards/recycling-finance.guard';
import { Customer } from '../customers/entities/customer.entity';
import { DivisionsModule } from '../divisions/divisions.module';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoicesModule } from '../invoices/invoices.module';
import { MailModule } from '../mail/mail.module';
import { RedisModule } from '../redis/redis.module';
import { StripeModule } from '../stripe/stripe.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { PaymentRefund } from './entities/payment-refund.entity';
import { Payment } from './entities/payment.entity';
import { ProviderEvent } from './entities/provider-event.entity';
import { StripeBalanceTransaction } from './entities/stripe-balance-transaction.entity';
import { StripeDispute } from './entities/stripe-dispute.entity';
import { StripePayout } from './entities/stripe-payout.entity';
import { StripeSyncRun } from './entities/stripe-sync-run.entity';
import { PaymentLinkService } from './payment-link.service';
import { PaymentNotificationsService } from './payment-notifications.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PublicPaymentsController } from './public-payments.controller';
import { PublicPaymentsService } from './public-payments.service';
import { StripeSyncService } from './stripe-sync.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';

export const PAYMENT_ENTITIES = [
  Payment,
  PaymentRefund,
  ProviderEvent,
  StripeBalanceTransaction,
  StripePayout,
  StripeDispute,
  StripeSyncRun,
];

@Module({
  imports: [
    TypeOrmModule.forFeature([...PAYMENT_ENTITIES, Invoice, Customer]),
    WarehousesModule,
    DivisionsModule,
    InvoicesModule,
    AccountingModule,
    MailModule,
    StripeModule,
    RedisModule,
  ],
  controllers: [PaymentsController, PublicPaymentsController, StripeWebhookController],
  providers: [
    PaymentsService,
    PublicPaymentsService,
    StripeWebhookService,
    StripeSyncService,
    PaymentLinkService,
    PaymentNotificationsService,
    PublicRateLimitGuard,
    PermissionsGuard,
    RecyclingFinanceGuard,
  ],
  exports: [PaymentsService, PaymentLinkService],
})
export class PaymentsModule {}
