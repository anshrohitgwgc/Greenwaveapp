import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
/** Opt-in PostgreSQL tests use only this disposable local server, never app env. */
export function gateDatabase(name: string): TypeOrmModuleOptions {
  return process.env.GREENWAVE_PG_GATE === '1'
    ? { type: 'postgres', host: '127.0.0.1', port: 55437, username: 'gate', database: `gate_test3_${name}`, synchronize: false, dropSchema: false }
    : { type: 'better-sqlite3', database: ':memory:', synchronize: true, dropSchema: true };
}
