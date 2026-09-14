import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import * as nodemailer from 'nodemailer';
import { Repository } from 'typeorm';

import { isUniqueViolation } from '../common/db-types';
import { EmailOutbox } from './entities/email-outbox.entity';

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

export interface OutboundAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface OutboundMessage {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  attachments?: OutboundAttachment[];
}

/** Anything that can deliver a message. SMTP in production; a fake in tests. */
export interface MailTransport {
  send(message: OutboundMessage): Promise<{ messageId?: string }>;
}

export interface SendOnceInput {
  dedupeKey: string;
  template: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: OutboundAttachment[];
  entityType?: string;
  entityId?: string;
}

export type SendOnceResult =
  | { status: 'SENT'; outboxId: string }
  | { status: 'SKIPPED'; outboxId: string; reason: string }
  | { status: 'FAILED'; outboxId: string; reason: string }
  | { status: 'DUPLICATE'; outboxId: string | null };

const DEFAULT_FROM = 'GreenWave Recycling <sales@greenwaverecycling.ca>';
const DEFAULT_SALES = 'sales@greenwaverecycling.ca';
const STALE_PENDING_MS = 10 * 60 * 1000;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export function isDeliverableAddress(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value);
}

/**
 * Transactional email with exactly-once intent per dedupe key.
 *
 * If SMTP is not configured the message is recorded as SKIPPED — never
 * reported as sent. Transport errors are stored as a short code, never the
 * raw server response (which can echo auth details).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transport: MailTransport | null;

  constructor(
    @InjectRepository(EmailOutbox) private readonly outbox: Repository<EmailOutbox>,
    private readonly config: ConfigService,
    @Optional() @Inject(MAIL_TRANSPORT) injected?: MailTransport,
  ) {
    this.transport = injected ?? null;
  }

  private read(name: string): string | undefined {
    const v = this.config.get<string>(name);
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  }

  isConfigured(): boolean {
    return !!this.transport || !!this.read('SMTP_HOST');
  }

  fromAddress(): string {
    return this.read('MAIL_FROM') ?? DEFAULT_FROM;
  }

  salesAddress(): string {
    return this.read('MAIL_SALES_NOTIFY') ?? DEFAULT_SALES;
  }

  private getTransport(): MailTransport | null {
    if (this.transport) return this.transport;
    const host = this.read('SMTP_HOST');
    if (!host) return null;
    const port = Number(this.read('SMTP_PORT') ?? 587);
    const user = this.read('SMTP_USER');
    const pass = this.read('SMTP_PASSWORD');
    const smtp = nodemailer.createTransport({
      host,
      port,
      secure: (this.read('SMTP_SECURE') ?? (port === 465 ? 'true' : 'false')) === 'true',
      requireTLS: port !== 465,
      auth: user && pass ? { user, pass } : undefined,
      tls: { minVersion: 'TLSv1.2' },
    });
    this.transport = {
      send: async (m) => {
        const info = await smtp.sendMail(m);
        return { messageId: info.messageId };
      },
    };
    return this.transport;
  }

  async sendOnce(input: SendOnceInput): Promise<SendOnceResult> {
    if (!isDeliverableAddress(input.to)) {
      throw new RangeError('Invalid recipient email address');
    }
    const subject = input.subject.replace(/[\r\n]+/g, ' ').slice(0, 255);

    let row = await this.outbox.findOne({ where: { dedupeKey: input.dedupeKey } });
    if (row) {
      const stalePending =
        row.status === 'PENDING' && Date.now() - new Date(row.createdAt).getTime() > STALE_PENDING_MS;
      if (row.status !== 'FAILED' && !stalePending) {
        return { status: 'DUPLICATE', outboxId: row.id };
      }
    } else {
      try {
        row = await this.outbox.save(
          this.outbox.create({
            id: randomUUID(),
            dedupeKey: input.dedupeKey,
            template: input.template,
            recipient: input.to,
            subject,
            status: 'PENDING',
            entityType: input.entityType ?? null,
            entityId: input.entityId ?? null,
            attempts: 0,
          }),
        );
      } catch (err) {
        if (isUniqueViolation(err)) return { status: 'DUPLICATE', outboxId: null };
        throw err;
      }
    }

    const transport = this.getTransport();
    if (!transport) {
      const reason = 'SMTP transport not configured';
      await this.outbox.update(row.id, { status: 'SKIPPED', lastError: reason });
      this.logger.warn(`Email ${input.template} not sent (${reason}); outbox ${row.id}`);
      return { status: 'SKIPPED', outboxId: row.id, reason };
    }

    try {
      const info = await transport.send({
        from: this.fromAddress(),
        replyTo: this.salesAddress(),
        to: input.to,
        subject,
        text: input.text,
        html: input.html,
        attachments: input.attachments,
      });
      await this.outbox.update(row.id, {
        status: 'SENT',
        attempts: row.attempts + 1,
        sentAt: new Date(),
        lastError: null,
        providerMessageId: info.messageId?.slice(0, 255) ?? null,
      });
      return { status: 'SENT', outboxId: row.id };
    } catch (err) {
      const e = err as { code?: string; responseCode?: number };
      const reason = `${e?.code ?? 'SEND_FAILED'}${e?.responseCode ? ` (${e.responseCode})` : ''}`;
      await this.outbox.update(row.id, { status: 'FAILED', attempts: row.attempts + 1, lastError: reason });
      this.logger.error(`Email ${input.template} failed: ${reason}; outbox ${row.id}`);
      return { status: 'FAILED', outboxId: row.id, reason };
    }
  }
}
