/** GreenWave payment lifecycle. Values match chk_payments_status (migration 019). */
export const PAYMENT_STATUSES = [
  'CREATED',
  'REQUIRES_ACTION',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'DISPUTED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** An attempt that can still complete. At most one per invoice (DB-enforced). */
export const OPEN_PAYMENT_STATUSES: readonly PaymentStatus[] = ['CREATED', 'REQUIRES_ACTION', 'PROCESSING'];

/** Money was captured. At most one per invoice (DB-enforced). */
export const SETTLED_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'SUCCEEDED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'DISPUTED',
];

/**
 * Invoice payment_status vocabulary (legacy lowercase column, kept). This is
 * the *payable* state; refund/dispute detail lives on the payment row.
 * There is intentionally no partially_paid: checkout is exact-full-payment only.
 */
export const INVOICE_PAYMENT_STATUSES = [
  'unpaid',
  'processing',
  'paid',
  'failed',
  'refunded',
  'partially_refunded',
  'disputed',
] as const;
export type InvoicePaymentStatus = (typeof INVOICE_PAYMENT_STATUSES)[number];

/**
 * Invoice document statuses that are closed and can never be paid or issued.
 * 'draft' is deliberately NOT here: a draft is not payable yet, but issuing a
 * payment link or sending it turns it into a receivable. Call sites that must
 * reject drafts check `status === 'draft'` explicitly.
 */
export const NON_PAYABLE_INVOICE_STATUSES = ['void', 'cancelled', 'canceled'];
