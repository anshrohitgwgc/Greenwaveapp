# 🌿 GreenWave — Full Infrastructure & Application Platform
**Release Version**: `v0.1.0` · **Target Architecture**: `FULL INFRA V.0001`  
**Production Portal**: [gwgcservers.ca](https://gwgcservers.ca) · **Application Domain**: [gwgc.cloud](https://gwgc.cloud)

---

## 1. What GreenWave Is
GreenWave is an enterprise waste management, logistics, and resource recycling platform designed to streamline dispatching, pickup scheduling, driver route execution, photo verification, and high-availability infrastructure operations.

---

## 2. Repository Purpose
This repository serves as the **official source-controlled development and controlled integration repository** for the GreenWave ecosystem.

It provides a completely containerized and mockable local development environment so that engineers can build, test, and enhance the application locally without requiring or connecting to production infrastructure.

---

## 3. Production Architecture Overview

### Physical Compute Nodes
- **Rack Server 1** (`192.168.1.84`): HPE ProLiant Gen8 1U · Intel Xeon E5-2609 v3 (6 cores) · **60 GB ECC RAM** · 1 TB Storage (2x 500GB SATA Software RAID1)
- **Rack Server 2** (`192.168.1.176`): HPE ProLiant Gen8 2U · Intel Xeon E5-2640 v4 (10 cores / 20 threads) · **60 GB ECC RAM** · 4 TB Storage (4x 1TB SAS 10K RAID10)
- **Server 3 (Laptop Node)** (`192.168.1.177`): Mobile Compute Node · Intel Core i7-6600U (2 cores / 4 threads) · **16 GB RAM** · 512 GB NVMe SSD
- **Total Physical RAM**: **136 GB**

### Virtual Machine Topology (10 VMs)
```
Rack Server 1 (192.168.1.84)
├── VM 101: loadbalancer-1 (192.168.1.11) — NGINX Ingress & TLS Terminator
├── VM 102: api-1 (192.168.1.12)          — NestJS Core API (Node 1)
├── VM 103: worker (192.168.1.13)         — BullMQ Queue & Async Jobs
├── VM 104: redis (192.168.1.14)          — Redis 7 In-Memory Broker
└── VM 105: monitoring (192.168.1.15)     — Uptime Kuma & Management API (Port 3010)

Rack Server 2 (192.168.1.176)
├── VM 201: api-2 (192.168.1.21)          — NestJS Core API (Node 2)
├── VM 202: database (192.168.1.22)       — PostgreSQL 16 High-Performance DB
├── VM 203: photo-storage (192.168.1.23)  — MinIO S3 Object Storage Cluster
└── VM 204: loadbalancer-2 (192.168.1.24) — NGINX Failover Ingress

Server 3 / Laptop Node (192.168.1.177)
└── VM 301: api-3 (192.168.1.31)          — NestJS Fallback API (Node 3)
```

---

## 4. Repository Structure

```
FULL INFRA V.0001/
├── README.md                          # Platform documentation & master guide
├── .env.example                       # Safe environment template
├── .gitignore                         # Strict credential & build artifact ignore rules
├── package.json                       # Root workspace runner scripts
├── docs/                              # Detailed engineering specifications
│   ├── ARCHITECTURE.md                # System topology & hardware breakdown
│   ├── DEVELOPMENT.md                 # Local setup & daily dev workflows
│   ├── API-CONTRACT.md                # REST API specifications & schemas
│   ├── DATABASE.md                    # PostgreSQL 16 schemas & migration rules
│   ├── DEPLOYMENT.md                  # Staging-first promotion & manual deployment
│   ├── SECURITY.md                    # Zero-trust policies & authentication invariants
│   ├── TESTING.md                     # Automated testing guide
│   ├── RELEASE-PROCESS.md             # Semantic versioning & PR lifecycle
│   ├── ENVIRONMENT-VARIABLES.md       # Complete configuration reference
│   └── DISASTER-RECOVERY.md           # Backup & restoration runbooks
├── app/
│   ├── web/                           # Vite + React Operations Dashboard
│   ├── api/                           # NestJS Core API Microservice
│   └── mobile/                        # React Native / Expo Mobile App
│       ├── android/                   # Android build & release runbook
│       └── ios/                       # iOS TestFlight & App Store runbook
├── infrastructure/
│   ├── nginx/                         # Reverse proxy configs & TLS termination
│   ├── docker/                        # Local dev stack (Postgres, Redis, MinIO)
│   ├── monitoring/                    # Uptime Kuma monitors & alert rules
│   ├── proxmox/                       # Hypervisor VM allocation topology
│   └── scripts/                       # Local bootstrap & database seed utilities
├── tests/
│   ├── unit/                          # Unit test suites (Auth, Pricing)
│   ├── integration/                   # API endpoint integration tests
│   ├── security/                      # Secret leakage & injection tests
│   ├── load/                          # Autocannon load testing scripts
│   ├── failover/                      # Failover scenario specifications
│   └── smoke/                         # End-to-end smoke verification
├── database/
│   ├── migrations/                    # PostgreSQL DDL migrations
│   └── seeds/                         # Local development test fixtures
└── .github/
    └── workflows/                     # Automated GitHub Actions CI pipeline
```

---

## 5. Local Setup & Quick Start

```bash
# 1. Clone the repository
git clone <repo-url>
cd "FULL INFRA V.0001"

# 2. Automated Bootstrap (Docker + Migrations + Seeds + Dependencies)
./infrastructure/scripts/setup-local-dev.sh
```

### Starting Development Servers
```bash
# Terminal 1: Core API
npm run dev:api

# Terminal 2: Web Dashboard
npm run dev:web

# Terminal 3: Mobile App (Expo)
npm run dev:mobile
```

### Local Service Endpoints
- **Web App**: `http://localhost:5173`
- **Core API**: `http://localhost:3000`
- **MinIO S3**: `http://localhost:9000` (Console: `http://localhost:9001`)
- **PostgreSQL 16**: `localhost:5432` (`greenwave_dev` / `greenwave_dev`)
- **Redis 7**: `localhost:6379`

---

## 6. Automated Testing

```bash
# Run unit and security test suites
npm test

# Run API NestJS test suite
npm run test:api

# Build verification
npm run build
```

---

## 7. Git Branching Strategy
- `main`: Protected stable release baseline.
- `development`: Active integration branch.
- `feature/<name>`: Topic/feature branches branched from `development`.

---

## 8. Critical Production Safety Invariants
1. **Zero Production Access in Dev**: Local development must never connect directly to production databases, iLO interfaces, or hosts.
2. **Strict Authentication Separation**:
   - Management Console (`gwgcservers.ca`) accounts live strictly in SQLite `management-auth.db`.
   - Application Users live in PostgreSQL `192.168.1.22:5432` (`"user"` table).
   - Application users cannot authenticate to the Management Console.
3. **No Committed Secrets**: `.gitignore` strictly ignores `.env`, private keys (`.pem`, `.key`), certificates, and credentials.
