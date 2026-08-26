/**
 * React Query bindings. Screens use these hooks and never call `api` directly
 * for reads, so caching and invalidation stay in one place.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { api, type PickedImage, type TodaySummary } from './service';
import type {
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

// --- reads ------------------------------------------------------------------

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

// --- writes -----------------------------------------------------------------

/** Anything that changes a job invalidates lists + the dashboard too. */
function useJobInvalidator() {
  const client = useQueryClient();
  return (jobId?: string) => {
    void client.invalidateQueries({ queryKey: ['jobs'] });
    void client.invalidateQueries({ queryKey: queryKeys.today });
    if (jobId) void client.invalidateQueries({ queryKey: queryKeys.job(jobId) });
  };
}

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
  const invalidate = useJobInvalidator();
  return useMutation({
    mutationFn: (status: JobStatus) => api.setJobStatus(jobId, status),
    onSuccess: () => invalidate(jobId),
  });
}

export function useAddJobLine(jobId: string) {
  const invalidate = useJobInvalidator();
  return useMutation({
    mutationFn: (input: CreateJobLineInput) => api.addJobLine(jobId, input),
    onSuccess: () => invalidate(jobId),
  });
}

export function useDeleteJobLine(jobId: string) {
  const invalidate = useJobInvalidator();
  return useMutation({
    mutationFn: (lineId: string) => api.deleteJobLine(jobId, lineId),
    onSuccess: () => invalidate(jobId),
  });
}

export function useAddJobPhoto(jobId: string) {
  const invalidate = useJobInvalidator();
  return useMutation({
    mutationFn: (args: {
      image: PickedImage;
      caption?: string;
      onProgress?: (fraction: number) => void;
    }) => api.addJobPhoto(jobId, args.image, { caption: args.caption, onProgress: args.onProgress }),
    onSuccess: () => invalidate(jobId),
  });
}

export function useDeleteJobPhoto(jobId: string) {
  const invalidate = useJobInvalidator();
  return useMutation({
    mutationFn: (photoId: string) => api.deleteJobPhoto(jobId, photoId),
    onSuccess: () => invalidate(jobId),
  });
}

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

export function useClockIn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.clockIn(),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['timesheet'] });
      void client.invalidateQueries({ queryKey: ['timesheets'] });
      void client.invalidateQueries({ queryKey: queryKeys.today });
    },
  });
}

export function useClockOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (note?: string) => api.clockOut(note),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['timesheet'] });
      void client.invalidateQueries({ queryKey: ['timesheets'] });
      void client.invalidateQueries({ queryKey: queryKeys.today });
    },
  });
}
