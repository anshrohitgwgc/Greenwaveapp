# GreenWave Recycling Inc. — Production Deployment Runbook

**Target Subsystems:** Payments + Finance & Accounting Ledger + Banking & Reconciliation + Employee Operations  
**Primary Domain:** `https://gwgc.cloud`  
**Customer Payment Domain:** `https://pay.gwgcservers.ca`  
**Target Branch:** `greenwave-payment-rbac-ui`  
**Status:** STAGED FOR EXECUTION (Do not execute without operational authorization)

---

## 1. Verified Production Topology Reference

| Host / Node | Role | Network IP | Tailscale IP | Service / Path | OS User |
|---|---|---|---|---|---|
| **VM101** | NGINX Reverse Proxy & Web Server | `192.168.1.11` | `100.92.13.110` | Webroot: `/var/www/greenwave-app/dist` | `ansh` / `www-data` |
| **API Node 1** | NestJS Core API (Active) | `192.168.1.12` | — | `/opt/greenwave/greenwave-api` (`greenwave-api.service`) | `ansh` |
| **API Node 2** | NestJS Core API (Active) | `192.168.1.21` | — | `/opt/greenwave/greenwave-api` (`greenwave-api.service`) | `ansh` |
| **API Node 3** | NestJS Core API (Backup Upstream) | `192.168.1.31` | — | `/opt/greenwave/greenwave-api` (`greenwave-api.service`) | `ansh` |
| **DB Node** | PostgreSQL 16 Cluster | `192.168.1.22` | — | Database: `greenwave` (Port: 5432) | `greenwave` / `postgres` |
| **Redis Node** | Redis 7 & Rate Limiter | `192.168.1.14` | — | Port: 6379 | `redis` |
| **Cloudflare** | Edge SSL & DNS Proxy | Edge | — | `gwgc.cloud`, `pay.gwgcservers.ca` | Managed |

---

## 2. Pre-Deployment Verification & Release Commit Status

- **Working Tree State:** All Payments, Finance, and Employee Operations implementations reside on branch `greenwave-payment-rbac-ui`.
- **Pre-Release Git Packaging:** Prior to deployment, create a clean release commit or build archive:
  ```bash
  # On deployment staging workstation (/home/ansh/Greenwaveapp):
  git status
  # Verify working tree contains all necessary feature files:
  # backend/database/migrations/019_stripe_payments_v2.sql
  # backend/database/migrations/020_accounting_ledger.sql
  # backend/database/migrations/021_banking_reconciliation_payables.sql
  # backend/database/migrations/022_employee_operations.sql
  # backend/app/api/src/accounting/, banking/, payables/, employees/, payments/, stripe/, mail/
  # index.html, assets/*, sw.js
  ```

---

## 3. Step-by-Step Deployment Procedure

### PHASE A: Pre-Flight Safety Checks
Confirm connectivity to all cluster nodes:
```bash
# 1. Verify SSH access to all API nodes and NGINX VM
ssh ansh@192.168.1.31 'echo API-3 CONNECTED'
ssh ansh@192.168.1.21 'echo API-2 CONNECTED'
ssh ansh@192.168.1.12 'echo API-1 CONNECTED'
ssh ansh@192.168.1.11 'echo NGINX-VM101 CONNECTED'

# 2. Verify current API health across all nodes
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.1.31:3000/health # expect 200
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.1.21:3000/health # expect 200
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.1.12:3000/health # expect 200
```

---

### PHASE B: Production Database Backup
Before executing any schema changes, take a full pre-cutover PostgreSQL binary dump:
```bash
# On Database Node (192.168.1.22) or via authorized administrative workstation:
# Using existing environment authentication (.pgpass or local postgres peer auth):
pg_dump -h 192.168.1.22 -U greenwave -Fc greenwave > /opt/greenwave/backups/greenwave_pre_financeops_$(date +%Y%m%d_%H%M%S).dump

# Verify dump file was created and is non-empty:
ls -lh /opt/greenwave/backups/greenwave_pre_financeops_*.dump
```

---

### PHASE C: Database Migrations Execution
Execute migrations in exact chronological dependency order against the production database **`greenwave`**:

```bash
# Connect to Database Node (192.168.1.22)
# Migration 019: Stripe payments, minor units, provider_events, refunds, payment token hash
psql -h 192.168.1.22 -U greenwave -d greenwave -f backend/database/migrations/019_stripe_payments_v2.sql

# Migration 020: Double-entry general ledger, chart of accounts, balance trigger, Stripe mirror
psql -h 192.168.1.22 -U greenwave -d greenwave -f backend/database/migrations/020_accounting_ledger.sql

# Migration 021: Financial accounts, CSV import batches, bank reconciliation, payables & bills
psql -h 192.168.1.22 -U greenwave -d greenwave -f backend/database/migrations/021_banking_reconciliation_payables.sql

# Migration 022: Workforce directory, attendance records, leave balances & requests
psql -h 192.168.1.22 -U greenwave -d greenwave -f backend/database/migrations/022_employee_operations.sql
```

#### Post-Migration Verification Queries
```sql
-- Connect to database: psql -h 192.168.1.22 -U greenwave -d greenwave
-- 1. Verify Migration 019
SELECT count(*) FROM provider_events;
SELECT count(*) FROM payment_refunds;
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'amount_minor';

-- 2. Verify Migration 020
SELECT count(*) FROM ledger_accounts;
SELECT count(*) FROM journal_entries;
SELECT proname FROM pg_proc WHERE proname = 'gw_assert_entry_balanced';

-- 3. Verify Migration 021
SELECT count(*) FROM financial_accounts;
SELECT count(*) FROM bank_reconciliations;
SELECT count(*) FROM bills;

-- 4. Verify Migration 022
SELECT count(*) FROM employees;
SELECT count(*) FROM attendance_records;
SELECT count(*) FROM leave_balances;
SELECT count(*) FROM leave_requests;
```

---

### PHASE D: Rolling API Cluster Deployment
Deploy API nodes in ordered sequence: **`.31` (backup) → `.21` (active) → `.12` (active)**.  
At all times, at least two API nodes remain active in NGINX.

#### Step D.1: Build API Artifact
```bash
# On deployment workstation (/home/ansh/Greenwaveapp/backend/app/api):
npm ci --no-audit --no-fund
npm run build # compiles to dist/
tar -czf /tmp/greenwave-api-release.tar.gz dist/ package.json package-lock.json
```

#### Step D.2: Node 192.168.1.31 (Backup Node)
```bash
# 1. Transfer artifact
scp /tmp/greenwave-api-release.tar.gz ansh@192.168.1.31:/tmp/

# 2. Deploy on node
ssh ansh@192.168.1.31 '
  sudo systemctl stop greenwave-api.service
  cp -r /opt/greenwave/greenwave-api /opt/greenwave/greenwave-api.bak-$(date +%Y%m%d_%H%M%S)
  tar -xzf /tmp/greenwave-api-release.tar.gz -C /opt/greenwave/greenwave-api/
  cd /opt/greenwave/greenwave-api && npm ci --omit=dev --no-audit --no-fund
  sudo systemctl start greenwave-api.service
'

# 3. Health check
sleep 3
curl -f http://192.168.1.31:3000/health || (echo "API-3 Failed" && exit 1)
```

#### Step D.3: Node 192.168.1.21 (Active Node 2)
```bash
# 1. Transfer artifact
scp /tmp/greenwave-api-release.tar.gz ansh@192.168.1.21:/tmp/

# 2. Deploy on node
ssh ansh@192.168.1.21 '
  sudo systemctl stop greenwave-api.service
  cp -r /opt/greenwave/greenwave-api /opt/greenwave/greenwave-api.bak-$(date +%Y%m%d_%H%M%S)
  tar -xzf /tmp/greenwave-api-release.tar.gz -C /opt/greenwave/greenwave-api/
  cd /opt/greenwave/greenwave-api && npm ci --omit=dev --no-audit --no-fund
  sudo systemctl start greenwave-api.service
'

# 3. Health check
sleep 3
curl -f http://192.168.1.21:3000/health || (echo "API-2 Failed" && exit 1)
```

#### Step D.4: Node 192.168.1.12 (Active Node 1)
```bash
# 1. Transfer artifact
scp /tmp/greenwave-api-release.tar.gz ansh@192.168.1.12:/tmp/

# 2. Deploy on node
ssh ansh@192.168.1.12 '
  sudo systemctl stop greenwave-api.service
  cp -r /opt/greenwave/greenwave-api /opt/greenwave/greenwave-api.bak-$(date +%Y%m%d_%H%M%S)
  tar -xzf /tmp/greenwave-api-release.tar.gz -C /opt/greenwave/greenwave-api/
  cd /opt/greenwave/greenwave-api && npm ci --omit=dev --no-audit --no-fund
  sudo systemctl start greenwave-api.service
'

# 3. Health check
sleep 3
curl -f http://192.168.1.12:3000/health || (echo "API-1 Failed" && exit 1)
```

---

### PHASE E: Frontend Deployment to VM101 (`/var/www/greenwave-app/dist`)
The frontend is pure vanilla JavaScript at `/index.html`, `/assets/*`, `/sw.js`, and `/manifest.webmanifest`.

```bash
# 1. Create a backup of currently deployed live frontend on VM101 (192.168.1.11)
ssh ansh@192.168.1.11 '
  sudo tar -czf /home/ansh/backups/frontend_pre_financeops_$(date +%Y%m%d_%H%M%S).tar.gz -C /var/www/greenwave-app/dist .
'

# 2. Stage new frontend files to VM101 staging directory
scp index.html sw.js manifest.webmanifest ansh@192.168.1.11:/home/ansh/frontend-release/
scp -r assets/ ansh@192.168.1.11:/home/ansh/frontend-release/

# # 3. Sync staging files to the verified canonical production webroot
ssh ansh@192.168.1.11 '
  sudo rsync -avz --delete /home/ansh/frontend-release/ /var/www/greenwave-app/dist/
  sudo chown -R www-data:www-data /var/www/greenwave-app/dist
  sudo find /var/www/greenwave-app/dist -type d -exec chmod 755 {} \;
  sudo find /var/www/greenwave-app/dist -type f -exec chmod 644 {} \;
'
```

---

### PHASE F: NGINX Verification
Static asset updates are served directly from disk without restarting or reloading NGINX. NGINX reload is required **only** if `.conf` site configuration files change:
```bash
# Execute ONLY if NGINX site configuration was modified:
ssh ansh@192.168.1.11 '
  sudo nginx -t
  sudo systemctl reload nginx
'
```

---

### PHASE G: Stripe Webhook Verification
Test that the production ingress endpoint is reachable and actively enforcing cryptographic signatures:
```bash
# Send an unsigned test ping to the webhook endpoint
curl -i -X POST https://gwgc.cloud/api/payments/stripe/webhook \
  -H "Content-Type: application/json" \
  -d '{"test": true}'

# Expected response: HTTP 400 Bad Request
# Message: Missing stripe-signature header or webhook signature verification failed
```

---

### PHASE H: Public Payment Portal Verification
Verify that `https://pay.gwgcservers.ca` is live, serving the updated frontend, and resolving payment links:
```bash
# 1. Verify root returns HTTP 200
curl -I https://pay.gwgcservers.ca/

# 2. Verify an invalid/unknown token returns uniform 404
curl -i https://pay.gwgcservers.ca/api/public/pay/0000000000000000000000000000000000000000000000000000000000000000
# Expected response: 404 Not Found {"message": "This payment link is invalid or has expired."}

# 3. Verify asset cache-busting headers
curl -I https://gwgc.cloud/assets/app.js?v=20260913_financeops
```

---

### PHASE I: Post-Deployment Smoke Tests
1. **Administrative Login:** Log into `https://gwgc.cloud` using existing admin credentials.
2. **Navigation Grouping:** Confirm navigation sidebar shows "Sales", "Finance & Banking", and "People & Operations" groups.
3. **General Ledger & P&L:** Navigate to `#v-chartofaccounts` and `#v-profitloss`; confirm accounts load without errors.
4. **Employee Directory:** Navigate to `#v-employees`; confirm directory lists staff and department cards.
5. **Service Worker Update:** Confirm browser console reports cache `greenwave-v24-payments-finance-ops` activated.

---

### PHASE J: Rollback & Abort Conditions

#### Abort Conditions
Trigger immediate rollback if:
1. Any API node fails to start or `/health` does not return 200 within 30 seconds.
2. Database migration fails with syntax or constraint error.
3. NGINX returns 502 Bad Gateway on `https://gwgc.cloud/api/health`.

#### API Rollback
```bash
# On the failed node (e.g. 192.168.1.21):
ssh ansh@192.168.1.21 '
  sudo systemctl stop greenwave-api.service
  cp -r /opt/greenwave/greenwave-api.bak-* /opt/greenwave/greenwave-api/
  sudo systemctl start greenwave-api.service
'
```

#### Frontend Rollback
```bash
ssh ansh@192.168.1.11 '
  sudo tar -xzf /home/ansh/backups/frontend_pre_financeops_*.tar.gz -C /var/www/greenwave-app/dist/
  sudo chown -R www-data:www-data /var/www/greenwave-app/dist
  sudo find /var/www/greenwave-app/dist -type d -exec chmod 755 {} \;
  sudo find /var/www/greenwave-app/dist -type f -exec chmod 644 {} \;
'
```

#### Database Migration Rollback vs Emergency Disaster Recovery
1. **Transactional Migration Rollback (Normal Mitigation):**
   - Each migration script (`019`, `020`, `021`, `022`) is wrapped in an atomic transaction (`BEGIN; ... COMMIT;`).
   - If any statement within a migration fails, PostgreSQL automatically aborts the transaction and rolls back all changes made by that migration before commit. The database remains in its pre-migration state.
2. **Emergency Full Database Restore (Disaster Recovery Only):**
   - **Do NOT use `pg_restore --clean` as a standard rollback.**
   - Restoring a full database dump is a destructive, cluster-wide emergency disaster-recovery procedure that drops existing tables and discards all data written since the backup timestamp.
   - It requires explicit incident commander authorization and verified maintenance downtime:
     ```bash
     # EMERGENCY ONLY - DISASTER RECOVERY
     pg_restore -h 192.168.1.22 -U greenwave -d greenwave --clean --if-exists /opt/greenwave/backups/greenwave_pre_financeops_<timestamp>.dump
     ```
