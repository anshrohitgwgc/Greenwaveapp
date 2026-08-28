# GreenWave V2 Deployment Plan — Frontend

Full plan (migrations, nginx, staging/prod sequencing, rollback) lives in
`docs/V2_DEPLOYMENT_PLAN.md` in the `FULL-INFRA-V.0001` repo. This file is
just what's specific to deploying this static site.

**Nothing here was executed.** No deploy happened during this work.

## Before deploying this build anywhere

1. The backend (`greenwave-v2` branch of `FULL-INFRA-V.0001`, `app/api`)
   must be deployed first, with migrations 004–010 applied, and nginx
   updated to proxy the new routes at root (see that repo's deployment
   plan §1.5) — this frontend's login screen has nothing to talk to
   otherwise.
2. `assets/api.js` defaults to same-origin (`''`), which is correct for the
   real deployment (nginx already proxies `/auth/*` etc. on the same host
   as the static site per `infrastructure/nginx/gwgc.cloud`). Nothing needs
   to change in this repo's code for that — the override
   (`localStorage.setItem('greenwave.apiBase', ...)`) exists only for local
   development against a different host.
3. Existing deploy scripts in this repo (`push-to-github.sh`,
   `replace-repo-contents.sh`) are unchanged by this branch and weren't
   run.

## Cache safety (white-screen regression)

`sw.js`'s `CACHE` constant was bumped to `greenwave-v5` and `assets/api.js`
added to the precache list. Combined with the existing network-first/
cache-fallback fetch handler (unchanged), a client that already has
`greenwave-v4` installed will fetch the new `sw.js` (byte-different →
triggers the browser's normal update check), install the new cache under
the new name, and drop the old one on `activate` — this is the same pattern
already used for the v3→v4 bump in this repo's history, not a new
mechanism.

## Rollback

Revert to the previous commit's `index.html`/`assets/*`/`sw.js`; there is no
database or server-side state owned by this repo to roll back.
