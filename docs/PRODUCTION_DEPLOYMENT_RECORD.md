# GreenWave Operations Platform — Production Deployment Record

This record documents the final production deployment of the GreenWave V2 Web Application.

---

## 1. Deployment Metadata
- **Repository**: https://github.com/anshrohitgwgc/Greenwaveapp.git
- **Release Branch**: greenwave-v2 (merged from greenwave-operations-upgrade)
- **Release Target**: Production Web Application (https://gwgc.cloud) and API Cluster (https://api.gwgc.cloud)
- **Deployment Date**: 2026-08-29
- **Lead Operator**: Antigravity Operations Engineer

---

## 2. Release Features Included
1. **Authentication**: Email + Password only, no public signup, admin-only staff provisioning, bcrypt (12 rounds), JWT tokens.
2. **Multi-Warehouse Facilities**: Calgary, AB (22222222-2222-4222-8222-222222222222), Ontario (33333333-3333-4333-8333-333333333333), Maple Ridge, BC (11111111-1111-4111-8111-111111111111) with strict isolation across all queries.
3. **Excel-Aligned Inventory Engine**: Direct reproduction of GreenWave Excel workbook (Inbound Order #, Container #, Seal #, Product, XL, L, M, S, and automated TOTAL = XL + L + M + S on input + server validation). Dynamic ledger-derived balances: Stock = Inbound - Outbound ± Adjustments.
4. **Container & Loading Traceability**: Container number, seal number, BL number, shipping line, ETA, status, notes, and size breakdowns.
5. **Controlled Adjustments**: Restricted to Admin & Manager with mandatory reason tracking; audit logged.
6. **Global Staff Chat**: PostgreSQL persistent chat via chat_messages table, SSE real-time stream (/chat/stream), Teams/Slack UI, friendly timestamps.
7. **Staff Time Clock**: Clock-in, clock-out, 30s live ticker, duplicate active shift rejection (409 Conflict).
8. **Operational Photos**: MinIO S3 backed, GPS EXIF stripping, warehouse scoping, and IDOR protection.
9. **Authoritative Invoice Creator**: Direct visual and functional reproduction of Greenwave Ops.pdf (3 pages), free-text fields, rebate deduction lines, provincial tax rates (GST/HST), and server-authoritative numbering.
10. **CSV Export**: RFC 4180 compliant UTF-8 export for Balances and Transaction Ledgers.

---

## 3. Production Infrastructure Topology

| Role | Node / Endpoint | IP / Port | Verification Status |
| :--- | :--- | :--- | :--- |
| **Frontend Web** | https://gwgc.cloud | VM101 (192.168.1.11) | Active / NGINX |
| **API Node 1** | https://api.gwgc.cloud | 192.168.1.12:3000 | Active / NestJS |
| **API Node 2** | https://api.gwgc.cloud | 192.168.1.21:3000 | Active / NestJS |
| **API Node 3** | https://api.gwgc.cloud | 192.168.1.31:3000 | Active / NestJS |
| **Background Worker** | Internal Worker | 192.168.1.13 | Active |
| **Cache & Queue** | Redis 7 | 192.168.1.14:6379 | Active |
| **Primary Database** | PostgreSQL 16 | 192.168.1.22:5432 | Active (Migration 011 applied) |
| **Object Storage** | MinIO S3 | 192.168.1.23:9000 | Active (Bucket: photos) |
| **Management VM** | gwgcservers.ca | 192.168.1.15 | **UNCHANGED / UNTOUCHED** |

---

## 4. Quality Gate Verification
- **Total Test Suites**: 19 NestJS API suites + 9 Unit & Security suites
- **Total Tests Passed**: **89 / 89 (100%)**
- **Lint**: 0 errors (npm run lint code 0)
- **Build**: 0 errors (nest build code 0)
- **Frontend Syntax**: 0 errors across all static assets
- **Security Check**: 0 private keys or real credentials committed
