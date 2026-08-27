/**
 * Runtime configuration, read from EXPO_PUBLIC_* env vars at build time.
 * See `.env.example`.
 */

function envFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

function envInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  /** When true the app runs against in-memory demo data — no backend needed. */
  useMock: envFlag(process.env.EXPO_PUBLIC_USE_MOCK, true),

  /** Base URL, no version prefix — e.g. https://api.gwgc.cloud */
  apiBaseUrl: (
    process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://api.gwgc.cloud'
  ).replace(/\/+$/, ''),

  timeoutMs: envInt(process.env.EXPO_PUBLIC_API_TIMEOUT_MS, 20_000),

  maxPhotosPerJob: envInt(process.env.EXPO_PUBLIC_MAX_PHOTOS_PER_JOB, 10),
} as const;
