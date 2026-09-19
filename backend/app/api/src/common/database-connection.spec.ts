import { createServer, Server, Socket } from 'net';
import type { AddressInfo } from 'net';
import type { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import {
  DEFAULT_DB_CONNECTION_TIMEOUT_MS,
  databaseConnectionOptions,
  dbConnectionTimeoutMs,
} from './database-connection';

const configWith = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('databaseConnectionOptions', () => {
  it('defaults to a bounded 10s connect timeout with TCP keepalive', () => {
    expect(DEFAULT_DB_CONNECTION_TIMEOUT_MS).toBe(10_000);
    expect(databaseConnectionOptions(configWith({}))).toEqual({
      connectTimeoutMS: 10_000,
      extra: { keepAlive: true, keepAliveInitialDelayMillis: 10_000 },
    });
  });

  it.each([
    ['2500', 2500],
    ['0', DEFAULT_DB_CONNECTION_TIMEOUT_MS],
    ['-1', DEFAULT_DB_CONNECTION_TIMEOUT_MS],
    ['abc', DEFAULT_DB_CONNECTION_TIMEOUT_MS],
    ['1.5', DEFAULT_DB_CONNECTION_TIMEOUT_MS],
    ['', DEFAULT_DB_CONNECTION_TIMEOUT_MS],
  ])(
    'DB_CONNECTION_TIMEOUT_MS=%p -> %p (never 0, which pg treats as forever)',
    (raw, expected) => {
      expect(
        dbConnectionTimeoutMs(configWith({ DB_CONNECTION_TIMEOUT_MS: raw })),
      ).toBe(expected);
    },
  );

  describe('against a server that accepts TCP but never speaks PostgreSQL', () => {
    let server: Server;
    let port: number;
    const sockets: Socket[] = [];

    beforeAll(async () => {
      server = createServer((socket) => {
        sockets.push(socket); // accept and hold, never reply
        socket.on('error', () => undefined);
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      port = (server.address() as AddressInfo).port;
    });

    afterAll(async () => {
      sockets.forEach((s) => s.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('DataSource.initialize() fails within the configured bound instead of hanging', async () => {
      const timeoutMs = 1500;
      const ds = new DataSource({
        type: 'postgres',
        host: '127.0.0.1',
        port,
        username: 'nobody',
        password: 'unused',
        database: 'unused',
        ...databaseConnectionOptions(
          configWith({ DB_CONNECTION_TIMEOUT_MS: String(timeoutMs) }),
        ),
      });

      const started = Date.now();
      await expect(ds.initialize()).rejects.toThrow(/timeout/i);
      const elapsed = Date.now() - started;

      expect(sockets.length).toBeGreaterThanOrEqual(1); // TCP really connected
      expect(elapsed).toBeGreaterThanOrEqual(timeoutMs - 100);
      expect(elapsed).toBeLessThan(timeoutMs + 3000);
    }, 15_000);
  });
});
