# FINAL PRODUCTION CUTOVER REPORT — GREENWAVE V2

**SOURCE COMMIT:** `25f3d57f935b558ebe74af2112ba320a99018a06`  
**DEPLOYED COMMIT:** `25f3d57f935b558ebe74af2112ba320a99018a06`  
**FRONTEND HASH (`index.html`):** `d02fa0ea8bc8a7d2f57d9cde371a24196bebbd8a96f5c0bbcd28c65540d83d11`  
**BACKEND HASH (`dist/main.js`):** `f1e5da35485e489a77244ab142c588cc9be6fa204e9016c88507e13ec39a7f06`  
**LOGO HASH (`assets/logo.png`):** `42909d88809a9a7ad69b74caff0700ac27f35987048381373c1b9b2a3b6b466c`  
**SERVICE WORKER VERSION:** `greenwave-v15`  
**TIMESTAMP:** `2026-08-29T22:12:00-07:00`  

---

## 1. Production Service & Cluster Verification

| Target / Component | Network / Host | SHA256 Hash / Status | Verdict |
|---|---|---|---|
| **API Node 3** | `192.168.1.31:3000` | `f1e5da35485e489a77244ab142c588cc9be6fa204e9016c88507e13ec39a7f06` | **HEALTHY / LIVE** |
| **API Node 2** | `192.168.1.21:3000` | `f1e5da35485e489a77244ab142c588cc9be6fa204e9016c88507e13ec39a7f06` | **HEALTHY / LIVE** |
| **API Node 1** | `192.168.1.12:3000` | `f1e5da35485e489a77244ab142c588cc9be6fa204e9016c88507e13ec39a7f06` | **HEALTHY / LIVE** |
| **API Cluster Gateway** | `https://api.gwgc.cloud` | Multi-node load balanced cluster (`/health` → HTTP 200) | **HEALTHY / LIVE** |
| **Frontend Staging** | `192.168.1.11` (`/home/ansh/frontend-release`) | `d02fa0ea8bc8a7d2f57d9cde371a24196bebbd8a96f5c0bbcd28c65540d83d11` | **STAGED / READY** |
| **Public Frontend** | `https://gwgc.cloud` | Cloudflare SSL edge proxy → VM101 (`HTTP 200 OK`) | **HEALTHY / LIVE** |
| **NGINX Reverse Proxy** | `192.168.1.11:443` | Upstreams active, SSL valid, dynamic proxy to cluster | **HEALTHY / LIVE** |
| **PostgreSQL 16** | `192.168.1.13:5432` | 19 tables + `inventory_balances` dynamic view, non-destructive | **HEALTHY / LIVE** |
| **Redis 7** | `192.168.1.14:6379` | Connectivity verified (`PONG`), fixed-window rate limiter active | **HEALTHY / LIVE** |
| **MinIO S3 Storage** | `192.168.1.14:9000` | `greenwave-photos` bucket ready, presigned URL proxying active | **HEALTHY / LIVE** |

---

## 2. Production Database Counts & Integrity

| Table | Pre-Cutover Count | Post-Cutover Count | Status |
|---|---|---|---|
| `user` | 6 | 6 | **INTACT** |
| `warehouses` | 6 | 6 | **INTACT** |
| `user_warehouses` | 8 | 8 | **INTACT** |
| `roles` | 3 | 3 | **INTACT** |
| `permissions` | 15 | 15 | **INTACT** |
| `materials` | 9 | 9 | **INTACT** |
| `containers` | 17 | 17 | **INTACT** |
| `inventory_transactions` | 110 | 110 | **INTACT** |
| `timesheets` | 28 | 28 | **INTACT** |
| `invoices` | 11 | 11 | **INTACT** |
| `invoice_items` | 12 | 12 | **INTACT** |
| `audit_events` | 376 | 376 | **INTACT** |

---

## 3. Verified Rollback Backups

| Backup File Path | Size | SHA256 Digest |
|---|---|---|
| `/home/ansh/backups/greenwave_prod_pre_cutover_20260830_050155.dump` | `110.8 KB` | `7ee0cdfab660130f81fcaea0cd2edd36eafce9a439b9c0821deb32edb143dd3f` |
| `/home/ansh/backups/api_node1_192.168.1.12_20260830_050155.tar.gz` | `26.4 MB` | `c99f9720f0dee11b1be9372fca35e374324b76c15777015f91ebf9e84a0b39fe` |
| `/home/ansh/backups/api_node2_192.168.1.21_20260830_050155.tar.gz` | `31.3 MB` | `adcc7e5d81fac8c828a9f3e29976e58cd1df1da5ebb6c05cd751002b525c8ed5` |
| `/home/ansh/backups/api_node3_192.168.1.31_20260830_050155.tar.gz` | `26.5 MB` | `c0f5ba72d00a8ef59dbf36e84ea030df287c443c6629b449f69b3a7e24fe6f1a` |
| `/home/ansh/backups/frontend_192.168.1.11_20260830_050155.tar.gz` | `237.1 KB` | `db7ef1056aea868a63ebfee8ae4235877ca9dc0b0cec7f7b98e7c484e82b7bb1` |
| `/home/ansh/backups/nginx_greenwave_20260830_050155.tar.gz` | `3.4 KB` | `153c585a0660fb6d15dc3e21d6e91039817fa8e1a4486828772d1e91443d054f` |

---

## 4. Management Boundary Isolation (VM105)

* **Management Portal (`https://www.gwgcservers.ca`)**: `HTTP 200 OK` (Unmodified & Untouched)
* **Management API (`https://mgmt-api.gwgcservers.ca/health`)**: `HTTP 200 OK` (Unmodified & Untouched)
* **N8N Workflow Engine (`https://n8n.gwgcservers.ca/healthz`)**: `HTTP 200 OK` (Unmodified & Untouched)

---

## 5. Final Release Verification Checklist

- **LOGIN:** PASS
- **RBAC:** PASS
- **WAREHOUSE ACCESS:** PASS
- **DIVISION ISOLATION:** PASS
- **INVENTORY:** PASS
- **PHOTOS:** PASS
- **TIME CLOCK:** PASS
- **INVOICE:** PASS
- **CHAT:** PASS
- **MOBILE (390x844, 430x932):** PASS
- **DESKTOP (768x1024, 1366x768, 1920x1080):** PASS
- **CONSOLE ERRORS:** 0
- **NETWORK FAILURES:** 0
- **ROLLBACK:** READY
- **MANAGEMENT PORTAL:** UNCHANGED
- **N8N:** UNCHANGED
- **PRODUCTION:** LIVE

---

## 6. Final Verdict

**FINAL VERDICT: PASS — PRODUCTION LIVE**
