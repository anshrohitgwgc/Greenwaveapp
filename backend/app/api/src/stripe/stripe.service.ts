import {
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/** Pinned so a Stripe-side default change cannot silently alter payloads. */
export const STRIPE_API_VERSION = '2025-08-27.basil' as const;

/** Test seam: provide a pre-built client instead of reading STRIPE_SECRET_KEY. */
export const STRIPE_CLIENT = Symbol('STRIPE_CLIENT');

/** Signature timestamp tolerance, seconds (Stripe's recommended default). */
const WEBHOOK_TOLERANCE_SECONDS = 300;

export type StripeMode = 'live' | 'test';

export class WebhookVerificationError extends Error {
  constructor(readonly reason: 'NOT_CONFIGURED' | 'MISSING_SIGNATURE' | 'INVALID_SIGNATURE') {
    super(`Webhook verification failed: ${reason}`);
  }
}

/** The only shape of a Stripe error that is ever logged or returned. */
export interface SafeStripeError {
  type: string;
  code: string | null;
  declineCode: string | null;
  statusCode: number | null;
  requestId: string | null;
}

function modeOfKey(key: string | undefined): StripeMode | null {
  if (!key) return null;
  if (/^(sk|rk|pk)_live_/.test(key)) return 'live';
  if (/^(sk|rk|pk)_test_/.test(key)) return 'test';
  return null;
}

/**
 * Backend-only Stripe gateway. The secret key and webhook signing secret are
 * read from configuration at call time, are never logged, and never leave this
 * class. There is deliberately no fallback secret: an unconfigured deployment
 * refuses to verify webhooks instead of verifying them against a known string.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private client: Stripe | null;

  constructor(
    private readonly config: ConfigService,
    @Optional() @Inject(STRIPE_CLIENT) injectedClient?: Stripe,
  ) {
    this.client = injectedClient ?? null;
  }

  private read(name: string): string | undefined {
    const value = this.config.get<string>(name);
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  /** True when payments can be created (secret key present and well-formed). */
  isPaymentsConfigured(): boolean {
    if (this.client) return true;
    const key = this.read('STRIPE_SECRET_KEY');
    return !!key && modeOfKey(key) !== null && !key.startsWith('pk_');
  }

  isWebhookConfigured(): boolean {
    return !!this.read('STRIPE_WEBHOOK_SECRET');
  }

  mode(): StripeMode | null {
    return modeOfKey(this.read('STRIPE_SECRET_KEY'));
  }

  /**
   * Browser-safe configuration. Returns the publishable key only when it is a
   * real `pk_` key of the same mode as the secret key, so a live page can never
   * be paired with a test backend (or vice versa).
   */
  publicConfig(): { publishableKey: string | null; mode: StripeMode | null } {
    const pk = this.read('STRIPE_PUBLISHABLE_KEY');
    const pkMode = pk && pk.startsWith('pk_') ? modeOfKey(pk) : null;
    const skMode = this.mode();
    if (!pk || !pkMode) return { publishableKey: null, mode: skMode };
    if (skMode && pkMode !== skMode) {
      this.logger.error('Stripe publishable key mode does not match secret key mode; online payments disabled');
      return { publishableKey: null, mode: skMode };
    }
    return { publishableKey: pk, mode: pkMode };
  }

  getClient(): Stripe {
    if (this.client) return this.client;
    const key = this.read('STRIPE_SECRET_KEY');
    if (!key || key.startsWith('pk_') || modeOfKey(key) === null) {
      throw new ServiceUnavailableException('Online payments are not configured');
    }
    if (process.env.NODE_ENV === 'production' && modeOfKey(key) === 'test') {
      this.logger.warn('Stripe is running in TEST mode in a production environment');
    }
    this.client = new Stripe(key, {
      apiVersion: STRIPE_API_VERSION,
      maxNetworkRetries: 2,
      timeout: 20_000,
      telemetry: false,
      appInfo: { name: 'GreenWave Operations' },
    });
    return this.client;
  }

  /**
   * Verifies `Stripe-Signature` over the exact raw bytes and returns the event.
   * Uses the library's constant-time HMAC check and timestamp tolerance.
   */
  constructWebhookEvent(rawBody: Buffer | string | undefined, signature: string | undefined): Stripe.Event {
    const secret = this.read('STRIPE_WEBHOOK_SECRET');
    if (!secret) throw new WebhookVerificationError('NOT_CONFIGURED');
    if (!signature || rawBody === undefined || rawBody.length === 0) {
      throw new WebhookVerificationError('MISSING_SIGNATURE');
    }
    try {
      return Stripe.webhooks.constructEvent(rawBody, signature, secret, WEBHOOK_TOLERANCE_SECONDS);
    } catch {
      throw new WebhookVerificationError('INVALID_SIGNATURE');
    }
  }

  createPaymentIntent(params: Stripe.PaymentIntentCreateParams, idempotencyKey: string) {
    return this.getClient().paymentIntents.create(params, { idempotencyKey });
  }

  retrievePaymentIntent(id: string) {
    return this.getClient().paymentIntents.retrieve(id, {
      expand: ['latest_charge.balance_transaction', 'payment_method'],
    });
  }

  cancelPaymentIntent(id: string, idempotencyKey: string) {
    return this.getClient().paymentIntents.cancel(id, {}, { idempotencyKey });
  }

  createRefund(params: Stripe.RefundCreateParams, idempotencyKey: string) {
    return this.getClient().refunds.create(params, { idempotencyKey });
  }

  retrieveCharge(id: string) {
    return this.getClient().charges.retrieve(id, { expand: ['balance_transaction'] });
  }

  retrieveBalanceTransaction(id: string) {
    return this.getClient().balanceTransactions.retrieve(id);
  }

  retrieveBalance() {
    return this.getClient().balance.retrieve();
  }

  listBalanceTransactions(params: Stripe.BalanceTransactionListParams) {
    return this.getClient().balanceTransactions.list(params);
  }

  listPayouts(params: Stripe.PayoutListParams) {
    return this.getClient().payouts.list(params);
  }

  /** Reduces any thrown value to non-sensitive diagnostic fields. */
  static safeError(err: unknown): SafeStripeError {
    const e = err as Partial<Stripe.errors.StripeError> & { type?: string };
    return {
      type: typeof e?.type === 'string' ? e.type : 'UnknownError',
      code: typeof e?.code === 'string' ? e.code : null,
      declineCode: typeof e?.decline_code === 'string' ? e.decline_code : null,
      statusCode: typeof e?.statusCode === 'number' ? e.statusCode : null,
      requestId: typeof e?.requestId === 'string' ? e.requestId : null,
    };
  }
}
