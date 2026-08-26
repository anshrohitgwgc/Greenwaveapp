/**
 * In-memory mock backend.
 *
 * Active when EXPO_PUBLIC_USE_MOCK=1. It implements exactly the same function
 * surface as the real service so every screen can be built and demoed before
 * the business API exists. Data resets when the app reloads.
 */

import { ApiError } from './client';
import type {
  CreateJobInput,
  CreateJobLineInput,
  CreateStaffInput,
  Customer,
  Job,
  JobLine,
  JobListQuery,
  JobPhoto,
  JobStatus,
  LoginResponse,
  Material,
  Paginated,
  Timesheet,
  UpdateJobInput,
  User,
} from './types';

const LATENCY_MS = 320;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

let counter = 1000;
const nextId = (prefix: string) => `${prefix}_${++counter}`;

function isoDaysFromNow(days: number, hour = 9): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

// --- seed data --------------------------------------------------------------

const users: User[] = [
  {
    id: 'usr_1',
    email: 'admin@gwgc.cloud',
    fullName: 'Ansh Bapu',
    role: 'admin',
    phone: '+1 604 555 0101',
    active: true,
    createdAt: isoDaysFromNow(-120),
  },
  {
    id: 'usr_2',
    email: 'manager@gwgc.cloud',
    fullName: 'Priya Sharma',
    role: 'manager',
    phone: '+1 604 555 0102',
    active: true,
    createdAt: isoDaysFromNow(-90),
  },
  {
    id: 'usr_3',
    email: 'driver@gwgc.cloud',
    fullName: 'Marcus Lee',
    role: 'driver',
    phone: '+1 604 555 0103',
    active: true,
    createdAt: isoDaysFromNow(-60),
  },
  {
    id: 'usr_4',
    email: 'driver2@gwgc.cloud',
    fullName: 'Dan Okafor',
    role: 'driver',
    phone: '+1 604 555 0104',
    active: true,
    createdAt: isoDaysFromNow(-45),
  },
];

const materials: Material[] = [
  { id: 'mat_1', name: 'Mixed Paper', category: 'Paper', ratePerKg: 0.12, active: true },
  { id: 'mat_2', name: 'Cardboard (OCC)', category: 'Paper', ratePerKg: 0.15, active: true },
  { id: 'mat_3', name: 'Aluminium Cans', category: 'Metals', ratePerKg: 1.35, active: true },
  { id: 'mat_4', name: 'Copper Wire', category: 'Metals', ratePerKg: 6.4, active: true },
  { id: 'mat_5', name: 'Steel / Tin', category: 'Metals', ratePerKg: 0.22, active: true },
  { id: 'mat_6', name: 'PET Plastic (#1)', category: 'Plastics', ratePerKg: 0.4, active: true },
  { id: 'mat_7', name: 'HDPE Plastic (#2)', category: 'Plastics', ratePerKg: 0.35, active: true },
  { id: 'mat_8', name: 'Glass (mixed)', category: 'Glass', ratePerKg: 0.05, active: true },
  { id: 'mat_9', name: 'E-Waste', category: 'Electronics', ratePerKg: 0.6, active: true },
  { id: 'mat_10', name: 'General Waste', category: 'Other', ratePerKg: null, active: true },
];

const customers: Customer[] = [
  { id: 'cus_1', name: 'Harbour Foods Ltd', address: '1420 Commissioner St, Vancouver', contactName: 'Rita Chen', contactPhone: '+1 604 555 0200' },
  { id: 'cus_2', name: 'Northside Auto Body', address: '88 Industrial Ave, Burnaby', contactName: 'Joe Marsh', contactPhone: '+1 604 555 0201' },
  { id: 'cus_3', name: 'Cedar Ridge Apartments', address: '3300 Cedar Ridge Way, Surrey', contactName: 'Building Mgmt', contactPhone: '+1 604 555 0202' },
  { id: 'cus_4', name: 'Pacific Print Co', address: '76 Kent Ave S, Vancouver', contactName: 'Alan Bird', contactPhone: '+1 604 555 0203' },
];

function makeJob(
  index: number,
  overrides: Partial<Job> & Pick<Job, 'type' | 'status' | 'scheduledFor'>,
): Job {
  const customer = customers[index % customers.length]!;
  return {
    id: `job_${index}`,
    reference: `GW-${1000 + index}`,
    customerId: customer.id,
    customerName: customer.name,
    address: customer.address,
    assignedToId: 'usr_3',
    assignedToName: 'Marcus Lee',
    notes: null,
    lines: [],
    photos: [],
    totalWeightKg: 0,
    createdAt: isoDaysFromNow(-3),
    updatedAt: isoDaysFromNow(-1),
    completedAt: null,
    ...overrides,
  } as Job;
}

const jobs: Job[] = [
  makeJob(1, { type: 'pickup', status: 'assigned', scheduledFor: isoDaysFromNow(0, 8) }),
  makeJob(2, { type: 'pickup', status: 'in_progress', scheduledFor: isoDaysFromNow(0, 10) }),
  makeJob(3, { type: 'dropoff', status: 'scheduled', scheduledFor: isoDaysFromNow(0, 14), assignedToId: null, assignedToName: null }),
  makeJob(4, { type: 'pickup', status: 'assigned', scheduledFor: isoDaysFromNow(1, 9), assignedToId: 'usr_4', assignedToName: 'Dan Okafor' }),
  makeJob(5, { type: 'dropoff', status: 'scheduled', scheduledFor: isoDaysFromNow(2, 11) }),
  makeJob(6, {
    type: 'pickup',
    status: 'completed',
    scheduledFor: isoDaysFromNow(-1, 9),
    completedAt: isoDaysFromNow(-1, 12),
    lines: [
      { id: 'lin_1', jobId: 'job_6', materialId: 'mat_2', materialName: 'Cardboard (OCC)', weightKg: 340.5, notes: null, recordedById: 'usr_3', recordedAt: isoDaysFromNow(-1, 11) },
      { id: 'lin_2', jobId: 'job_6', materialId: 'mat_3', materialName: 'Aluminium Cans', weightKg: 62, notes: 'Two bulk bags', recordedById: 'usr_3', recordedAt: isoDaysFromNow(-1, 11) },
    ],
    totalWeightKg: 402.5,
  }),
  makeJob(7, {
    type: 'dropoff',
    status: 'completed',
    scheduledFor: isoDaysFromNow(-2, 13),
    completedAt: isoDaysFromNow(-2, 15),
    lines: [
      { id: 'lin_3', jobId: 'job_7', materialId: 'mat_5', materialName: 'Steel / Tin', weightKg: 1180, notes: null, recordedById: 'usr_4', recordedAt: isoDaysFromNow(-2, 14) },
    ],
    totalWeightKg: 1180,
  }),
];

const timesheets: Timesheet[] = [
  { id: 'ts_1', userId: 'usr_3', userName: 'Marcus Lee', clockInAt: isoDaysFromNow(-1, 7), clockOutAt: isoDaysFromNow(-1, 16), durationMinutes: 540, note: null },
  { id: 'ts_2', userId: 'usr_4', userName: 'Dan Okafor', clockInAt: isoDaysFromNow(-1, 8), clockOutAt: isoDaysFromNow(-1, 17), durationMinutes: 540, note: null },
  { id: 'ts_3', userId: 'usr_3', userName: 'Marcus Lee', clockInAt: isoDaysFromNow(-2, 7), clockOutAt: isoDaysFromNow(-2, 15), durationMinutes: 480, note: 'Left early — truck service' },
];

let signedInUserId: string | null = null;

// --- helpers ----------------------------------------------------------------

function recalcTotal(job: Job): void {
  job.totalWeightKg = Number(
    job.lines.reduce((sum, line) => sum + line.weightKg, 0).toFixed(2),
  );
  job.updatedAt = new Date().toISOString();
}

function findJob(jobId: string): Job {
  const job = jobs.find((candidate) => candidate.id === jobId);
  if (!job) throw new ApiError(404, 'That job no longer exists.');
  return job;
}

function requireUser(): User {
  const user = users.find((candidate) => candidate.id === signedInUserId);
  if (!user) throw new ApiError(401, 'Your session has expired. Please sign in again.');
  return user;
}

function sameDay(iso: string, reference: Date): boolean {
  const date = new Date(iso);
  return (
    date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth() &&
    date.getDate() === reference.getDate()
  );
}

// --- mocked service ---------------------------------------------------------

export const mockApi = {
  async login(email: string, _password: string): Promise<LoginResponse> {
    const user = users.find(
      (candidate) => candidate.email.toLowerCase() === email.trim().toLowerCase(),
    );
    if (!user) {
      throw new ApiError(401, 'That email is not registered for GreenWave.');
    }
    if (!user.active) {
      throw new ApiError(403, 'This account has been deactivated.');
    }
    signedInUserId = user.id;
    return delay({
      accessToken: `mock-access-${user.id}`,
      refreshToken: `mock-refresh-${user.id}`,
      expiresIn: 3600,
      user,
    });
  },

  async me(): Promise<User> {
    return delay(requireUser());
  },

  async logout(): Promise<void> {
    signedInUserId = null;
    return delay(undefined);
  },

  /** Lets a restored session work after a reload in mock mode. */
  restoreSessionFromToken(accessToken: string): void {
    const id = accessToken.replace('mock-access-', '');
    if (users.some((user) => user.id === id)) signedInUserId = id;
  },

  async listJobs(query: JobListQuery = {}): Promise<Paginated<Job>> {
    requireUser();
    let result = [...jobs];

    if (query.type) result = result.filter((job) => job.type === query.type);
    if (query.status) result = result.filter((job) => job.status === query.status);
    if (query.assignedToId) {
      result = result.filter((job) => job.assignedToId === query.assignedToId);
    }
    if (query.from) {
      result = result.filter((job) => job.scheduledFor >= query.from!);
    }
    if (query.to) result = result.filter((job) => job.scheduledFor <= query.to!);
    if (query.search) {
      const needle = query.search.toLowerCase();
      result = result.filter(
        (job) =>
          job.reference.toLowerCase().includes(needle) ||
          (job.customerName ?? '').toLowerCase().includes(needle) ||
          (job.address ?? '').toLowerCase().includes(needle),
      );
    }

    result.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const start = (page - 1) * pageSize;

    return delay({
      items: result.slice(start, start + pageSize).map((job) => ({ ...job })),
      page,
      pageSize,
      total: result.length,
    });
  },

  async getJob(jobId: string): Promise<Job> {
    requireUser();
    return delay({ ...findJob(jobId) });
  },

  async createJob(input: CreateJobInput): Promise<Job> {
    requireUser();
    const customer = customers.find((candidate) => candidate.id === input.customerId);
    const assignee = users.find((candidate) => candidate.id === input.assignedToId);
    const now = new Date().toISOString();

    const job: Job = {
      id: nextId('job'),
      reference: `GW-${1000 + jobs.length + 1}`,
      type: input.type,
      status: input.assignedToId ? 'assigned' : 'scheduled',
      customerId: customer?.id ?? null,
      customerName: customer?.name ?? input.customerName ?? null,
      address: input.address ?? customer?.address ?? null,
      scheduledFor: input.scheduledFor,
      assignedToId: assignee?.id ?? null,
      assignedToName: assignee?.fullName ?? null,
      notes: input.notes ?? null,
      lines: [],
      photos: [],
      totalWeightKg: 0,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    jobs.push(job);
    return delay({ ...job });
  },

  async updateJob(jobId: string, input: UpdateJobInput): Promise<Job> {
    requireUser();
    const job = findJob(jobId);

    if (input.type) job.type = input.type;
    if (input.scheduledFor) job.scheduledFor = input.scheduledFor;
    if (input.notes !== undefined) job.notes = input.notes ?? null;
    if (input.address !== undefined) job.address = input.address ?? null;
    if (input.status) job.status = input.status;

    if (input.customerId !== undefined) {
      const customer = customers.find((candidate) => candidate.id === input.customerId);
      job.customerId = customer?.id ?? null;
      job.customerName = customer?.name ?? input.customerName ?? null;
    }
    if (input.assignedToId !== undefined) {
      const assignee = users.find((candidate) => candidate.id === input.assignedToId);
      job.assignedToId = assignee?.id ?? null;
      job.assignedToName = assignee?.fullName ?? null;
      if (assignee && job.status === 'scheduled') job.status = 'assigned';
    }

    job.updatedAt = new Date().toISOString();
    return delay({ ...job });
  },

  async setJobStatus(jobId: string, status: JobStatus): Promise<Job> {
    requireUser();
    const job = findJob(jobId);
    job.status = status;
    job.completedAt = status === 'completed' ? new Date().toISOString() : null;
    job.updatedAt = new Date().toISOString();
    return delay({ ...job });
  },

  async addJobLine(jobId: string, input: CreateJobLineInput): Promise<JobLine> {
    const user = requireUser();
    const job = findJob(jobId);
    const material = materials.find((candidate) => candidate.id === input.materialId);
    if (!material) throw new ApiError(400, 'Pick a material first.');

    const line: JobLine = {
      id: nextId('lin'),
      jobId,
      materialId: material.id,
      materialName: material.name,
      weightKg: input.weightKg,
      notes: input.notes ?? null,
      recordedById: user.id,
      recordedAt: new Date().toISOString(),
    };
    job.lines.push(line);
    recalcTotal(job);
    return delay({ ...line });
  },

  async deleteJobLine(jobId: string, lineId: string): Promise<void> {
    requireUser();
    const job = findJob(jobId);
    job.lines = job.lines.filter((line) => line.id !== lineId);
    recalcTotal(job);
    return delay(undefined);
  },

  async addJobPhoto(jobId: string, localUri: string, caption?: string): Promise<JobPhoto> {
    const user = requireUser();
    const job = findJob(jobId);
    const photo: JobPhoto = {
      id: nextId('pho'),
      jobId,
      url: localUri,
      thumbnailUrl: localUri,
      caption: caption ?? null,
      uploadedById: user.id,
      uploadedAt: new Date().toISOString(),
    };
    job.photos.push(photo);
    job.updatedAt = photo.uploadedAt;
    return delay({ ...photo });
  },

  async deleteJobPhoto(jobId: string, photoId: string): Promise<void> {
    requireUser();
    const job = findJob(jobId);
    job.photos = job.photos.filter((photo) => photo.id !== photoId);
    return delay(undefined);
  },

  async listMaterials(): Promise<Material[]> {
    return delay(materials.filter((material) => material.active).map((m) => ({ ...m })));
  },

  async listCustomers(search?: string): Promise<Customer[]> {
    const needle = search?.toLowerCase();
    const result = needle
      ? customers.filter((customer) => customer.name.toLowerCase().includes(needle))
      : customers;
    return delay(result.map((customer) => ({ ...customer })));
  },

  async listStaff(): Promise<User[]> {
    requireUser();
    return delay(users.map((user) => ({ ...user })));
  },

  async createStaff(input: CreateStaffInput): Promise<User> {
    const actor = requireUser();
    if (actor.role !== 'admin') {
      throw new ApiError(403, 'Only admins can add staff.');
    }
    if (users.some((user) => user.email.toLowerCase() === input.email.toLowerCase())) {
      throw new ApiError(409, 'A staff member with that email already exists.');
    }
    const user: User = {
      id: nextId('usr'),
      email: input.email.trim().toLowerCase(),
      fullName: input.fullName.trim(),
      role: input.role,
      phone: input.phone ?? null,
      active: true,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    return delay({ ...user });
  },

  async updateStaff(userId: string, patch: Partial<User>): Promise<User> {
    const actor = requireUser();
    if (actor.role !== 'admin') {
      throw new ApiError(403, 'Only admins can change staff.');
    }
    const user = users.find((candidate) => candidate.id === userId);
    if (!user) throw new ApiError(404, 'Staff member not found.');
    Object.assign(user, patch);
    return delay({ ...user });
  },

  async activeTimesheet(): Promise<Timesheet | null> {
    const user = requireUser();
    const open = timesheets.find(
      (sheet) => sheet.userId === user.id && sheet.clockOutAt === null,
    );
    return delay(open ? { ...open } : null);
  },

  async clockIn(): Promise<Timesheet> {
    const user = requireUser();
    const alreadyOpen = timesheets.find(
      (sheet) => sheet.userId === user.id && sheet.clockOutAt === null,
    );
    if (alreadyOpen) throw new ApiError(409, "You're already clocked in.");

    const sheet: Timesheet = {
      id: nextId('ts'),
      userId: user.id,
      userName: user.fullName,
      clockInAt: new Date().toISOString(),
      clockOutAt: null,
      durationMinutes: null,
      note: null,
    };
    timesheets.unshift(sheet);
    return delay({ ...sheet });
  },

  async clockOut(note?: string): Promise<Timesheet> {
    const user = requireUser();
    const sheet = timesheets.find(
      (candidate) => candidate.userId === user.id && candidate.clockOutAt === null,
    );
    if (!sheet) throw new ApiError(409, "You're not clocked in.");

    sheet.clockOutAt = new Date().toISOString();
    sheet.durationMinutes = Math.max(
      1,
      Math.round(
        (new Date(sheet.clockOutAt).getTime() - new Date(sheet.clockInAt).getTime()) /
          60000,
      ),
    );
    if (note) sheet.note = note;
    return delay({ ...sheet });
  },

  async listTimesheets(params: { userId?: string; from?: string; to?: string } = {}): Promise<
    Timesheet[]
  > {
    requireUser();
    let result = [...timesheets];
    if (params.userId) result = result.filter((sheet) => sheet.userId === params.userId);
    if (params.from) result = result.filter((sheet) => sheet.clockInAt >= params.from!);
    if (params.to) result = result.filter((sheet) => sheet.clockInAt <= params.to!);
    result.sort((a, b) => b.clockInAt.localeCompare(a.clockInAt));
    return delay(result.map((sheet) => ({ ...sheet })));
  },

  /** Used by the dashboard for a lightweight "today" summary. */
  async todaySummary(): Promise<{
    pickups: number;
    dropoffs: number;
    completed: number;
    weightKg: number;
    staffOnShift: number;
  }> {
    requireUser();
    const today = new Date();
    const todays = jobs.filter((job) => sameDay(job.scheduledFor, today));
    return delay({
      pickups: todays.filter((job) => job.type === 'pickup').length,
      dropoffs: todays.filter((job) => job.type === 'dropoff').length,
      completed: todays.filter((job) => job.status === 'completed').length,
      weightKg: Number(
        todays.reduce((sum, job) => sum + job.totalWeightKg, 0).toFixed(1),
      ),
      staffOnShift: timesheets.filter((sheet) => sheet.clockOutAt === null).length,
    });
  },
};
