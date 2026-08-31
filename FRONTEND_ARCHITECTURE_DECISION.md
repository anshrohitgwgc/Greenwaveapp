# Frontend Architecture Decision — GreenWave V2

**Date:** 2026-08-31
**Branch:** `greenwave-payment-rbac-ui` @ `cfb31c3`
**Status:** DECIDED — repository-root vanilla-JS app is canonical. No files moved or deleted.

---

## Canonical frontend

**Repository-root vanilla JS application:**

```
/index.html
/assets/app.js
/assets/app.css
/assets/api.js
/assets/store.js
/assets/photos.js
/sw.js, /manifest.webmanifest
```

## Technology

Plain HTML/CSS/JS, no bundler, no framework, no build step. Served as static
files. PWA via `sw.js` + `manifest.webmanifest`, cache-busted with `?v=`
query params on `index.html`.

## Production relationship

**This is the frontend production actually serves.** Verified by directly
fetching `https://gwgc.cloud/` (read-only, no changes made) and byte-diffing
the response against this repo's git history:

- After stripping Cloudflare's injected bot-detection `<script>` (dynamic
  per-request, not part of the app), the live response is an **exact match**
  for `index.html` at commit `25f3d57` (`feat: GreenWave V2 release
  candidate with high-res logo, facility isolation, and full test suite`).
- `25f3d57` is a commit to the **root** `index.html`/`assets/*` — it does not
  touch `backend/app/web`.
- Production is currently **6 commits behind** this branch's HEAD
  (`cfb31c3`). It predates the SKU removal, division-scoped catalog, ledger
  relocation to History, and invoice/payment-RBAC UI work done on this
  branch — none of that is live yet, consistent with "Production: NOT
  DEPLOYED" for this branch's changes.
- Production nginx (`backend/infrastructure/nginx/app.gwgcservers.ca.conf`)
  serves `gwgc.cloud`/`app.gwgcservers.ca` from `/var/www/greenwave-app/dist`
  with `try_files $uri $uri/ /index.html` — a plain static-file root, not a
  SPA-router fallback for a hashed Vite bundle. The directory is named
  `dist` by deploy-script convention, not because the vanilla-JS app has a
  build step.

*(This audit could not reach the private `192.168.1.x` VM IPs cited in
earlier `FINAL_*` reports in this repo, and does not vouch for those internal
hash-matrix claims. What it does independently confirm, from the public
edge, is which app is live and at which commit — see above.)*

## Development server

`./serve.sh [port]` — `python3 -m http.server` over the repo root. No
install/build step; open `index.html` or serve it over HTTP for PWA
install/offline testing.

## Build process

None. Static files are deployed as-is. (`push-to-github.sh` /
`replace-repo-contents.sh` are publishing/sync helpers, not builds.)

## Legacy frontend status: `backend/app/web`

React 19 + Vite + react-router. **Stale, not canonical, not deployed:**

- Brought in by the `backend/` subtree merge (`30fb9da`) from the separate
  `FULL-INFRA-V.0001` backend repo, which had its own React web client.
- Last commit touching `backend/app/web/src` is `25f3d57` — the same commit
  currently live in production. **Every** subsequent frontend feature
  commit on this branch (SKU removal, division-scoped catalog, ledger→History
  move, invoice document/print rework, payment-RBAC UI, management RBAC
  polish — 10+ commits) touched only the root `assets/*`/`index.html`, never
  `backend/app/web`.
- Its `dist/` is git-ignored and not what `gwgc.cloud` serves (confirmed
  above by content diff, independent of the gitignore fact alone).
- `backend/docs/DEPLOYMENT.md` (inherited from the pre-merge backend repo)
  still describes building and deploying `app/web`'s Vite bundle. That
  document is stale relative to actual practice on this branch and should
  not be treated as the deploy procedure until/unless `app/web` is revived
  — see "Open discrepancy" below.
- It does still build cleanly (`npm run build` → `vite build` succeeds,
  verified this session) and does contain `Inventory.jsx`/`Invoices.jsx`
  pages, so it is not abandoned code that's broken — it's a parallel,
  unmaintained implementation that fell behind.

**Do not delete it in this pass** (per task instructions). It should not
receive new V2 feature work going forward — the evidence above shows the
project has already, in practice, standardized on the root app.

## Reasoning / evidence summary

| Question | Answer | Evidence |
|---|---|---|
| Intended for V2 production? | Root vanilla-JS app | All recent feature commits target it; unified `docs/V2_ARCHITECTURE.md` component map shows `/assets, /index.html` → `backend/app/api`, no mention of `app/web` as the client |
| Served by `gwgc.cloud` today? | Root vanilla-JS app | Live byte-diff match to commit `25f3d57`'s root `index.html` |
| Used by current feature branch? | Root vanilla-JS app | `git log --stat` on branch commits — `assets/*`/`index.html` changed repeatedly, `backend/app/web` untouched since `25f3d57` |
| Contains Inventory? | Both (only root is current) | Root: `#v-inventory` in `index.html` + renderers in `assets/app.js`. `app/web`: `src/pages/Inventory.jsx` (stale, pre-division-isolation) |
| Contains Materials Catalog? | Root only | `#v-catalog`/materials UI in root `assets/app.js`; no equivalent page in `app/web` |
| Contains Invoices? | Both (only root is current) | Root: `#v-invoices` + `renderInvoiceDocumentView`. `app/web`: `src/pages/Invoices.jsx`, `InvoiceDetails.jsx` (stale, pre-payment-RBAC) |
| Receives future UI changes? | Root vanilla-JS app | Follows directly from the above — it's the one with working history and the one production runs |

## Open discrepancy (flagged, not resolved in this pass)

`backend/docs/DEPLOYMENT.md` step 1 still says to build `app/web` and step 4
says to deploy its `dist/` to the nginx root. That is not what production
actually runs (see above). This document was inherited via the subtree
merge and was not updated when the project's real frontend work moved to
stay at the repo root. It should be corrected in a follow-up pass so an
operator following it doesn't accidentally try to ship the stale React app;
out of scope to edit here since this task is audit-only.
