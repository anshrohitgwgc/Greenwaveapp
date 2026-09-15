# Repository Architecture

`anshrohitgwgc/Greenwaveapp` is the **canonical GreenWave application
repository**. Frontend and backend both live here, on branch `greenwave-v2`.
This document explains the layout and why it looks the way it does — read it
before adding a new top-level directory or moving an existing one.

## Layout

```
/
  assets/            frontend: app.js, api.js, store.js, photos.js
  index.html          frontend: app shell (all views)
  sw.js, manifest.webmanifest    frontend: PWA
  serve.sh, push-to-github.sh, replace-repo-contents.sh   frontend tooling
  README.md           frontend-facing (what the app does, how to run it)

  backend/
    app/api/          NestJS API — auth, RBAC, invoices, inventory, photos,
                       timesheets, audit (see backend/docs/V2_ARCHITECTURE.md)
    database/         SQL migrations (001–010) and seeds
    infrastructure/   nginx configs, deploy scripts, docker-compose
    tests/            backend test fixtures/helpers referenced by app/api
    docs/             backend-specific design/ops docs (ARCHITECTURE.md,
                       DATABASE.md, API-CONTRACT.md, SECURITY.md, etc.)

  docs/
    REPOSITORY_ARCHITECTURE.md      this file
    V2_ARCHITECTURE.md              unified frontend+backend design
    V2_IMPLEMENTATION.md            unified status, module by module
    V2_PRODUCTION_MIGRATION_PLAN.md cutover plan from the legacy backend
```

There is no `frontend/` directory. The frontend intentionally stays at the
repo root rather than moving under `frontend/` — see "Why the frontend isn't
in a `frontend/` folder" below.

There is no separate `worker/` directory yet. The V2 backend's background
job processor (`PhotosProcessor`, BullMQ) currently runs in-process inside
`backend/app/api` behind `WORKER_INLINE`. Splitting it into a standalone
`worker/` deployable (matching production VM103) is real, not-yet-done work
— see `docs/V2_PRODUCTION_MIGRATION_PLAN.md`.

## Why the frontend isn't in a `frontend/` folder

Moving `index.html`/`assets/`/`sw.js` under `frontend/` was considered and
rejected for this pass: the app is served as a static site with paths
resolved relative to the document root (`serve.sh`, `push-to-github.sh`, and
production nginx at `gwgc.cloud` all assume that), and the service worker's
cache-versioning scheme (`sw.js` at the root, `index.html` referencing
`assets/*?v=...`) is part of the white-screen-regression fix already in this
repo's history. Relocating it would touch nginx config, the deploy scripts,
and the service worker's registration path all at once, for no functional
benefit — the brief allows deviating from the suggested structure "if
technically superior," and keeping a working static-site root that
production already points at is the superior choice here. `backend/`,
`database/`, and `infrastructure/` are additive — they don't require moving
anything that already works.

## How the backend got here

`backend/` was brought in from `Adiljaiswal/FULL-INFRA-V.0001` (branch
`greenwave-v2`, commit `f6056f3`) via `git subtree add --prefix=backend`,
**not** a squash or a file copy. Every original backend commit is a real
ancestor of this repo's history — `git log -- backend/...` and `git blame`
work across the merge, and `git merge-base --is-ancestor <old-sha> HEAD`
confirms it for any commit from the source repo. `FULL-INFRA-V.0001` is not
deleted or archived by this; it remains the upstream the backend was
developed in, but `Greenwaveapp` is now where V2 backend work continues.

## Shared code

None yet. The frontend is a no-build-step, plain-script app (`assets/api.js`
etc., no bundler); the backend is a NestJS/TypeScript project with its own
`package.json` under `backend/app/api`. There is currently no code (types,
validation schemas, constants) shared between them at the source level —
`docs/V2_ROUTE_RECONCILIATION`-style route/DTO agreement is maintained by
convention (frontend's `assets/api.js` methods map 1:1 to backend controller
routes, verified by hand against `backend/app/api/src/**/*.controller.ts`
each time either side changes) rather than a generated/shared client. If a
generated OpenAPI client is added later, it belongs in a new
`shared/` or `packages/api-client/` directory — not yet needed at this
repo's current size.

## What is deliberately *not* here

- **No workspace/monorepo tool** (no Turborepo, Nx, or npm/yarn workspaces
  root `package.json`). The frontend has no `package.json` at all — it's
  script tags, not a Node project — so there is nothing for a JS workspace
  tool to manage across `/` and `backend/app/api`. Introducing one now would
  add build-tooling surface area with no current multi-package build to
  coordinate.
- **No `.env`, credentials, keys, or database dumps.** See
  `backend/.gitignore` (excludes `.env`, `.env.*` except `.env.example`,
  `*.pem`/`*.key`/`*.crt`, `id_rsa*`/`id_ed25519*`, `*.sqlite*`,
  `postgres_data/`/`redis_data/`/`minio_data/`) and the top-level
  `.gitignore`. Nothing under `backend/` was copied from this session's
  local `.env` — only tracked source came in via the subtree merge.
