import type Stripe from 'stripe';

import type { RefundStatus } from '../payments/entities/payment-refund.entity';
import type { PaymentStatus } from '../payments/payment-status';

function titleCase(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Display-safe payment method description. Only brand/type and last four. */
export function describePaymentMethod(charge: Stripe.Charge | null | undefined): {
  type: string | null;
  display: string | null;
} {
  const details = charge?.payment_method_details;
  if (!details) return { type: null, display: null };
  const type = details.type;
  if (details.card) {
    const brand = details.card.brand ? titleCase(details.card.brand) : 'Card';
    return { type, display: details.card.last4 ? `${brand} •••• ${details.card.last4}` : brand };
  }
  if (details.acss_debit?.last4) return { type, display: `Pre-authorized debit •••• ${details.acss_debit.last4}` };
  if (details.us_bank_account?.last4) return { type, display: `Bank account •••• ${details.us_bank_account.last4}` };
  if (details.link) return { type, display: 'Link' };
  return { type, display: titleCase(type) };
}

export function mapIntentStatus(status: Stripe.PaymentIntent.Status): PaymentStatus {
  switch (status) {
    case 'requires_action':
      return 'REQUIRES_ACTION';
    case 'processing':
      return 'PROCESSING';
    case 'canceled':
      return 'CANCELED';
    case 'succeeded':
      // Never trusted from an API response alone; the webhook path settles.
      return 'PROCESSING';
    default:
      return 'CREATED';
  }
}

export function mapRefundStatus(status: string | null | undefined): RefundStatus {
  switch (status) {
    case 'succeeded':
      return 'SUCCEEDED';
    case 'failed':
      return 'FAILED';
    case 'canceled':
      return 'CANCELED';
    case 'requires_action':
      return 'REQUIRES_ACTION';
    default:
      return 'PENDING';
  }
}

export function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}
