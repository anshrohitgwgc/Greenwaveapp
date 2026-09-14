import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppController } from './app.controller';
import { AccountingModule } from './accounting/accounting.module';
import { AppService } from './app.service';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BankingModule } from './banking/banking.module';
import { ChatModule } from './chat/chat.module';
import { CsrfGuard } from './common/guards/csrf.guard';
import { CustomersModule } from './customers/customers.module';
import { DivisionsModule } from './divisions/divisions.module';
import { EmployeesModule } from './employees/employees.module';
import { InventoryModule } from './inventory/inventory.module';
import { InvoicesModule } from './invoices/invoices.module';
import { MailModule } from './mail/mail.module';
import { MaterialsModule } from './materials/materials.module';
import { PayablesModule } from './payables/payables.module';
import { PaymentsModule } from './payments/payments.module';
import { PhotosModule } from './photos/photos.module';
import { PickupsModule } from './pickups/pickups.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { RedisModule } from './redis/redis.module';
import { RolesModule } from './roles/roles.module';
import { StripeModule } from './stripe/stripe.module';
import { StorageModule } from './storage/storage.module';
import { TimesheetsModule } from './timesheets/timesheets.module';
import { UsersModule } from './users/users.module';
import { WarehousesModule } from './warehouses/warehouses.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',

        host:
          config.get<string>('DATABASE_HOST') ?? config.get<string>('DB_HOST'),
        port: Number(
          config.get<string>('DATABASE_PORT') ?? config.get<string>('DB_PORT'),
        ),

        username:
          config.get<string>('DATABASE_USER') ??
          config.get<string>('DB_USERNAME'),
        password:
          config.get<string>('DATABASE_PASSWORD') ??
          config.get<string>('DB_PASSWORD'),

        database:
          config.get<string>('DATABASE_NAME') ??
          config.get<string>('DB_DATABASE'),

        autoLoadEntities: true,
        synchronize: false,
      }),
    }),

    // Global module — provides AuditService everywhere without every
    // feature module re-importing it.
    AuditModule,
    MailModule,

    UsersModule,
    AuthModule,
    ChatModule,
    RedisModule,
    StorageModule,
    PickupsModule,

    WarehousesModule,
    DivisionsModule,
    CustomersModule,
    MaterialsModule,
    InventoryModule,
    InvoicesModule,
    PurchaseOrdersModule,
    StripeModule,
    AccountingModule,
    PaymentsModule,
    PayablesModule,
    BankingModule,
    EmployeesModule,
    PhotosModule,
    TimesheetsModule,
    RolesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // CSRF is enforced for every route. Before this, CsrfGuard was provided by
    // AuthModule but never applied to any controller, so cookie-authenticated
    // mutations were not actually CSRF-checked.
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AppModule {}
