/**
 * React Query bindings. Screens use these hooks and never call `api` directly
 * for reads, so caching and invalidation stay in one place.
 *
 * The write hooks are offline-aware. When the device is offline, an
 * offline-capable mutation patches the cache immediately and drops the real
 * request into the persisted queue (see `src/offline/`), so a driver in a yard
 * with no signal gets the same feedback they'd get on wifi.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { api, type PickedImage, type TodaySummary } from './service';
import { ApiError } from './client';
import { queryKeys } from './query-keys';
import { isOnline } from '@/offline/network';
import { canQueue, dropQueuedPhoto, enqueue } from '@/offline/queue';
import {
  isLocalId,
  localId,
  optimisticAddLine,
  optimisticAddPhoto,
  optimisticClockIn,
  optimisticClockOut,
  optimisticRemoveLine,
  optimisticStatus,
} from '@/offline/optimistic';
import { useAuth } from '@/auth/store';
import type {
  CreateCustomerInput,
  CreateJobInput,
  CreateJobLineInput,
  CreateStaffInput,
  Customer,
  Job,
  JobListQuery,
  JobStatus,
  Material,
  Paginated,
  Timesheet,
  UpdateJobInput,
  User,
} from './types';

export { queryKeys };

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function useJobs(query: JobListQuery = {}): UseQueryResult<Paginated<Job>> {
  return useQuery({
    queryKey: queryKeys.jobs(query),
    queryFn: () => api.listJobs(query),
  });
}

export function useJob(jobId: string | undefined): UseQueryResult<Job> {
  return useQuery({
    queryKey: queryKeys.job(jobId ?? ''),
    queryFn: () => api.getJob(jobId!),
    enabled: Boolean(jobId),
  });
}

export function useMaterials(): UseQueryResult<Material[]> {
  return useQuery({
    queryKey: queryKeys.materials,
    queryFn: () => api.listMaterials(),
    staleTime: 10 * 60 * 1000, // reference data barely changes
  });
}

export function useCustomers(search?: string): UseQueryResult<Customer[]> {
  return useQuery({
    queryKey: queryKeys.customers(search),
    queryFn: () => api.listCustomers(search),
    staleTime: 5 * 60 * 1000,
  });
}

export function useStaff(): UseQueryResult<User[]> {
  return useQuery({ queryKey: queryKeys.staff, queryFn: () => api.listStaff() });
}

export function useActiveTimesheet(): UseQueryResult<Timesheet | null> {
  return useQuery({
    queryKey: queryKeys.activeTimesheet,
    queryFn: () => api.activeTimesheet(),
    refetchInterval: 60_000,
  });
}

export function useTimesheets(
  params: { userId?: string; from?: string; to?: string } = {},
): UseQueryResult<Timesheet[]> {
  return useQuery({
    queryKey: queryKeys.timesheets(params),
    queryFn: () => api.listTimesheets(params),
  });
}

export function useTodaySummary(): UseQueryResult<TodaySummary> {
  return useQuery({ queryKey: queryKeys.today, queryFn: () => api.todaySummary() });
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

/** Anything that changes a job invalidates lists + the dashboard too. */
function useJobInvalidator() {
  const client = useQueryClient();
  return (jobId?: string) => {
    void client.invalidateQueries({ queryKey: ['jobs'] });
    void client.invalidateQueries({ queryKey: queryKeys.today });
    if (jobId) void client.invalidateQueries({ queryKey: queryKeys.job(jobId) });
  };
}

function jobReference(client: QueryClient, jobId: string): string {
  return client.getQueryData<Job>(queryKeys.job(jobId))?.reference ?? jobId;
}

function currentUser() {
  return useAuth.getState().user;
}

/**
 * Result of an offline-capable write: `queued` means it lives in the local
 * queue and has not reached the server yet.
 */
export interface WriteResult {
  queued: boolean;
}

const OFFLINE_UNSUPPORTED = new ApiError(
  0,
  "This needs a connection. It hasn't been saved — try again once you're back online.",
);

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/** Creating and editing jobs is a manager action done at a desk — online only. */
export function useCreateJob() {
  const invalidate = useJobInvalidator();
  return useMutation({
    mutationFn: (input: CreateJobInput) => api.createJob(input),
    onSuccess: (job) => invalidate(job.id),
  });
}

export function useUpdateJob(jobId: string) {
  const invalidate = useJobInvalidator();
  return useMutation({
    mutationFn: (input: UpdateJobInput) => api.updateJob(jobId, input),
    onSuccess: () => invalidate(jobId),
  });
}

export function useSetJobStatus(jobId: string) {
  const client = useQueryClient();
  const invalidate = useJobInvalidator();

  return useMutation({
    mutationFn: async (status: JobStatus): Promise<WriteResult> => {
      if (isOnline()) {
        await api.setJobStatus(jobId, status);
        return { queued: false };
      }
      const now = new Date().toISOString();
      optimisticStatus(client, jobId, status, now);
      await enqueue(
        { kind: 'job-status', jobId, jobRef: jobReference(client, jobId), status },
        now,
      );
      return { queued: true };
    },
    onSuccess: (result) => {
      if (!result.queued) invalidate(jobId);
    },
  });
}

export function useAddJobLine(jobId: string) {
  const client = useQueryClient();
  const invalidate = useJobInvalidator();

  return useMutation({
    mutationFn: async (input: CreateJobLineInput): Promise<WriteResult> => {
      if (isOnline()) {
        await api.addJobLine(jobId, input);
        return { queued: false };
      }

      const now = new Date().toISOString();
      const materials = client.getQueryData<Material[]>(queryKeys.materials) ?? [];
      const materialName =
        materials.find((material) => material.id === input.materialId)?.name ?? 'Material';

      optimisticAddLine(
        client,
        jobId,
        input,
        materialName,
        currentUser()?.id ?? null,
        now,
        localId('line'),
      );
      await enqueue(
        {
          kind: 'job-line-add',
          jobId,
          jobRef: jobReference(client, jobId),
          input,
          materialName,
        },
        now,
      );
      return { queued: true };
    },
    onSuccess: (result) => {
      if (!result.queued) invalidate(jobId);
    },
  });
}

export function useDeleteJobLine(jobId: string) {
  const client = useQueryClient();
  const invalidate = useJobInvalidator();

  return useMutation({
    mutationFn: async (lineId: string): Promise<WriteResult> => {
      if (isOnline()) {
        await api.deleteJobLine(jobId, lineId);
        return { queued: false };
      }

      const now = new Date().toISOString();
      optimisticRemoveLine(client, jobId, lineId, now);

      // A line that only ever existed locally is removed by dropping the
      // optimistic row — there is nothing on the server to delete.
      if (!isLocalId(lineId)) {
        await enqueue(
          { kind: 'job-line-delete', jobId, jobRef: jobReference(client, jobId), lineId },
          now,
        );
      }
      return { queued: true };
    },
    onSuccess: (result) => {
      if (!result.queued) invalidate(jobId);
    },
  });
}

export function useAddJobPhoto(jobId: string) {
  const client = useQueryClient();
  const invalidate = useJobInvalidator();

  return useMutation({
    mutationFn: async (args: {
      image: PickedImage;
      caption?: string;
      onProgress?: (fraction: number) => void;
    }): Promise<WriteResult> => {
      if (isOnline()) {
        await api.addJobPhoto(jobId, args.image, {
          caption: args.caption,
          onProgress: args.onProgress,
        });
        return { queued: false };
      }

      const photoLocalId = localId('photo');
      const op = {
        kind: 'job-photo' as const,
        jobId,
        jobRef: jobReference(client, jobId),
        image: args.image,
        localId: photoLocalId,
      };
      // The web build can't queue a photo — a browser File can't be persisted
      // and rehydrated later.
      if (!canQueue(op)) throw OFFLINE_UNSUPPORTED;

      const now = new Date().toISOString();
      optimisticAddPhoto(
        client,
        jobId,
        args.image.uri,
        currentUser()?.id ?? null,
        now,
        photoLocalId,
      );
      await enqueue(op, now);
      return { queued: true };
    },
    onSuccess: (result) => {
      if (!result.queued) invalidate(jobId);
    },
  });
}

export function useDeleteJobPhoto(jobId: string) {
  const client = useQueryClient();
  const invalidate = useJobInvalidator();

  return useMutation({
    mutationFn: async (photoId: string): Promise<WriteResult> => {
      // A photo that has only ever existed on this phone is removed by dropping
      // the optimistic row and the queued upload — there is nothing to delete
      // on the server.
      if (isLocalId(photoId)) {
        await dropQueuedPhoto(photoId);
        client.setQueryData<Job>(queryKeys.job(jobId), (job) =>
          job ? { ...job, photos: job.photos.filter((photo) => photo.id !== photoId) } : job,
        );
        return { queued: true };
      }
      await api.deleteJobPhoto(jobId, photoId);
      return { queued: false };
    },
    onSuccess: (result) => {
      if (!result.queued) invalidate(jobId);
    },
  });
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export function useCreateStaff() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStaffInput) => api.createStaff(input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.staff });
    },
  });
}

export function useUpdateStaff() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (args: { userId: string; patch: Partial<User> }) =>
      api.updateStaff(args.userId, args.patch),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.staff });
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (args: { currentPassword: string; newPassword: string }) =>
      api.changePassword(args.currentPassword, args.newPassword),
  });
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export function useCreateCustomer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCustomerInput) => api.createCustomer(input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}

export function useUpdateCustomer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (args: { customerId: string; input: Partial<CreateCustomerInput> }) =>
      api.updateCustomer(args.customerId, args.input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Timesheets
// ---------------------------------------------------------------------------

function useTimesheetInvalidator() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ['timesheet'] });
    void client.invalidateQueries({ queryKey: ['timesheets'] });
    void client.invalidateQueries({ queryKey: queryKeys.today });
  };
}

export function useClockIn() {
  const client = useQueryClient();
  const invalidate = useTimesheetInvalidator();

  return useMutation({
    mutationFn: async (): Promise<WriteResult> => {
      if (isOnline()) {
        await api.clockIn();
        return { queued: false };
      }
      const user = currentUser();
      if (!user) throw OFFLINE_UNSUPPORTED;

      const now = new Date().toISOString();
      optimisticClockIn(client, user.id, user.fullName, now, localId('shift'));
      await enqueue({ kind: 'clock-in' }, now);
      return { queued: true };
    },
    onSuccess: (result) => {
      if (!result.queued) invalidate();
    },
  });
}

export function useClockOut() {
  const client = useQueryClient();
  const invalidate = useTimesheetInvalidator();

  return useMutation({
    mutationFn: async (note?: string): Promise<WriteResult> => {
      if (isOnline()) {
        await api.clockOut(note);
        return { queued: false };
      }
      const now = new Date().toISOString();
      optimisticClockOut(client, now, note);
      await enqueue({ kind: 'clock-out', note }, now);
      return { queued: true };
    },
    onSuccess: (result) => {
      if (!result.queued) invalidate();
    },
  });
}
