import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomBytes } from 'crypto';

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32,128}$/;
const DEFAULT_PAYMENT_BASE_URL = 'https://pay.gwgcservers.ca';

/**
 * Opaque payment-link tokens.
 *
 *   token = base64url(HMAC-SHA256(PAYMENT_LINK_SECRET, "gw-pay-link:v1:" + nonce))
 *
 * The invoice row stores the random nonce and SHA-256(token). The token encodes
 * nothing about the invoice, customer, or amount, is 256 bits of HMAC output
 * (not enumerable), and cannot be rebuilt from a database dump without the
 * secret. Lookup is by hash.
 */
@Injectable()
export class PaymentLinkService {
  private readonly logger = new Logger(PaymentLinkService.name);
  private ephemeralSecret: Buffer | null = null;

  constructor(private readonly config: ConfigService) {}

  private secret(): Buffer {
    const configured = this.config.get<string>('PAYMENT_LINK_SECRET')?.trim();
    if (configured && configured.length >= 32) return Buffer.from(configured, 'utf8');
    if (process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException('Payment links are not configured');
    }
    if (!this.ephemeralSecret) {
      this.ephemeralSecret = randomBytes(32);
      this.logger.warn('PAYMENT_LINK_SECRET is not set; using an ephemeral per-process secret (development only)');
    }
    return this.ephemeralSecret;
  }

  newNonce(): string {
    return randomBytes(32).toString('hex');
  }

  tokenForNonce(nonce: string): string {
    return createHmac('sha256', this.secret()).update(`gw-pay-link:v1:${nonce}`).digest('base64url');
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  isWellFormed(token: unknown): token is string {
    return typeof token === 'string' && TOKEN_SHAPE.test(token);
  }

  baseUrl(): string {
    const configured = this.config.get<string>('PUBLIC_PAYMENT_BASE_URL')?.trim() || DEFAULT_PAYMENT_BASE_URL;
    const url = configured.replace(/\/+$/, '');
    if (process.env.NODE_ENV === 'production' && !url.startsWith('https://')) {
      throw new ServiceUnavailableException('PUBLIC_PAYMENT_BASE_URL must be https in production');
    }
    return url;
  }

  urlForToken(token: string): string {
    return `${this.baseUrl()}/p/${token}`;
  }
}
