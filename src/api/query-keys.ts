/**
 * Query keys live in their own module so the optimistic-update helpers can
 * patch the cache without importing the hooks that call them (which would be
 * an import cycle).
 */

import type { JobListQuery } from './types';

export const queryKeys = {
  jobs: (query: JobListQuery) => ['jobs', query] as const,
  job: (jobId: string) => ['job', jobId] as const,
  materials: ['materials'] as const,
  customers: (search?: string) => ['customers', search ?? ''] as const,
  staff: ['staff'] as const,
  activeTimesheet: ['timesheet', 'active'] as const,
  timesheets: (params: { userId?: string; from?: string; to?: string }) =>
    ['timesheets', params] as const,
  today: ['today-summary'] as const,
};
