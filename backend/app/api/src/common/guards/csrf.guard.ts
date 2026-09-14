import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import type { Request } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

interface RequestWithCookiesAndSession extends Request {
  cookies: Record<string, string>;
  session?: {
    csrfToken?: string;
  };
}

// Paths exempt from CSRF. None of these accept ambient session credentials:
// login issues the session; the Stripe webhook is authenticated by its
// signature; public payment endpoints are authorized only by the opaque link
// token in the URL.
const EXEMPT_PATHS = [
  /^\/(?:api\/)?auth\/login\/?$/,
  /^\/(?:api\/)?auth\/register\/?$/,
  /^\/(?:api\/)?webhooks\/stripe\/?$/,
  /^\/(?:api\/)?payments\/stripe\/webhook\/?$/,
  /^\/(?:api\/)?public\/pay\/[A-Za-z0-9_-]+\/intent\/?$/,
];

const DEFAULT_ALLOWED_ORIGINS = [
  'https://gwgc.cloud',
  'https://www.gwgc.cloud',
  'https://app.gwgcservers.ca',
];

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly logger = new Logger(CsrfGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<RequestWithCookiesAndSession>();
    const method = request.method.toUpperCase();

    // 1. Safe HTTP methods require no CSRF check
    if (SAFE_METHODS.has(method)) {
      return true;
    }

    // 2. Check path exemptions
    const path = request.path || request.url.split('?')[0];
    for (const pattern of EXEMPT_PATHS) {
      if (pattern.test(path)) {
        return true;
      }
    }

    // 3. If authenticated via Bearer token (no cookie credentials),
    // browser ambient credentials are not used, so CSRF does not apply.
    const authHeader = request.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return true;
    }

    // 4. If neither cookies nor session exists, let authentication guard handle 401
    const cookies = request.cookies || {};
    const sessionId = cookies['gw_session'];
    if (!sessionId) {
      return true;
    }

    // 5. Origin / Referer validation
    const origin = request.headers['origin'];
    const host = request.headers['host'];
    const isProduction = process.env.NODE_ENV === 'production';

    if (origin) {
      let allowed = false;
      const configured = (process.env.CORS_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
      const allowList =
        configured.length > 0
          ? configured
          : isProduction
            ? DEFAULT_ALLOWED_ORIGINS
            : [
                ...DEFAULT_ALLOWED_ORIGINS,
                'http://localhost:3000',
                'http://localhost:4173',
                'http://localhost:5173',
                'http://localhost:8080',
                'http://127.0.0.1:4000',
                'http://127.0.0.1:5173',
                'http://127.0.0.1:8080',
              ];

      try {
        const originUrl = new URL(origin);
        if (host && originUrl.host === host) {
          allowed = true;
        } else if (allowList.includes(origin)) {
          allowed = true;
        }
      } catch {
        allowed = false;
      }

      if (!allowed) {
        this.logger.warn(
          `CSRF: Blocked request from disallowed origin ${origin}`,
        );
        throw new ForbiddenException('Invalid request origin');
      }
    }

    // 6. CSRF Token verification
    const headerToken = (request.headers['x-csrf-token'] ||
      request.headers['x-xsrf-token']) as string | undefined;
    const cookieToken = cookies['gw_csrf'];
    const sessionToken = request.session?.csrfToken;

    const expectedToken = sessionToken || cookieToken;

    if (!headerToken || !expectedToken) {
      throw new ForbiddenException('Missing CSRF token');
    }

    if (!this.safeEqual(headerToken, expectedToken)) {
      this.logger.warn('CSRF: Token mismatch');
      throw new ForbiddenException('Invalid CSRF token');
    }

    return true;
  }

  private safeEqual(a: string, b: string): boolean {
    if (!a || !b) return false;
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }
}
