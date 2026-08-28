# GreenWave V2 Deployment Plan

**Nothing in this plan has been executed.** This branch (`greenwave-v2`) was
implemented and tested entirely against a disposable in-memory sqlite
database and mocked Redis/MinIO — it has never connected to
192.168.1.12/14/21/22/23/31, `api.gwgc.cloud`, or `gwgcservers.ca`, and this
plan does not authorize doing so. It documents the steps a human operator
would take, staging-first, per `docs/DEPLOYMENT.md`'s existing lifecycle.

## 0. Pre-flight — verify assumptions before touching anything

1. **Confirm the real backend.** Check whether `api.gwgc.cloud` (VM102/201/
   301) is actually currently running `Adiljaiswal/Greenwave-API` or this
   repo's `app/api`, or something else entirely — the audit that led to
   this branch found near-duplicate code in both repos and could not
   confirm which one is live from the filesystem alone.
2. **Verify the real `user`/`pickup`/`photo` table schema on 192.168.1.22**
   (`\d "user"` etc. via psql) before running any migration. This app's
   `TypeOrmModule` previously ran with `synchronize: true` against
   Postgres — if that's what actually created the production schema, its
   real column casing/types may not exactly match `database/migrations/
   001-003*.sql`. Migrations 004+ use `ADD COLUMN IF NOT EXISTS` /
   `CREATE TABLE IF NOT EXISTS` defensively, but confirm before applying.
3. **Rotate the credentials already sitting in `Adiljaiswal/Greenwave-API`'s
   `.env`** (real Postgres/Redis host + a plaintext password), independent
   of this branch — that file predates this work and was left untouched,
   but it's a live finding worth acting on.

## 1. Staging

1. `git checkout greenwave-v2 && npm ci` in `app/api`.
2. Run `./infrastructure/scripts/setup-local-dev.sh` against the **staging**
   docker-compose stack (not local dev) to apply migrations 004–010 and
   verify the app boots against a disposable Postgres 16 + Redis 7 + MinIO
   with `NODE_ENV=production`-equivalent config, `synchronize: false`.
3. Run the full test suite (`npm test`) and confirm 54/54 still pass in
   that environment (they should — the suite already uses no live infra —
   this step is really about `npm ci`/build parity, not new coverage).
4. Manually smoke-test against staging Postgres specifically (not sqlite):
   - Two concurrent `POST /invoices` calls don't collide on invoice number
     (the thing the sqlite tests can't prove, since sqlite has no real
     `FOR UPDATE`).
   - `inventory_balances` view returns correct sums with real Postgres
     `NUMERIC` arithmetic.
   - Photo upload actually reaches a real MinIO bucket and the presigned
     URL actually loads the image.
5. Update **staging** nginx (`infrastructure/nginx/*` — note there are
   uncommitted, in-progress edits to these files already in this working
   tree from before this branch; merge into those, don't overwrite them)
   to proxy the new routes. The existing `gwgc.cloud` server block only has
   explicit `location` blocks for `/api/`, `/auth/`, `/pickups` — add
   (or generalize to a single regex) `/users`, `/warehouses`, `/customers`,
   `/materials`, `/inventory`, `/containers`, `/invoices`, `/photos`,
   `/timesheets`, `/audit`, `/roles`, `/permissions`, all proxying to the
   same `greenwave_api_cluster` upstream at root, no path rewrite (root
   routes, no `/api/v1`, matching the existing convention confirmed from
   that same nginx config).
6. Point a staging build of `Greenwaveapp` (`localStorage.setItem
   ('greenwave.apiBase', 'https://staging-api...')`) at it and run the
   Browser QA checklist below.

## 2. Production (only after staging sign-off — manual, controlled)

Follow `docs/DEPLOYMENT.md`'s existing steps, unchanged process:

1. Build `app/api` (`npm ci && npm run build`).
2. Apply only the **new, incremental** migrations (004–010) to
   192.168.1.22 — `psql -h 192.168.1.22 -U <prod user> -d <prod db> -f
   database/migrations/004_v2_foundations.sql`, then 005…010 in order.
   Take a Postgres backup/snapshot immediately before.
3. Rolling-restart `api-1`/`api-2`/`api-3` (192.168.1.12/21/31), one at a
   time, health-checking `GET /health` on each before moving to the next
   (the health check is unchanged by this branch).
4. Deploy `Greenwaveapp`'s updated static assets (this pass: `index.html`,
   `sw.js`, `assets/app.js`, `assets/store.js`, `assets/api.js` new) to
   wherever `www.gwgcservers.ca`/`gwgc.cloud`'s frontend root is served
   from. Because `sw.js`'s cache name was bumped (`greenwave-v5`), clients
   pick up the new files on next load without a stale-cache mismatch — see
   the White-Screen Regression section below.
5. `MINIO_BUCKET_NAME` etc. must already exist on the real MinIO
   (192.168.1.23) — this branch's `StorageService.onModuleInit` will create
   the bucket if missing, but confirm the service account it runs as has
   `s3:CreateBucket` there, or pre-create it.

## 3. Rollback

Same as `docs/DEPLOYMENT.md` §3: re-point nginx upstream to the previous
release, and if a migration was applied, its rollback is manual (there are
no auto-generated down-migrations in this pass — each of 004–010 is
additive: new tables/columns, nothing dropped or altered destructively, so
the safe rollback is simply "stop calling the new endpoints," not "undo the
schema"). The one exception is `user.updatedAt` (migration 004,
`ADD COLUMN IF NOT EXISTS`) — also additive, safe to leave in place even on
rollback.

## 4. Browser QA checklist (do before any production rollout)

Viewports: 1920×1080, 1440×900, 1280×720, 390×844, 430×932.
For each: login (correct + wrong password + unknown email), the gate's
bootstrap-vs-sign-in toggle, dashboard/inventory view, invoices, photos,
time clock, customers, materials, staff, history. Verify: 0 unexpected
console errors, 0 failed required network requests, no horizontal overflow,
no broken images, and — specifically for this branch — that a fresh load
with a **stale `sessionStorage`-cleared but `localStorage`-intact** browser
state (simulating "closed the tab, opened it again") correctly shows the
sign-in gate rather than a broken "logged in with no session" state (this
is the bug fixed in `boot()` — see `docs/V2_IMPLEMENTATION.md`).

**Not run in this pass** — no browser or display available in the sandbox
that implemented this branch. This checklist is what a human (or a
browser-automation session with real Chrome + a running API) does before
sign-off, not something already completed.

## 5. iOS / Android packaging (documentation only — not built)

`Greenwaveapp` stays a PWA in this pass (install-to-home-screen, no store
review). Packaging it as a native app later — the existing README already
describes when that becomes worth doing — would mean: a React Native/Expo
rebuild of the same screens (per README, "that only makes sense once there
is a server for them to sync with" — which is what this branch provides),
an Apple Developer account and TestFlight pipeline, a Google Play Console
listing, and platform-specific handling for camera/background-location/
push that a PWA can't do. None of that exists yet; nothing here claims App
Store or Play Store publication.

## DO NOT DEPLOY

This plan is documentation only. No command in it was run against
production, staging, or any shared environment during this work.
