/**
 * Cache patches applied when a write is queued rather than sent.
 *
 * Without these, a driver who records 340 kg with no signal sees the screen do
 * nothing at all — the worst possible feedback. These write the change into the
 * React Query cache immediately so the UI matches what the driver just did; the
 * queue makes it true on the server later.
 *
 * Anything created this way carries a `pending: true` flag so screens can mark
 * it as not-yet-synced.
 */

import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/api/query-keys';
import type {
  CreateJobLineInput,
  Job,
  JobLine,
  JobPhoto,
  JobStatus,
  Timesheet,
} from '@/api/types';

/** Marker on optimistic rows. Real rows from the API never have it. */
export interface Pending {
  pending?: boolean;
}

let localCounter = 0;

/**
 * Id for a row that exists only on this device so far. The `local_` prefix is
 * load-bearing: screens use it to tell "not synced yet" from a real server id,
 * and the queue never sends it anywhere.
 */
export function localId(prefix: string): string {
  localCounter += 1;
  return `local_${prefix}_${Date.now()}_${localCounter}`;
}

export function isLocalId(id: string): boolean {
  return id.startsWith('local_');
}

export type PendingJobLine = JobLine & Pending;
export type PendingJobPhoto = JobPhoto & Pending;

function patchJob(
  client: QueryClient,
  jobId: string,
  patch: (job: Job) => Job,
): void {
  client.setQueryData<Job>(queryKeys.job(jobId), (job) => (job ? patch(job) : job));

  // The same job also sits inside every cached list page.
  client.setQueriesData<{ items: Job[] }>({ queryKey: ['jobs'] }, (page) => {
    if (!page?.items) return page;
    return {
      ...page,
      items: page.items.map((job) => (job.id === jobId ? patch(job) : job)),
    };
  });
}

function recalcTotal(lines: JobLine[]): number {
  return Number(lines.reduce((sum, line) => sum + line.weightKg, 0).toFixed(2));
}

export function optimisticAddLine(
  client: QueryClient,
  jobId: string,
  input: CreateJobLineInput,
  materialName: string,
  userId: string | null,
  timestamp: string,
  localId: string,
): void {
  const line: PendingJobLine = {
    id: localId,
    jobId,
    materialId: input.materialId,
    materialName,
    weightKg: input.weightKg,
    notes: input.notes ?? null,
    recordedById: userId,
    recordedAt: timestamp,
    pending: true,
  };

  patchJob(client, jobId, (job) => {
    const lines = [...job.lines, line];
    return { ...job, lines, totalWeightKg: recalcTotal(lines), updatedAt: timestamp };
  });
}

export function optimisticRemoveLine(
  client: QueryClient,
  jobId: string,
  lineId: string,
  timestamp: string,
): void {
  patchJob(client, jobId, (job) => {
    const lines = job.lines.filter((line) => line.id !== lineId);
    return { ...job, lines, totalWeightKg: recalcTotal(lines), updatedAt: timestamp };
  });
}

export function optimisticStatus(
  client: QueryClient,
  jobId: string,
  status: JobStatus,
  timestamp: string,
): void {
  patchJob(client, jobId, (job) => ({
    ...job,
    status,
    completedAt: status === 'completed' ? timestamp : null,
    updatedAt: timestamp,
  }));
}

export function optimisticAddPhoto(
  client: QueryClient,
  jobId: string,
  localUri: string,
  userId: string | null,
  timestamp: string,
  localId: string,
): void {
  const photo: PendingJobPhoto = {
    id: localId,
    jobId,
    url: localUri,
    thumbnailUrl: localUri,
    caption: null,
    uploadedById: userId,
    uploadedAt: timestamp,
    pending: true,
  };
  patchJob(client, jobId, (job) => ({
    ...job,
    photos: [...job.photos, photo],
    updatedAt: timestamp,
  }));
}

export function optimisticClockIn(
  client: QueryClient,
  userId: string,
  userName: string,
  timestamp: string,
  localId: string,
): void {
  const sheet: Timesheet = {
    id: localId,
    userId,
    userName,
    clockInAt: timestamp,
    clockOutAt: null,
    durationMinutes: null,
    note: null,
  };
  client.setQueryData(queryKeys.activeTimesheet, sheet);
}

export function optimisticClockOut(
  client: QueryClient,
  timestamp: string,
  note?: string,
): void {
  const open = client.getQueryData<Timesheet | null>(queryKeys.activeTimesheet);

  // No active shift is now the truth, whatever else happens below.
  client.setQueryData(queryKeys.activeTimesheet, null);
  if (!open) return;

  const closed: Timesheet = {
    ...open,
    clockOutAt: timestamp,
    durationMinutes: Math.max(
      1,
      Math.round(
        (new Date(timestamp).getTime() - new Date(open.clockInAt).getTime()) / 60000,
      ),
    ),
    note: note ?? open.note,
  };

  // Offline, the history list can't refetch — so patch the closed shift into
  // whatever pages are already cached.
  client.setQueriesData<Timesheet[]>({ queryKey: ['timesheets'] }, (sheets) => {
    if (!sheets) return sheets;
    const without = sheets.filter((sheet) => sheet.id !== closed.id);
    return [closed, ...without];
  });
}
