/**
 * The service layer every screen talks to.
 *
 * Dispatches to either the in-memory mock (EXPO_PUBLIC_USE_MOCK=1) or the
 * real HTTP API. Screens never import `client`, `endpoints` or `mock`
 * directly — so switching backends is a config flag, not a refactor.
 */

import { config } from './config';
import { http } from './client';
import { endpoints } from './endpoints';
import { mockApi } from './mock';
import { uploadImage, type PickedImage } from './upload';
import { localDayRange } from '@/utils/format';
import type {
  CreateCustomerInput,
  CreateJobInput,
  CreateJobLineInput,
  CreateStaffInput,
  Customer,
  PushTokenInput,
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

const mock = config.useMock;

export interface TodaySummary {
  pickups: number;
  dropoffs: number;
  completed: number;
  weightKg: number;
  staffOnShift: number;
}

export const api = {
  // --- auth ---------------------------------------------------------------

  login(email: string, password: string): Promise<LoginResponse> {
    if (mock) return mockApi.login(email, password);
    return http.post<LoginResponse>(
      endpoints.auth.login(),
      { email: email.trim().toLowerCase(), password },
      { anonymous: true },
    );
  },

  me(): Promise<User> {
    if (mock) return mockApi.me();
    return http.get<User>(endpoints.auth.me());
  },

  async logout(): Promise<void> {
    if (mock) return mockApi.logout();
    try {
      await http.post<void>(endpoints.auth.logout());
    } catch {
      // Signing out locally must succeed even if the server call fails.
    }
  },

  changePassword(currentPassword: string, newPassword: string): Promise<void> {
    if (mock) return mockApi.changePassword(currentPassword, newPassword);
    return http.post<void>(endpoints.auth.changePassword(), {
      currentPassword,
      newPassword,
    });
  },

  restoreMockSession(accessToken: string): void {
    if (mock) mockApi.restoreSessionFromToken(accessToken);
  },

  // --- jobs ---------------------------------------------------------------

  listJobs(query: JobListQuery = {}): Promise<Paginated<Job>> {
    if (mock) return mockApi.listJobs(query);
    return http.get<Paginated<Job>>(endpoints.jobs.list(query));
  },

  getJob(jobId: string): Promise<Job> {
    if (mock) return mockApi.getJob(jobId);
    return http.get<Job>(endpoints.jobs.detail(jobId));
  },

  createJob(input: CreateJobInput): Promise<Job> {
    if (mock) return mockApi.createJob(input);
    return http.post<Job>(endpoints.jobs.create(), input);
  },

  updateJob(jobId: string, input: UpdateJobInput): Promise<Job> {
    if (mock) return mockApi.updateJob(jobId, input);
    return http.patch<Job>(endpoints.jobs.update(jobId), input);
  },

  setJobStatus(jobId: string, status: JobStatus): Promise<Job> {
    if (mock) return mockApi.setJobStatus(jobId, status);
    return http.post<Job>(endpoints.jobs.setStatus(jobId), { status });
  },

  // --- material + weight rows ---------------------------------------------

  addJobLine(jobId: string, input: CreateJobLineInput): Promise<JobLine> {
    if (mock) return mockApi.addJobLine(jobId, input);
    return http.post<JobLine>(endpoints.jobs.lines(jobId), input);
  },

  deleteJobLine(jobId: string, lineId: string): Promise<void> {
    if (mock) return mockApi.deleteJobLine(jobId, lineId);
    return http.delete<void>(endpoints.jobs.line(jobId, lineId));
  },

  // --- photos --------------------------------------------------------------

  addJobPhoto(
    jobId: string,
    image: PickedImage,
    options: { caption?: string; onProgress?: (fraction: number) => void } = {},
  ): Promise<JobPhoto> {
    if (mock) return mockApi.addJobPhoto(jobId, image.uri, options.caption);
    return uploadImage<JobPhoto>(endpoints.jobs.photos(jobId), image, {
      fieldName: 'file',
      caption: options.caption,
      onProgress: options.onProgress,
    });
  },

  deleteJobPhoto(jobId: string, photoId: string): Promise<void> {
    if (mock) return mockApi.deleteJobPhoto(jobId, photoId);
    return http.delete<void>(endpoints.jobs.photo(jobId, photoId));
  },

  // --- reference data ------------------------------------------------------

  listMaterials(): Promise<Material[]> {
    if (mock) return mockApi.listMaterials();
    return http.get<Material[]>(endpoints.materials.list());
  },

  listCustomers(search?: string): Promise<Customer[]> {
    if (mock) return mockApi.listCustomers(search);
    return http.get<Customer[]>(endpoints.customers.list(search));
  },

  createCustomer(input: CreateCustomerInput): Promise<Customer> {
    if (mock) return mockApi.createCustomer(input);
    return http.post<Customer>(endpoints.customers.create(), input);
  },

  updateCustomer(customerId: string, input: Partial<CreateCustomerInput>): Promise<Customer> {
    if (mock) return mockApi.updateCustomer(customerId, input);
    return http.patch<Customer>(endpoints.customers.update(customerId), input);
  },

  // --- push notifications --------------------------------------------------

  async registerPushToken(input: PushTokenInput): Promise<void> {
    if (mock) return;
    try {
      await http.post<void>(endpoints.devices.register(), input);
    } catch {
      // Never block sign-in because push registration failed.
    }
  },

  async unregisterPushToken(token: string): Promise<void> {
    if (mock) return;
    try {
      await http.delete<void>(`${endpoints.devices.unregister()}?token=${encodeURIComponent(token)}`);
    } catch {
      // Signing out locally must succeed regardless.
    }
  },

  // --- staff ---------------------------------------------------------------

  listStaff(): Promise<User[]> {
    if (mock) return mockApi.listStaff();
    return http.get<User[]>(endpoints.staff.list());
  },

  createStaff(input: CreateStaffInput): Promise<User> {
    if (mock) return mockApi.createStaff(input);
    return http.post<User>(endpoints.staff.create(), input);
  },

  updateStaff(userId: string, patch: Partial<User>): Promise<User> {
    if (mock) return mockApi.updateStaff(userId, patch);
    return http.patch<User>(endpoints.staff.update(userId), patch);
  },

  // --- timesheets ----------------------------------------------------------

  async activeTimesheet(): Promise<Timesheet | null> {
    if (mock) return mockApi.activeTimesheet();
    try {
      return await http.get<Timesheet | null>(endpoints.timesheets.active());
    } catch (error) {
      // A 404 is a valid "not clocked in" answer.
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { status?: number }).status === 404
      ) {
        return null;
      }
      throw error;
    }
  },

  clockIn(): Promise<Timesheet> {
    if (mock) return mockApi.clockIn();
    return http.post<Timesheet>(endpoints.timesheets.clockIn());
  },

  clockOut(note?: string): Promise<Timesheet> {
    if (mock) return mockApi.clockOut(note);
    return http.post<Timesheet>(endpoints.timesheets.clockOut(), { note });
  },

  listTimesheets(
    params: { userId?: string; from?: string; to?: string } = {},
  ): Promise<Timesheet[]> {
    if (mock) return mockApi.listTimesheets(params);
    return http.get<Timesheet[]>(endpoints.timesheets.list(params));
  },

  // --- dashboard -----------------------------------------------------------

  async todaySummary(): Promise<TodaySummary> {
    if (mock) return mockApi.todaySummary();

    // Derived client-side so no extra reporting endpoint is required.
    const { fromIso, toIso } = localDayRange();
    const [jobsToday, sheets] = await Promise.all([
      api.listJobs({ from: fromIso, to: toIso, pageSize: 200 }),
      api.listTimesheets({ from: fromIso }).catch(() => [] as Timesheet[]),
    ]);

    return {
      pickups: jobsToday.items.filter((job) => job.type === 'pickup').length,
      dropoffs: jobsToday.items.filter((job) => job.type === 'dropoff').length,
      completed: jobsToday.items.filter((job) => job.status === 'completed').length,
      weightKg: Number(
        jobsToday.items.reduce((sum, job) => sum + (job.totalWeightKg ?? 0), 0).toFixed(1),
      ),
      staffOnShift: sheets.filter((sheet) => sheet.clockOutAt === null).length,
    };
  },
};

export type { PickedImage };
