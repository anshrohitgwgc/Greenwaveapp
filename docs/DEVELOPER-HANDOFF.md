# 🌿 GreenWave Developer Handoff Guide

> [!IMPORTANT]
> **Production Isolation Policy**:  
> **"This repository is for local development. Production infrastructure is isolated and must never be accessed directly by developers."**

---

## 1. Quick Start & Clone Instructions

### Cloning the Repository
```bash
git clone git@github.com:Adiljaiswal/FULL-INFRA-V.0001.git
cd FULL-INFRA-V.0001
```

### Local Setup Command
Bootstrap the entire local development stack (Postgres 16, Redis 7, MinIO S3, database migrations, dev fixtures, and npm dependencies):

```bash
./infrastructure/scripts/setup-local-dev.sh
```

---

## 2. Local Service Endpoints

Once initialized, all application components run on your local machine:

| Component | Local URL / Port | Technology |
| :--- | :--- | :--- |
| **Web Operations App** | [http://localhost:5173](http://localhost:5173) | Vite + React SPA |
| **Core REST API** | [http://localhost:3000](http://localhost:3000) | NestJS Microservice |
| **MinIO S3 API** | [http://localhost:9000](http://localhost:9000) | MinIO Object Storage |
| **MinIO Console** | [http://localhost:9001](http://localhost:9001) | S3 Web Console (`minioadmin` / `minioadmin123`) |
| **PostgreSQL 16 DB** | `localhost:5432` | DB: `greenwave_dev` · User: `greenwave_dev` |
| **Redis 7 Broker** | `localhost:6379` | In-memory cache & job broker |

---

## 3. Development Test Credentials

Development seed fixtures are automatically provisioned in local PostgreSQL (`database/seeds/001_dev_users.sql`).

**Default Local Dev Password**: `DevPassword123!`

| Role | Email | Use Case / Permissions |
| :--- | :--- | :--- |
| **Admin** | `admin@greenwave.local` | Full application administration & pricing tier config |
| **Manager** | `manager@greenwave.local` | Fleet logistics dispatching & route management |
| **Staff** | `staff@greenwave.local` | Pickup order intake & customer service |
| **Driver** | `driver@greenwave.local` | Mobile driver job completion & actual weight entry |

---

## 4. Daily Development Workflows

### Starting Development Servers
```bash
# Terminal 1: Start NestJS API
npm run dev:api

# Terminal 2: Start Vite Web Frontend
npm run dev:web

# Terminal 3: Start React Native / Expo Mobile App
npm run dev:mobile
```

### Running Test Suites
```bash
# Run root unit and secret hygiene security tests
npm test

# Run NestJS API unit and service tests
npm run test:api

# Verify production builds
npm run build
```

---

## 5. Branch & Pull Request Workflow

All code contributions must follow the structured branching workflow:

```
feature/<feature-name>  ──(PR)──>  development  ──(Release PR)──>  main (vX.Y.Z)
```

1. **Create Feature Branch**:
   ```bash
   git checkout development
   git pull origin development
   git checkout -b feature/your-feature-name
   ```
2. **Local Validation**:
   - Run `npm test` and `npm run test:api` to verify all tests pass.
   - Run `npm run build` to ensure zero compilation or bundle errors.
3. **Submit Pull Request**:
   - Open PR targeting the `development` branch.
   - Ensure automated GitHub Actions CI tests pass.
   - Require code review before merge.

---

## 6. Prohibited Actions & Production Safety Rules

To ensure strict production isolation and security compliance, developers are **strictly prohibited** from:

- ❌ **Connecting to Production IPs**: Never target `192.168.1.11` through `192.168.1.31` directly.
- ❌ **Production Domains**: Never use `gwgcservers.ca` or `gwgc.cloud` in local development code or tests.
- ❌ **Production Credentials**: Never request, store, or commit production passwords, SSH private keys, TLS certificates, iLO credentials, or Proxmox tokens.
- ❌ **Direct Production Deploys**: All deployments are managed exclusively through staging-first promotion by authorized DevOps administrators.
- ❌ **Committing `.env` Files**: Only `.env.example` templates may be committed. All local `.env` files are strictly gitignored.
