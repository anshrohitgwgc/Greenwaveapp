/**
 * Domain types for the GreenWave business API.
 *
 * These mirror `docs/openapi.yaml`. If your backend uses different field
 * names, prefer changing the mapping in `src/api/endpoints.ts` (or adding an
 * adapter in `src/api/client.ts`) over editing screens.
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export type Role = 'admin' | 'manager' | 'driver';

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  phone?: string | null;
  active: boolean;
  createdAt: string; // ISO-8601
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until accessToken expires. */
  expiresIn: number;
}

export interface LoginResponse extends AuthTokens {
  user: User;
}

// ---------------------------------------------------------------------------
// Customers & sites
// ---------------------------------------------------------------------------

export interface Customer {
  id: string;
  name: string;
  address?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
}

// ---------------------------------------------------------------------------
// Jobs (pickups & dropoffs share one entity, split by `type`)
// ---------------------------------------------------------------------------

export type JobType = 'pickup' | 'dropoff';

export type JobStatus =
  | 'scheduled'
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export const JOB_STATUSES: JobStatus[] = [
  'scheduled',
  'assigned',
  'in_progress',
  'completed',
  'cancelled',
];

export interface Job {
  id: string;
  /** Short human reference, e.g. "GW-1042". Generated server-side. */
  reference: string;
  type: JobType;
  status: JobStatus;
  customerId: string | null;
  customerName: string | null;
  address: string | null;
  /** ISO-8601 date-time the job is scheduled for. */
  scheduledFor: string;
  assignedToId: string | null;
  assignedToName: string | null;
  notes: string | null;
  lines: JobLine[];
  photos: JobPhoto[];
  totalWeightKg: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** A material + weight row recorded against a job. */
export interface JobLine {
  id: string;
  jobId: string;
  materialId: string;
  materialName: string;
  weightKg: number;
  notes: string | null;
  recordedById: string | null;
  recordedAt: string;
}

export interface JobPhoto {
  id: string;
  jobId: string;
  /** Signed, time-limited URL served from MinIO via the API. */
  url: string;
  thumbnailUrl?: string | null;
  caption: string | null;
  uploadedById: string | null;
  uploadedAt: string;
}

export interface Material {
  id: string;
  name: string;
  /** Optional grouping, e.g. "Metals", "Plastics". */
  category: string | null;
  /** Optional price per kg, used by reporting. */
  ratePerKg: number | null;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Timesheets / staff hours
// ---------------------------------------------------------------------------

export interface Timesheet {
  id: string;
  userId: string;
  userName: string;
  clockInAt: string;
  clockOutAt: string | null;
  /** Server-computed. Null while the shift is still open. */
  durationMinutes: number | null;
  note: string | null;
}

// ---------------------------------------------------------------------------
// Request payloads
// ---------------------------------------------------------------------------

export interface CreateJobInput {
  type: JobType;
  customerId?: string | null;
  customerName?: string | null;
  address?: string | null;
  scheduledFor: string;
  assignedToId?: string | null;
  notes?: string | null;
}

export type UpdateJobInput = Partial<CreateJobInput> & {
  status?: JobStatus;
};

export interface CreateJobLineInput {
  materialId: string;
  weightKg: number;
  notes?: string | null;
}

export interface CreateStaffInput {
  email: string;
  fullName: string;
  role: Role;
  phone?: string | null;
  /** Initial password. Staff can change it after first login. */
  password: string;
}

export interface JobListQuery {
  type?: JobType;
  status?: JobStatus;
  assignedToId?: string;
  /** ISO-8601 instant — inclusive lower bound on scheduledFor. */
  from?: string;
  /** ISO-8601 instant — inclusive upper bound on scheduledFor. */
  to?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
