import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EmailOutbox } from './entities/email-outbox.entity';
import { MAIL_TRANSPORT, MailService } from './mail.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([EmailOutbox])],
  // MAIL_TRANSPORT is null in deployments (SMTP is configured from env);
  // tests override it with a capturing fake.
  providers: [{ provide: MAIL_TRANSPORT, useValue: null }, MailService],
  exports: [MailService],
})
export class MailModule {}
