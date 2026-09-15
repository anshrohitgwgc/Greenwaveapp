# Local Development Guide

## 1. Prerequisites
- **Node.js**: v20.x or v22.x LTS
- **Docker & Docker Compose**: v2.20+
- **Git**: v2.30+

> [!IMPORTANT]
> **Production Safety Rule**: Local development must NEVER connect to production servers, databases, or iLO BMC interfaces. All work is done locally using Dockerized dependencies or unit test mocks.

---

## 2. Quick Start (Automated Bootstrap)

```bash
# 1. Clone repository
git clone <repository_url>
cd "FULL INFRA V.0001"

# 2. Run local setup script
./infrastructure/scripts/setup-local-dev.sh
```

This will automatically:
- Spin up PostgreSQL 16, Redis 7, and MinIO S3 in Docker
- Run database migrations (`database/migrations/`)
- Seed test users and sample pickups (`database/seeds/`)
- Install all npm dependencies for API and Web

---

## 3. Running Services Individually

### API (NestJS)
```bash
cd app/api
npm install
npm run start:dev
# Running on http://localhost:3000
```

### Web Dashboard (Vite + React)
```bash
cd app/web
npm install
npm run dev
# Running on http://localhost:5173
```

### Mobile Application (Expo / React Native)
```bash
cd app/mobile
npm install
npx expo start
# Scan QR code with Expo Go (Android/iOS)
```

---

## 4. Test Accounts in Local Environment
All development accounts use the test password: `Password123!`

| Role | Email | Purpose |
| :--- | :--- | :--- |
| **Admin** | `admin@greenwave.local` | Full application administration & pricing rules |
| **Manager** | `manager@greenwave.local` | Fleet dispatching & route management |
| **Staff** | `staff@greenwave.local` | Pickup job creation & customer service |
| **Driver** | `driver@greenwave.local` | Mobile driver job completion & weight entry |
