# PRODUCTION RELEASE CHECKLIST — GREENWAVE V2

**Branch:** `greenwave-v2`  
**Baseline Commit:** `51af5b332f2d704c6554e4d46de94bec73d74740`  
**Timestamp:** `2026-08-29T21:48:00-07:00`  
**Deployment Target:** `https://gwgc.cloud` (Frontend) / `https://api.gwgc.cloud` (API)  
**Release State:** **RELEASE CANDIDATE (DO NOT DEPLOY WITHOUT APPROVAL)**

---

## 1. Quality & Test Gate Results

| Test Category | Expected | Actual Result | Status |
|---|---|---|---|
| **Playwright E2E Suite** | 27 / 27 passing | `27 passed, 0 failed, 0 skipped` (Duration: 1.1m) | **PASS** |
| **Backend Unit Tests (Jest)** | 104 / 104 passing | `104 passed, 0 failed` (20 suites) | **PASS** |
| **Backend Lint (ESLint)** | 0 errors | `0 errors, 0 warnings` | **PASS** |
| **Backend Build (NestJS)** | Exit code 0 | `dist/main.js` built successfully | **PASS** |
| **Frontend Build (Vite SPA)** | Exit code 0 | `dist/index.html`, `dist/assets/*` generated | **PASS** |
| **Direct API 403 Security** | 100% rejection on unauthorized facilities | Verified across `/inventory`, `/containers`, `/photos`, `/timesheets` | **PASS** |
| **Console & Network Errors** | 0 unexpected errors | `0 console errors, 0 unhandled promise rejections` | **PASS** |

---

## 2. Component & Architecture Readiness

| Component | Target Environment | Verified State | Status |
|---|---|---|---|
| **Branding Logo** | Frontend App Header & Invoices | High-resolution user-supplied asset is **unavailable**; fallback Unicode glyph (`♻ GreenWave`) active | **BLOCKED (SOURCE UNAVAILABLE)** |
| **PostgreSQL Database** | Port `5432` / `greenwave_prod` | 19 tables verified, 13 SQL migrations complete, `inventory_balances` dynamic view active, `synchronize: false` | **PASS** |
| **API Server (NestJS)** | `https://api.gwgc.cloud` (Nodes 1-3) | Multi-node stateless cluster, JWT Bearer guard, 2D warehouse/division RBAC, rate-limiting active | **PASS** |
| **Frontend SPA (Vite)** | `https://gwgc.cloud` (VM101 / Nginx) | React 19 SPA, Responsive 5-viewport verified, Lightbox modal, Live timer ticker, Invoice print/PDF | **PASS** |
| **Redis Cache & Queue** | Port `6379` | Session tokens, fixed-window login rate limiting (10 attempts/min) | **PASS** |
| **MinIO S3 Storage** | Port `9000` / Bucket `greenwave-photos` | S3 object storage for multi-facility evidence photos with presigned URLs | **PASS** |
| **Service Worker & Cache** | `sw.js` | Versioned offline cache (`greenwave-v14`), API paths bypassed, claim on activate | **PASS** |

---

## 3. Rollback Backup Verification

Fresh verified backups with SHA256 checksums available in `/home/ansh/backups`:

| Archive / Dump File | Size | SHA256 Checksum |
|---|---|---|
| `greenwave_prod_pre_v2_20260829_091217.dump` | `82.4 KB` | `6d300def41247f6b525e82091f9cca82b6ae1d3f90e7200be2381777b829f200` |
| `frontend_192.168.1.11_20260829_091217.tar.gz` | `194.3 KB` | `941ae35fe21f6fcb35744a87cc009f59eb17a1d94832c6634a7556620f8c330f` |
| `api_node1_192.168.1.12_20260829_091217.tar.gz` | `26.8 MB` | `27b2e53febdc828b9af55265ec7b5bfe728049277d95ba571ad38a7b7d8cd623` |
| `api_node2_192.168.1.21_20260829_091217.tar.gz` | `31.6 MB` | `f2120374508851739400a759f887daca1ab077111fda3c5a358e732b8f6d8cf7` |
| `api_node3_192.168.1.31_20260829_091217.tar.gz` | `26.8 MB` | `bfd81ca7585537b949fc1ba4a551fc132f21860c6b2794c48c0de0752e56126c` |
| `nginx_greenwave_20260829_091217.tar.gz` | `8.3 KB` | `420c5d7449361b239ed6e7c6b008158cba5cf78af54422c685ba52d8df73aa69` |

---

## 4. Management Boundary Isolation

* **192.168.1.15 (VM105)**: UNMODIFIED & UNTOUCHED.
* **Management Portal (`www.gwgcservers.ca`)**: UNMODIFIED & UNTOUCHED.
* **Management API (`mgmt-api.gwgcservers.ca`)**: UNMODIFIED & UNTOUCHED.
* **N8N Workflow Engine (`n8n.gwgcservers.ca`)**: UNMODIFIED & UNTOUCHED.
