/**
 * HTTP client: JSON helpers, bearer auth, timeout, and single-flight
 * access-token refresh on 401.
 *
 * The auth store injects the token accessors via `configureClient()` so this
 * module has no import cycle with the store.
 */

import { config } from './config';
import { endpoints } from './endpoints';

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }

  /** True for network failures / timeouts rather than HTTP error responses. */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

interface ClientHooks {
  getAccessToken: () => string | null;
  getRefreshToken: () => string | null;
  onTokensRefreshed: (accessToken: string, refreshToken: string) => void;
  onAuthExpired: () => void;
}

let hooks: ClientHooks = {
  getAccessToken: () => null,
  getRefreshToken: () => null,
  onTokensRefreshed: () => {},
  onAuthExpired: () => {},
};

export function configureClient(next: ClientHooks): void {
  hooks = next;
}

// --- error message extraction ----------------------------------------------

function messageFromBody(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    for (const key of ['message', 'error', 'detail']) {
      const value = record[key];
      if (typeof value === 'string' && value.length > 0) return value;
    }
  }
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return 'Not found.';
  if (status >= 500) return 'The server had a problem. Please try again.';
  return `Request failed (${status}).`;
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// --- single-flight refresh --------------------------------------------------

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = hooks.getRefreshToken();
    if (!refreshToken) return null;

    try {
      const response = await fetch(
        `${config.apiBaseUrl}${endpoints.auth.refresh()}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        },
      );
      if (!response.ok) return null;

      const body = (await parseBody(response)) as {
        accessToken?: string;
        refreshToken?: string;
      } | null;

      if (!body?.accessToken) return null;
      hooks.onTokensRefreshed(body.accessToken, body.refreshToken ?? refreshToken);
      return body.accessToken;
    } catch {
      return null;
    } finally {
      // Cleared on the next tick so concurrent callers share this result.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();

  return refreshInFlight;
}

// --- core request -----------------------------------------------------------

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Skip the Authorization header (used by login/refresh). */
  anonymous?: boolean;
  signal?: AbortSignal;
}

async function performRequest(
  path: string,
  options: RequestOptions,
  accessToken: string | null,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', () => controller.abort());
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (!options.anonymous && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  try {
    return await fetch(`${config.apiBaseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  let response: Response;

  try {
    response = await performRequest(path, options, hooks.getAccessToken());
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    throw new ApiError(
      0,
      aborted
        ? 'The request timed out. Check your connection and try again.'
        : "Can't reach the GreenWave server. Check your connection.",
    );
  }

  // One transparent retry after refreshing the access token.
  if (response.status === 401 && !options.anonymous) {
    const fresh = await refreshAccessToken();
    if (fresh) {
      try {
        response = await performRequest(path, options, fresh);
      } catch {
        throw new ApiError(0, "Can't reach the GreenWave server.");
      }
    } else {
      hooks.onAuthExpired();
      throw new ApiError(401, 'Your session has expired. Please sign in again.');
    }
  }

  const body = await parseBody(response);

  if (!response.ok) {
    throw new ApiError(response.status, messageFromBody(body, response.status), body);
  }

  return body as T;
}

export const http = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};

export function currentAccessToken(): string | null {
  return hooks.getAccessToken();
}
