import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { requestIdMiddleware } from './common/request-id';

/**
 * Browser origins allowed to make cross-origin calls to this API.
 *
 * The production web app is served same-origin (nginx proxies the API under
 * https://gwgc.cloud/api), so it does not rely on CORS. What this list is
 * for is cross-origin clients and the API's own public hostname, api.gwgc.cloud.
 *
 * Override with CORS_ALLOWED_ORIGINS (comma-separated) rather than editing
 * this list for a new environment.
 */
const DEFAULT_PRODUCTION_ORIGINS = [
  'https://gwgc.cloud',
  'https://www.gwgc.cloud',
  'https://app.gwgcservers.ca',
  'https://pay.gwgcservers.ca',
];

function allowedOrigins(isProduction: boolean): string[] {
  const configured = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (configured.length > 0) {
    return configured;
  }

  return isProduction
    ? DEFAULT_PRODUCTION_ORIGINS
    : [
        ...DEFAULT_PRODUCTION_ORIGINS,
        'http://localhost:3000',
        'http://localhost:4173',
        'http://localhost:5173',
        'http://localhost:8080',
        'http://127.0.0.1:4000',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:8080',
      ];
}

function parseCookieHeader(header?: string): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx !== -1) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      cookies[key] = decodeURIComponent(val);
    }
  }
  return cookies;
}

interface RequestWithCookies extends Request {
  cookies: Record<string, string>;
}

async function bootstrap() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (
    isProduction &&
    (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('dev'))
  ) {
    throw new Error(
      'JWT_SECRET must be set to a real secret in production (refusing to boot with a dev/default value)',
    );
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Preserve the exact request bytes on req.rawBody. Stripe signs the raw
    // payload; a re-serialized JSON body would never verify.
    rawBody: true,
  });

  // Trust proxy for secure cookies and accurate client IP logging behind NGINX
  app.set('trust proxy', 1);

  // Security Headers via Helmet
  app.use(
    helmet({
      contentSecurityPolicy: false, // API returns JSON; frontend NGINX provides document CSP
      crossOriginResourcePolicy: { policy: 'same-origin' },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      frameguard: { action: 'deny' },
      hsts: {
        maxAge: 63072000,
        includeSubDomains: true,
        preload: true,
      },
      noSniff: true,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  app.use(requestIdMiddleware);

  // Cookie parser and Cache-Control middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    (req as RequestWithCookies).cookies = parseCookieHeader(req.headers.cookie);

    // Ensure API responses are never cached by browsers, proxies, or service workers
    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate',
    );
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // URL path normalization: allows both /api/... and /...
    if (req.url.startsWith('/api/')) {
      req.url = req.url.substring(4);
    } else if (req.url === '/api') {
      req.url = '/';
    }

    next();
  });

  const origins = allowedOrigins(isProduction);

  app.enableCors({
    origin(
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) {
      if (!origin) {
        return callback(null, true);
      }
      return callback(null, origins.includes(origin));
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`GreenWave API listening on port ${port}`, 'Bootstrap');
  Logger.log(`CORS allowed origins: ${origins.join(', ')}`, 'Bootstrap');
}

void bootstrap();
