import type { ConfigService } from '@nestjs/config';

/** Default bound on establishing a PostgreSQL connection (TCP + handshake). */
export const DEFAULT_DB_CONNECTION_TIMEOUT_MS = 10_000;

/**
 * `DB_CONNECTION_TIMEOUT_MS` when it is a positive integer, otherwise the
 * default. Never 0: pg treats 0 as "wait forever".
 */
export function dbConnectionTimeoutMs(config: ConfigService): number {
  const raw = config.get<string>('DB_CONNECTION_TIMEOUT_MS');
  const value = Number(raw);
  return raw !== undefined && Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_DB_CONNECTION_TIMEOUT_MS;
}

/**
 * Connection-level PostgreSQL options for TypeORM.
 *
 * A server that accepts the TCP connection but never answers the startup
 * handshake (seen on a node that booted while PostgreSQL was still starting)
 * previously left the API waiting forever without binding its port, so
 * systemd's Restart=always never fired. `connectTimeoutMS` (pg's
 * connectionTimeoutMillis) makes that attempt fail; @nestjs/typeorm then
 * retries and, if the database never answers, startup fails and the process
 * exits. TCP keepalive lets the kernel detect pooled connections whose peer
 * has silently gone away.
 */
export function databaseConnectionOptions(config: ConfigService) {
  return {
    connectTimeoutMS: dbConnectionTimeoutMs(config),
    extra: { keepAlive: true, keepAliveInitialDelayMillis: 10_000 },
  };
}
