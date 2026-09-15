# GreenWave Infrastructure & Software Architecture

## 1. System Overview
GreenWave is an enterprise waste management and logistics platform consisting of:
1. **GreenWave Web App** (`app/web`): React + Vite operational interface for dispatchers, managers, staff, and administrators.
2. **GreenWave Core API** (`app/api`): NestJS modular backend handling authentication, pickup scheduling, route optimization, and MinIO S3 media.
3. **GreenWave Mobile App** (`app/mobile`): React Native / Expo application for field staff and fleet drivers (Android & iOS).
4. **Management Console** (`https://gwgcservers.ca`): Dedicated, isolated infrastructure monitoring and server administration platform.

---

## 2. Infrastructure Topology

### Physical Compute Nodes
- **Rack Server 1** (`192.168.1.84`): HPE ProLiant Gen8 1U · Intel Xeon E5-2609 v3 (6 cores) · **60 GB ECC RAM** · 1 TB Storage (2x 500GB SATA Software RAID1)
- **Rack Server 2** (`192.168.1.176`): HPE ProLiant Gen8 2U · Intel Xeon E5-2640 v4 (10 cores / 20 threads) · **60 GB ECC RAM** · 4 TB Storage (4x 1TB SAS 10K RAID10)
- **Server 3 (Laptop Node)** (`192.168.1.177`): Mobile Compute Node · Intel Core i7-6600U (2 cores / 4 threads) · **16 GB RAM** · 512 GB NVMe SSD
- **Total Physical RAM**: **136 GB**

### Virtual Machine Allocation
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

## 3. Authentication & Database Boundary

```
[ Management Portal ]
https://gwgcservers.ca
       │
       ▼
[ Management SQLite ]
/opt/greenwave-management/data/management-auth.db
- Exactly ONE SuperAdmin account (anshbapu)
- Argon2id Password Hashing
- RFC 6238 TOTP MFA (AES-256-GCM encrypted secret)
- SHA-256 Hashed Recovery Codes
- Public Registration PERMANENTLY DISABLED

======================= STRICT ISOLATION =======================

[ GreenWave Main Application ]
app.gwgcservers.ca / Mobile App
       │
       ▼
[ Authoritative PostgreSQL 16 ]
192.168.1.22:5432 ("user" table)
- Application accounts (admin, manager, staff, driver)
- bcrypt Password Hashing
- JWT Bearer Tokens
- Cannot access Management Console
```

---

## 4. Hardware Telemetry & Monitoring
- **Out-of-Band BMC (HPE iLO 4)**:
  - Rack 1 iLO: `192.168.1.79`
  - Rack 2 iLO: `192.168.1.200`
  - Monitored via Redfish v1 REST API for CPU temperature, motherboard diodes, ambient inlet temperature, redundant fan arrays, and dual power supplies.
- **Server 3 Telemetry**: Linux hwmon / thermal_zone with hypervisor diode isolation handling (never reports fake 0°C).
- **Real-Time Telemetry**: Server-Sent Events (SSE) on `GET /api/v1/telemetry/stream` with NGINX `proxy_buffering off`.
