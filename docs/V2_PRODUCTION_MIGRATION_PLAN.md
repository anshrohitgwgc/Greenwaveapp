# GreenWave V2 Production Migration Plan

**Status: planning only. Nothing in this document has been executed. No
command from this plan has been run against any of the 192.168.1.x hosts,
`gwgc.cloud`, `api.gwgc.cloud`, or `gwgcservers.ca`.**

This plan describes the cutover from the current production backend
(`Adiljaiswal/Greenwave-API`, running on VM102/201/301 today) to the V2
backend now living at `backend/app/api` in this canonical repo
(`anshrohitgwgc/Greenwaveapp`, branch `greenwave-v2`). It sits above
`backend/docs/V2_DEPLOYMENT_PLAN.md`, which covers the mechanical steps
(migrations, nginx, rollback) for deploying `app/api` itself — this
document is the decision sequence for actually switching production traffic
over.

## Why this is a separate, later step

Task scope for this pass was: unify the repository, reconcile the frontend
against the real V2 backend, and get the result staging-ready. It explicitly
excludes deploying anything. `Adiljaiswal/Greenwave-API` keeps serving
production (`api.gwgc.cloud`, `api.gwgcservers.ca` via
192.168.1.12/21/31) unchanged and untouched until every gate below is
signed off by a human operator.

## Absolute boundaries (repeated from `docs/V2_ARCHITECTURE.md` — do not
violate at any stage of this plan)

- Never touch VM105 (192.168.1.15) or `www.gwgcservers.ca` /
  `mgmt-api.gwgcservers.ca` / `n8n.gwgcservers.ca` — the Management Portal is
  a fully separate system, at no point a target of this migration.
- Never modify production PostgreSQL, Redis, MinIO, the live API nodes, or
  VM101's frontend as part of *drafting or rehearsing* this plan — only as
  explicit, human-approved execution steps once staging has signed off.

## Gate 0 — Pre-flight facts to confirm before scheduling anything

These are open questions, not assumptions to act on:

1. Which backend is actually live on 192.168.1.12/21/31 today —
   confirmed to be `Adiljaiswal/Greenwave-API` by this task's brief, but not
   independently re-verified from those hosts in this pass (no access to
   them from this sandbox).
2. Whether 192.168.1.22's real `user`/`pickup`/`photo` schema matches what
   `backend/database/migrations/001-003*.sql` assumes — the legacy backend
   may have run with TypeORM `synchronize: true`, so real column
   casing/types could differ from what the migrations expect. Verify with
   `\d "user"` etc. via `psql` before writing a single migration against
   that host.
3. Whether `Adiljaiswal/Greenwave-API`'s `.env` (which this task's brief
   says points at real production Postgres/Redis with a plaintext password)
   has been rotated — independent of this migration, a live finding worth
   flagging to whoever owns those credentials.

## Gate 1 — Staging deploy of the V2 backend (isolated from production)

1. Stand up a disposable Postgres 16 + Redis 7 + MinIO stack (staging
   docker-compose, not the production hosts).
2. `npm ci && npm run build` in `backend/app/api`; apply migrations
   001–010 to the disposable staging database.
3. `npm test` → confirm 54/54 still pass in that environment (build/CI
   parity check, not new coverage — the suite itself uses sqlite/mocks).
4. Staging-only smoke tests that sqlite cannot prove:
   - Two concurrent `POST /invoices` don't collide/skip a number (real
     `FOR UPDATE` row locking).
   - `inventory_balances` view sums correctly under real Postgres
     `NUMERIC` arithmetic.
   - A photo upload actually reaches a real MinIO bucket and its presigned
     URL actually loads.
5. Point a staging build of the frontend at the staging API
   (`localStorage.setItem('greenwave.apiBase', 'https://staging-api...')`)
   and run the full browser QA checklist below.

## Gate 2 — Frontend staging verification

Run against the staging API from Gate 1, in a real browser (this sandbox
cannot do this step — no display):

- Viewports: 1920×1080, 1440×900, 1280×720, 390×844, 430×932.
- Every screen: login (correct password, wrong password, unknown email),
  bootstrap-vs-sign-in gate toggle, dashboard/inventory, invoices, photos,
  time clock, customers, materials, staff, history.
- 0 unexpected console errors, 0 failed required network requests, no
  horizontal overflow, no broken images.
- Specifically: a fresh load with `sessionStorage` cleared but
  `localStorage` intact (simulating "closed the tab, reopened it") must
  show the sign-in gate, not a broken logged-in-with-no-session state.
- PWA: install-to-home-screen still works; a client on the previous cache
  version (`greenwave-v4` or earlier) picks up the new service worker and
  assets cleanly on next load, with no white-screen regression.

## Gate 3 — Worker split-out (if going ahead with VM103 as a separate process)

`backend/app/api`'s `PhotosProcessor` currently runs in-process behind
`WORKER_INLINE=true`. Before relying on VM103 as a distinct worker in
production: extract it to run as its own Node process against the shared
Redis, verify it processes a real BullMQ job end-to-end in staging, and
confirm VM103's deployment story (systemd unit / process manager, restart
policy, log destination) exists and is documented — none of that exists yet.

## Gate 4 — Cutover sequencing (production — requires explicit human sign-off before *each* numbered step)

1. Postgres backup/snapshot of 192.168.1.22 immediately before any
   migration.
2. Apply migrations 004–010 (the incremental, additive-only V2 set — no
   existing table is altered destructively) to 192.168.1.22.
3. Rolling-restart `api-1`/`api-2`/`api-3` (192.168.1.12/21/31) one at a
   time onto the new `backend/app/api` build, health-checking `GET /health`
   on each before moving to the next.
4. Update production nginx to proxy the new routes (`/users`,
   `/warehouses`, `/customers`, `/materials`, `/inventory`, `/containers`,
   `/invoices`, `/photos`, `/timesheets`, `/audit`, `/roles`,
   `/permissions`) at root, same `greenwave_api_cluster` upstream, no
   `/api/v1` prefix — merge into the existing `gwgc.cloud`/
   `api.gwgcservers.ca` server block, don't replace it.
5. Deploy the frontend's updated static assets (this repo's root:
   `index.html`, `sw.js`, `assets/*`) to wherever VM101's document root is
   served from. The bumped service-worker cache name (`greenwave-v5`)
   means existing clients pick up the change without a stale-cache
   mismatch.
6. Confirm the MinIO service account used by `StorageService` has
   `s3:CreateBucket` on 192.168.1.23, or pre-create the bucket — the API
   will otherwise attempt to create it on first boot.
7. Only after 1–6 are healthy and monitored: begin routing decommission
   planning for `Adiljaiswal/Greenwave-API` on the old nodes. This plan does
   not schedule that decommission — it's a separate, later decision once V2
   has run in production without incident.

## Rollback

Every migration 004–010 is additive (new tables/columns only, nothing
altered or dropped), so rollback at any point after Gate 4 is "stop routing
to the new API/frontend build and re-point nginx at the previous release" —
not "undo the schema." No down-migrations are auto-generated; a schema
rollback, if ever needed, is a manual, reviewed step.

## Explicitly out of scope for this document

- Decommissioning `Adiljaiswal/Greenwave-API` or its nodes.
- Any change to the Management Portal, its database, or `n8n`.
- Native iOs/Android packaging (the frontend stays a PWA — see
  `README.md`'s "About 'an iOS app and an Android app'" section).
