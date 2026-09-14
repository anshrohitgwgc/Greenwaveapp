import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';

import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { isUniqueViolation, rowLock } from '../common/db-types';
import { idOf } from '../stripe/stripe-mappers';
import { StripeService } from '../stripe/stripe.service';
import { Payment } from './entities/payment.entity';
import { StripeSyncKind, StripeSyncRun } from './entities/stripe-sync-run.entity';
import { SETTLED_PAYMENT_STATUSES } from './payment-status';
import { upsertBalanceTransaction, upsertPayout } from './stripe-mirror';

const MAX_ITEMS_PER_RUN = 20_000;
const ABANDONED_RUN_MS = 30 * 60 * 1000;
const INCREMENTAL_OVERLAP_SECONDS = 3600;

/**
 * Pulls Stripe financial activity into the local mirror.
 *
 * Scope (explicit): balance transactions and payouts. Charges/refunds/disputes
 * arrive through webhooks; sync backfills fees for GreenWave payments whose fee
 * was not known at settlement, posts payouts, and counts Stripe charges that
 * have no GreenWave payment (activity outside GreenWave). It never settles an
 * invoice — real-time payment state comes only from verified webhooks.
 * All writes are idempotent upserts / exactly-once postings, so overlapping
 * windows are safe.
 */
@Injectable()
export class StripeSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StripeSyncService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(StripeSyncRun) private readonly runs: Repository<StripeSyncRun>,
    private readonly stripe: StripeService,
    private readonly posting: AccountingPostingService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const minutes = Number(this.config.get<string>('STRIPE_SYNC_INTERVAL_MINUTES'));
    if (!Number.isFinite(minutes) || minutes < 15 || !this.stripe.isPaymentsConfigured()) return;
    this.timer = setInterval(() => {
      this.run('INCREMENTAL', null).catch((err: unknown) =>
        this.logger.warn(`Scheduled Stripe sync skipped: ${(err as Error)?.message ?? 'error'}`),
      );
    }, minutes * 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  listRuns(limit = 20): Promise<StripeSyncRun[]> {
    return this.runs.find({ order: { startedAt: 'DESC' }, take: Math.min(Math.max(limit, 1), 100) });
  }

  /** Runs a sync to completion (used by the scheduler). */
  async run(kind: StripeSyncKind, actor: AuthenticatedUser | null): Promise<StripeSyncRun> {
    const run = await this.begin(kind, actor);
    return this.execute(run, actor);
  }

  /**
   * Starts a sync and returns the RUNNING record immediately, so a long
   * initial import is not bound to the HTTP request timeout. Outcome is
   * recorded on the run row.
   */
  async startInBackground(kind: StripeSyncKind, actor: AuthenticatedUser | null): Promise<StripeSyncRun> {
    const run = await this.begin(kind, actor);
    void this.execute(run, actor).catch(() => undefined);
    return run;
  }

  private async begin(kind: StripeSyncKind, actor: AuthenticatedUser | null): Promise<StripeSyncRun> {
    if (!this.stripe.isPaymentsConfigured()) throw new ServiceUnavailableException('Stripe is not configured');

    const running = await this.runs.findOne({ where: { status: 'RUNNING' } });
    if (running) {
      if (Date.now() - new Date(running.startedAt).getTime() < ABANDONED_RUN_MS) {
        throw new ConflictException('A Stripe sync is already running');
      }
      await this.runs.update(running.id, { status: 'FAILED', finishedAt: new Date(), error: 'abandoned' });
    }

    const last = await this.runs.findOne({ where: { status: 'SUCCEEDED' }, order: { startedAt: 'DESC' } });
    const now = Math.floor(Date.now() / 1000);
    const initialDays = Math.min(Math.max(Number(this.config.get<string>('STRIPE_SYNC_INITIAL_DAYS')) || 365, 1), 3650);
    const effectiveKind: StripeSyncKind = !last || kind === 'INITIAL' ? 'INITIAL' : kind;
    const fromCreated =
      effectiveKind === 'INITIAL' || !last?.toCreated ? now - initialDays * 86_400 : last.toCreated - INCREMENTAL_OVERLAP_SECONDS;

    let run: StripeSyncRun;
    try {
      run = await this.runs.save(
        this.runs.create({
          id: randomUUID(),
          kind: effectiveKind,
          status: 'RUNNING',
          startedAt: new Date(),
          finishedAt: null,
          fromCreated,
          toCreated: now,
          counts: null,
          error: null,
          triggeredBy: actor?.id ?? null,
        }),
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('A Stripe sync is already running');
      throw err;
    }

    return run;
  }

  private async execute(run: StripeSyncRun, actor: AuthenticatedUser | null): Promise<StripeSyncRun> {
    const fromCreated = run.fromCreated ?? 0;
    const now = run.toCreated ?? Math.floor(Date.now() / 1000);
    const effectiveKind = run.kind;
    const ctx = { actorId: actor?.id ?? null, requestId: null };
    const counts = { balanceTransactions: 0, feesBackfilled: 0, unmatchedCharges: 0, payouts: 0, payoutPostings: 0 };
    try {
      for await (const bt of this.stripe.listBalanceTransactions({ created: { gte: fromCreated, lte: now }, limit: 100 })) {
        if (++counts.balanceTransactions > MAX_ITEMS_PER_RUN) throw new Error('item cap reached; run again to continue');
        await this.dataSource.transaction(async (m) => {
          await upsertBalanceTransaction(m, bt);
          if (bt.type !== 'charge' && bt.type !== 'payment') return;
          const chargeId = idOf(bt.source as string | { id: string } | null);
          if (!chargeId) return;
          const repo = m.getRepository(Payment);
          const p = await repo.findOne({ where: { providerChargeId: chargeId }, lock: rowLock(m) });
          if (!p) {
            counts.unmatchedCharges++;
            return;
          }
          if (p.feeMinor === null && SETTLED_PAYMENT_STATUSES.includes(p.status) && bt.currency.toUpperCase() === p.currency) {
            p.feeMinor = bt.fee;
            p.netMinor = bt.net;
            p.providerBalanceTxnId = bt.id;
            await repo.save(p);
            await this.posting.postProcessorFee(p, bt.fee, bt.id, ctx, m);
            counts.feesBackfilled++;
          }
        });
      }

      const seen = new Set<string>();
      const payoutWindows = [{ created: { gte: fromCreated, lte: now } }, { arrival_date: { gte: fromCreated } }];
      for (const window of payoutWindows) {
        for await (const po of this.stripe.listPayouts({ ...window, limit: 100 })) {
          if (seen.has(po.id)) continue;
          seen.add(po.id);
          counts.payouts++;
          await this.dataSource.transaction(async (m) => {
            const { row } = await upsertPayout(m, po, null);
            if (row.status === 'paid') {
              const r = await this.posting.postPayoutPaid(
                { providerPayoutId: po.id, amountMinor: row.amountMinor, currency: row.currency, arrivalDate: row.arrivalDate },
                ctx,
                m,
              );
              if (r?.created) counts.payoutPostings++;
            } else if (row.status === 'failed' || row.status === 'canceled') {
              await this.posting.reversePayout(po.id, ctx, m);
            }
          });
        }
      }

      run.status = 'SUCCEEDED';
      run.counts = counts;
      run.finishedAt = new Date();
      await this.runs.save(run);
      if (actor) {
        await this.audit.record({
          actorUserId: actor.id,
          actorRole: actor.role,
          action: 'stripe.sync_completed',
          entityType: 'stripe_sync_run',
          entityId: run.id,
          summary: `${actor.email} ran a ${effectiveKind} Stripe sync`,
          metadata: counts,
        });
      }
      return run;
    } catch (err) {
      const safe = StripeService.safeError(err);
      run.status = 'FAILED';
      run.counts = counts;
      run.finishedAt = new Date();
      run.error = (safe.type !== 'UnknownError' ? `${safe.type}${safe.code ? `:${safe.code}` : ''}` : (err as Error)?.message ?? 'error').slice(0, 500);
      await this.runs.save(run);
      this.logger.error(`Stripe sync ${run.id} failed: ${run.error}`);
      throw new BadGatewayException('Stripe sync failed; see sync history for details');
    }
  }
}
