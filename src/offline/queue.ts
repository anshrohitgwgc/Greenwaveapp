/**
 * The offline write queue.
 *
 * A driver in a scrap yard has no signal. Everything they do there — starting
 * a job, weighing a load, taking a photo, clocking out — is captured here and
 * replayed in order when the phone reconnects.
 *
 * Ordering is the whole point: "add 340 kg of cardboard" then "mark completed"
 * must not arrive the other way round, so the flush is strictly sequential and
 * stops at the first network failure rather than skipping ahead.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { ApiError } from '@/api/client';
import { api } from '@/api/service';
import type { PickedImage } from '@/api/service';
import type { CreateJobLineInput, JobStatus } from '@/api/types';

const STORAGE_KEY = 'gw_offline_queue_v1';
const FAILURES_KEY = 'gw_offline_failures_v1';
const MAX_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type QueuedOp =
  | { kind: 'job-status'; jobId: string; jobRef: string; status: JobStatus }
  | { kind: 'job-line-add'; jobId: string; jobRef: string; input: CreateJobLineInput; materialName: string }
  | { kind: 'job-line-delete'; jobId: string; jobRef: string; lineId: string }
  | {
      kind: 'job-photo';
      jobId: string;
      jobRef: string;
      image: PickedImage;
      /** Id of the optimistic row this upload belongs to, so removing the
       *  photo before it uploads can also drop the queued work. */
      localId: string;
    }
  | { kind: 'clock-in' }
  | { kind: 'clock-out'; note?: string };

export interface QueueEntry {
  id: string;
  op: QueuedOp;
  createdAt: string;
  attempts: number;
}

export interface QueueFailure {
  id: string;
  op: QueuedOp;
  failedAt: string;
  reason: string;
}

/** Plain-language label for the pending-changes list. */
export function describeOp(op: QueuedOp): string {
  switch (op.kind) {
    case 'job-status':
      return `${op.jobRef} → ${op.status.replace('_', ' ')}`;
    case 'job-line-add':
      return `${op.jobRef} · ${op.materialName} ${op.input.weightKg} kg`;
    case 'job-line-delete':
      return `${op.jobRef} · removed a material line`;
    case 'job-photo':
      return `${op.jobRef} · 1 photo`;
    case 'clock-in':
      return 'Clock in';
    case 'clock-out':
      return 'Clock out';
  }
}

// ---------------------------------------------------------------------------
// In-memory mirror + subscriptions
// ---------------------------------------------------------------------------

let entries: QueueEntry[] = [];
let failures: QueueFailure[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function pendingEntries(): QueueEntry[] {
  return entries;
}

export function pendingCount(): number {
  return entries.length;
}

export function failedEntries(): QueueFailure[] {
  return failures;
}

let counter = 0;

/**
 * Ids must stay unique across app restarts, so they combine the enqueue
 * timestamp with a per-session counter. A bare counter would restart at 1
 * after a relaunch and collide with ids already sitting in storage.
 */
function nextId(timestamp: string): string {
  counter += 1;
  return `q_${Date.parse(timestamp) || timestamp}_${counter}`;
}

async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    await AsyncStorage.setItem(FAILURES_KEY, JSON.stringify(failures));
  } catch {
    // A full disk shouldn't take the app down; the in-memory queue still works
    // for this session.
  }
}

export async function loadQueue(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const [rawQueue, rawFailures] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(FAILURES_KEY),
    ]);
    if (rawQueue) entries = JSON.parse(rawQueue) as QueueEntry[];
    if (rawFailures) failures = JSON.parse(rawFailures) as QueueFailure[];
    notify();
  } catch {
    entries = [];
    failures = [];
  }
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

/**
 * Photos are the one thing the web build can't queue: a browser File object
 * can't be written to storage and read back later, and office staff on the
 * web app have a connection anyway.
 */
export function canQueue(op: QueuedOp): boolean {
  if (op.kind === 'job-photo' && Platform.OS === 'web') return false;
  return true;
}

export async function enqueue(op: QueuedOp, timestamp: string): Promise<void> {
  entries = [
    ...entries,
    { id: nextId(timestamp), op, createdAt: timestamp, attempts: 0 },
  ];
  notify();
  await persist();
}

export async function dismissFailures(): Promise<void> {
  failures = [];
  notify();
  await persist();
}

/**
 * Drop the queued upload for a photo the driver removed before it ever
 * reached the server. Returns true if something was actually removed.
 */
export async function dropQueuedPhoto(localId: string): Promise<boolean> {
  const before = entries.length;
  entries = entries.filter(
    (entry) => !(entry.op.kind === 'job-photo' && entry.op.localId === localId),
  );
  if (entries.length === before) return false;
  notify();
  await persist();
  return true;
}

// ---------------------------------------------------------------------------
// Flush
// ---------------------------------------------------------------------------

async function send(op: QueuedOp): Promise<void> {
  switch (op.kind) {
    case 'job-status':
      await api.setJobStatus(op.jobId, op.status);
      return;
    case 'job-line-add':
      await api.addJobLine(op.jobId, op.input);
      return;
    case 'job-line-delete':
      await api.deleteJobLine(op.jobId, op.lineId);
      return;
    case 'job-photo':
      await api.addJobPhoto(op.jobId, op.image);
      return;
    case 'clock-in':
      await api.clockIn();
      return;
    case 'clock-out':
      await api.clockOut(op.note);
      return;
  }
}

/** A 4xx means the server rejected the change itself — replaying won't help. */
function isPermanent(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 408 || error.status === 429) return false;
  return error.status >= 400 && error.status < 500;
}

function isOffline(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}

export interface FlushResult {
  sent: number;
  failed: number;
  /** True when the flush stopped early because the connection dropped again. */
  interrupted: boolean;
}

let flushing = false;

export async function flushQueue(timestamp: string): Promise<FlushResult> {
  if (flushing) return { sent: 0, failed: 0, interrupted: false };
  flushing = true;

  let sent = 0;
  let failed = 0;
  let interrupted = false;

  try {
    // Re-read `entries` each pass: an op enqueued mid-flush must still land
    // after the ones already queued ahead of it.
    while (entries.length > 0) {
      const entry = entries[0]!;

      try {
        await send(entry.op);
        entries = entries.slice(1);
        sent += 1;
        notify();
        await persist();
      } catch (error) {
        if (isOffline(error)) {
          interrupted = true;
          break;
        }

        const attempts = entry.attempts + 1;
        const giveUp = isPermanent(error) || attempts >= MAX_ATTEMPTS;

        if (giveUp) {
          failures = [
            ...failures,
            {
              id: entry.id,
              op: entry.op,
              failedAt: timestamp,
              reason:
                error instanceof Error
                  ? error.message
                  : 'The server rejected this change.',
            },
          ];
          entries = entries.slice(1);
          failed += 1;
        } else {
          entries = [{ ...entry, attempts }, ...entries.slice(1)];
          // Transient and not out of attempts — stop and retry on the next
          // reconnect rather than hammering the server now.
          interrupted = true;
        }

        notify();
        await persist();
        if (!giveUp) break;
      }
    }
  } finally {
    flushing = false;
  }

  return { sent, failed, interrupted };
}

/**
 * Wipe everything. Called on sign-out: queued work carries no identity of its
 * own, so replaying it under the next person's token would file one driver's
 * weights and shifts against another's name.
 */
export async function clearQueue(): Promise<void> {
  entries = [];
  failures = [];
  notify();
  try {
    await AsyncStorage.multiRemove([STORAGE_KEY, FAILURES_KEY]);
  } catch {
    // In-memory state is already clear, which is what matters this session.
  }
}

/** Test seam — resets module state between test cases. */
export function __resetQueueForTests(): void {
  entries = [];
  failures = [];
  loaded = false;
  flushing = false;
  counter = 0;
}
