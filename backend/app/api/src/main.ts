import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';

import { AppModule } from './app.module';

/**
 * Browser origins allowed to make cross-origin calls to this API.
 *
 * The production web app is served same-origin (nginx proxies the API under
 * https://gwgc.cloud), so it does not rely on CORS at all. What this list is
 * for is the API's own public hostname, api.gwgc.cloud, which previously ran
 * with `origin: true` — Nest reflects whatever Origin the caller sends and,
 * combined with `credentials: true`, told every browser on the internet that
 * any site was allowed to make credentialed calls and read the responses.
 *
 * Override with CORS_ALLOWED_ORIGINS (comma-separated) rather than editing
 * this list for a new environment.
 */
const DEFAULT_PRODUCTION_ORIGINS = [
  'https://gwgc.cloud',
  'https://www.gwgc.cloud',
  'https://app.gwgcservers.ca',
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
        'http://127.0.0.1:5173',
      ];
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

  const app = await NestFactory.create(AppModule);

  app.use(helmet());

  const origins = allowedOrigins(isProduction);

  app.enableCors({
    origin(
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) {
      // No Origin header means the caller is not a browser enforcing the
      // same-origin policy — the mobile app, a health check, server-to-server.
      // CORS has nothing to say about those, so they are not blocked here;
      // they still have to authenticate like anyone else.
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
