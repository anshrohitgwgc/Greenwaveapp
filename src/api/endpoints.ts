/**
 * THE ONE FILE TO EDIT when your API's routes differ.
 *
 * Every network path the app uses is declared here. Nothing else in the
 * codebase hardcodes a URL. If your backend calls a pickup a "collection"
 * or nests weights under a different path, change it here and the whole
 * app follows.
 *
 * Paths are relative to `config.apiBaseUrl`.
 */

import type { JobListQuery } from './types';

function qs(params: Record<string, string | number | undefined | null>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export const endpoints = {
  auth: {
    login: () => '/auth/login',
    refresh: () => '/auth/refresh',
    me: () => '/auth/me',
    logout: () => '/auth/logout',
    changePassword: () => '/auth/change-password',
  },

  jobs: {
    list: (query: JobListQuery = {}) =>
      `/jobs${qs({
        type: query.type,
        status: query.status,
        assignedToId: query.assignedToId,
        from: query.from,
        to: query.to,
        search: query.search,
        page: query.page,
        pageSize: query.pageSize,
      })}`,
    detail: (jobId: string) => `/jobs/${encodeURIComponent(jobId)}`,
    create: () => '/jobs',
    update: (jobId: string) => `/jobs/${encodeURIComponent(jobId)}`,
    setStatus: (jobId: string) => `/jobs/${encodeURIComponent(jobId)}/status`,

    // Material + weight rows
    lines: (jobId: string) => `/jobs/${encodeURIComponent(jobId)}/lines`,
    line: (jobId: string, lineId: string) =>
      `/jobs/${encodeURIComponent(jobId)}/lines/${encodeURIComponent(lineId)}`,

    // Photos (multipart upload, stored in MinIO by the API)
    photos: (jobId: string) => `/jobs/${encodeURIComponent(jobId)}/photos`,
    photo: (jobId: string, photoId: string) =>
      `/jobs/${encodeURIComponent(jobId)}/photos/${encodeURIComponent(photoId)}`,
  },

  materials: {
    list: () => '/materials',
    create: () => '/materials',
    update: (materialId: string) => `/materials/${encodeURIComponent(materialId)}`,
  },

  customers: {
    list: (search?: string) => `/customers${qs({ search })}`,
    create: () => '/customers',
    update: (customerId: string) => `/customers/${encodeURIComponent(customerId)}`,
  },

  devices: {
    /** Register this device for push notifications. */
    register: () => '/devices/push-token',
    unregister: () => '/devices/push-token',
  },

  staff: {
    list: () => '/staff',
    create: () => '/staff',
    detail: (userId: string) => `/staff/${encodeURIComponent(userId)}`,
    update: (userId: string) => `/staff/${encodeURIComponent(userId)}`,
    resetPassword: (userId: string) =>
      `/staff/${encodeURIComponent(userId)}/password`,
  },

  timesheets: {
    /** The caller's currently-open shift, or 404/null if clocked out. */
    active: () => '/timesheets/active',
    clockIn: () => '/timesheets/clock-in',
    clockOut: () => '/timesheets/clock-out',
    list: (params: { userId?: string; from?: string; to?: string } = {}) =>
      `/timesheets${qs(params)}`,
  },
} as const;
