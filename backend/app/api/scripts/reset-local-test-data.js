#!/usr/bin/env node
/**
 * Clears operational/test records from the LOCAL/STAGING GreenWave database
 * while preserving products (materials), users, roles, permissions,
 * warehouses, warehouse assignments, and customers.
 *
 * Refuses to run against anything that isn't a local database. This is not
 * a generic "wipe tables" script - it only touches the specific tables
 * listed below, inside one transaction, and prints exact before/after
 * counts for both the cleared tables and the preserved ones so the
 * operator can verify nothing else moved.
 *
 * Usage: node scripts/reset-local-test-data.js [--yes]
 * Without --yes it prints the plan and exits without changing anything.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const env = { ...loadEnv(path.join(__dirname, '..', '.env')), ...process.env };

const DB_HOST = env.DB_HOST || 'localhost';
const DB_PORT = Number(env.DB_PORT || 5432);
const DB_USERNAME = env.DB_USERNAME || 'greenwave_dev';
const DB_PASSWORD = env.DB_PASSWORD;
const DB_DATABASE = env.DB_DATABASE || 'greenwave_dev';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

// Hard safety gate: refuse anything that isn't an obviously-local dev DB.
// This is deliberately redundant with "the .env only ever points at
// localhost" - a script that can delete data should not trust that alone.
if (!LOCAL_HOSTS.has(DB_HOST)) {
  console.error(
    `REFUSING TO RUN: DB_HOST="${DB_HOST}" is not localhost/127.0.0.1. ` +
      'This script only operates on the local/staging database. Aborting.',
  );
  process.exit(1);
}
if (DB_DATABASE !== 'greenwave_dev') {
  console.error(
    `REFUSING TO RUN: DB_DATABASE="${DB_DATABASE}" is not the expected local dev database name ("greenwave_dev"). Aborting.`,
  );
  process.exit(1);
}

const PRESERVE_TABLES = [
  'materials',
  '"user"',
  'warehouses',
  'roles',
  'permissions',
  'role_permissions',
  'user_roles',
  'user_warehouses',
  'customers',
];

// FK-safe delete order: children before parents.
const CLEAR_TABLES = [
  'payments',
  'invoice_items',
  'invoices',
  'photos',
  'timesheets',
  'chat_messages',
  'inventory_transactions',
  'containers',
];

async function countAll(client, tables) {
  const counts = {};
  for (const t of tables) {
    const res = await client.query(`SELECT count(*)::int AS c FROM ${t}`);
    counts[t] = res.rows[0].c;
  }
  return counts;
}

async function main() {
  const dryRun = !process.argv.includes('--yes');

  const client = new Client({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USERNAME,
    password: DB_PASSWORD,
    database: DB_DATABASE,
  });
  await client.connect();

  try {
    console.log(`Connected to ${DB_HOST}:${DB_PORT}/${DB_DATABASE} as ${DB_USERNAME}`);
    console.log('');
    console.log('=== BEFORE ===');
    const preserveBefore = await countAll(client, PRESERVE_TABLES);
    const clearBefore = await countAll(client, CLEAR_TABLES);
    console.log('Preserved tables:', preserveBefore);
    console.log('Tables to clear:', clearBefore);

    if (dryRun) {
      console.log('');
      console.log('Dry run only (pass --yes to actually delete). No changes made.');
      return;
    }

    await client.query('BEGIN');
    for (const t of CLEAR_TABLES) {
      await client.query(`DELETE FROM ${t}`);
    }
    await client.query('COMMIT');

    console.log('');
    console.log('=== AFTER ===');
    const preserveAfter = await countAll(client, PRESERVE_TABLES);
    const clearAfter = await countAll(client, CLEAR_TABLES);
    console.log('Preserved tables:', preserveAfter);
    console.log('Tables cleared:', clearAfter);

    console.log('');
    for (const t of PRESERVE_TABLES) {
      if (preserveBefore[t] !== preserveAfter[t]) {
        throw new Error(
          `SAFETY VIOLATION: preserved table ${t} changed from ${preserveBefore[t]} to ${preserveAfter[t]} rows. This should never happen.`,
        );
      }
    }
    console.log('Verified: every preserved table has an unchanged row count.');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* no-op - ROLLBACK is a no-op outside a transaction */
    }
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
