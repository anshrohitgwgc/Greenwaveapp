import { randomUUID } from 'crypto';
import type Stripe from 'stripe';
import type { EntityManager } from 'typeorm';

import { idOf } from '../stripe/stripe-mappers';
import { StripeBalanceTransaction } from './entities/stripe-balance-transaction.entity';
import { StripeDispute } from './entities/stripe-dispute.entity';
import { StripePayout } from './entities/stripe-payout.entity';

/**
 * Idempotent upserts of Stripe objects into the local mirror, shared by the
 * webhook processor and the sync job. `eventCreated` (webhooks) guards against
 * an older event overwriting newer state; sync passes null because a list
 * call returns current state.
 */

const toDate = (seconds: number | null | undefined): Date | null => (seconds ? new Date(seconds * 1000) : null);

export async function upsertBalanceTransaction(
  m: EntityManager,
  bt: Stripe.BalanceTransaction,
  payoutId?: string | null,
): Promise<StripeBalanceTransaction> {
  const repo = m.getRepository(StripeBalanceTransaction);
  const existing = await repo.findOne({ where: { providerTxnId: bt.id } });
  const fields = {
    type: bt.type,
    reportingCategory: bt.reporting_category ?? null,
    amountMinor: bt.amount,
    feeMinor: bt.fee,
    netMinor: bt.net,
    currency: bt.currency.toUpperCase(),
    status: bt.status,
    sourceId: idOf(bt.source as string | { id: string } | null),
    description: bt.description ? bt.description.slice(0, 255) : null,
    providerCreated: new Date(bt.created * 1000),
    availableOn: toDate(bt.available_on),
    syncedAt: new Date(),
  };
  if (existing) {
    Object.assign(existing, fields);
    if (payoutId !== undefined) existing.payoutId = payoutId;
    return repo.save(existing);
  }
  return repo.save(repo.create({ id: randomUUID(), providerTxnId: bt.id, payoutId: payoutId ?? null, ...fields }));
}

export async function upsertPayout(
  m: EntityManager,
  po: Stripe.Payout,
  eventCreated: number | null,
): Promise<{ row: StripePayout; stale: boolean }> {
  const repo = m.getRepository(StripePayout);
  const existing = await repo.findOne({ where: { providerPayoutId: po.id } });
  const stale =
    eventCreated !== null && existing?.lastEventCreated != null && eventCreated < existing.lastEventCreated;
  if (existing && stale) {
    existing.syncedAt = new Date();
    return { row: await repo.save(existing), stale: true };
  }
  const fields = {
    amountMinor: po.amount,
    currency: po.currency.toUpperCase(),
    status: po.status,
    method: po.method ?? null,
    arrivalDate: toDate(po.arrival_date),
    providerCreated: new Date(po.created * 1000),
    failureCode: po.failure_code ?? null,
    lastEventCreated: eventCreated ?? existing?.lastEventCreated ?? null,
    syncedAt: new Date(),
  };
  if (existing) {
    Object.assign(existing, fields);
    return { row: await repo.save(existing), stale: false };
  }
  const row = await repo.save(
    repo.create({ id: randomUUID(), providerPayoutId: po.id, destinationDisplay: null, ...fields }),
  );
  return { row, stale: false };
}

export async function upsertDispute(
  m: EntityManager,
  d: Stripe.Dispute,
  paymentId: string | null,
  eventCreated: number | null,
): Promise<{ row: StripeDispute; stale: boolean }> {
  const repo = m.getRepository(StripeDispute);
  const existing = await repo.findOne({ where: { providerDisputeId: d.id } });
  const stale =
    eventCreated !== null && existing?.lastEventCreated != null && eventCreated < existing.lastEventCreated;
  if (existing && stale) {
    existing.syncedAt = new Date();
    if (!existing.paymentId && paymentId) existing.paymentId = paymentId;
    return { row: await repo.save(existing), stale: true };
  }
  const fields = {
    paymentId: paymentId ?? existing?.paymentId ?? null,
    providerChargeId: idOf(d.charge),
    amountMinor: d.amount,
    currency: d.currency.toUpperCase(),
    status: d.status,
    reason: d.reason ?? null,
    evidenceDueBy: toDate(d.evidence_details?.due_by),
    providerCreated: new Date(d.created * 1000),
    lastEventCreated: eventCreated ?? existing?.lastEventCreated ?? null,
    syncedAt: new Date(),
  };
  if (existing) {
    Object.assign(existing, fields);
    return { row: await repo.save(existing), stale: false };
  }
  return { row: await repo.save(repo.create({ id: randomUUID(), providerDisputeId: d.id, ...fields })), stale: false };
}
