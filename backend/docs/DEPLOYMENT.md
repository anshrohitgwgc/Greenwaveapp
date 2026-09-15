# Deployment & Staging Promotion Guide

## 1. Staging-First Lifecycle
All code changes must follow the strict deployment progression:

```
Local Development
       ↓
GitHub Pull Request & Review
       ↓
Automated CI Checks (Build + Test + Lint + Security)
       ↓
Staging Environment (staging.gwgcservers.ca)
       ↓
End-to-End & Load Verification
       ↓
Production Deployment (Manual & Controlled)
```

---

## 2. Production Deployment Steps (Manual Execution)

1. **Build Artifacts Locally / on Staging VM**:
   ```bash
   # Build NestJS API
   cd app/api && npm ci && npm run build

   # Build Vite React Web App
   cd app/web && npm ci && npm run build
   ```

2. **Execute Database Migrations**:
   ```bash
   # Run only new incremental migrations against 192.168.1.22
   psql -h 192.168.1.22 -U greenwave_prod -d greenwave_prod -f database/migrations/00X_new_migration.sql
   ```

3. **Deploy Backend to API Nodes**:
   - `api-1` (`192.168.1.12:3000`)
   - `api-2` (`192.168.1.21:3000`)
   - `api-3` (`192.168.1.31:3000`)
   - Restart systemd services sequentially (zero-downtime rolling restart).

4. **Deploy Web Frontend Assets**:
   - Deploy compiled `dist/` bundle to NGINX root `/var/www/greenwave-app/dist` on `loadbalancer-1` (`192.168.1.11`).

5. **Verify Cluster Health**:
   ```bash
   curl -sSf http://192.168.1.12:3000/health
   curl -sSf http://192.168.1.21:3000/health
   curl -sSf http://192.168.1.31:3000/health
   curl -sSf https://gwgcservers.ca/api/v1/health
   ```

---

## 3. Rollback Procedure
If any health check fails or an anomaly is detected:
1. Re-point NGINX upstream to previous stable release directory or backup API node.
2. If database migration was executed, apply the corresponding rollback migration script.
3. Reload NGINX gracefully: `sudo systemctl reload nginx`.
