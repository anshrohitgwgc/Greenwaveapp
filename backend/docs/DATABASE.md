# Database Architecture & Migration Guide

## 1. Datastore Overview
- **Engine**: PostgreSQL 16
- **Local Dev Port**: `localhost:5432`
- **Production Host**: `192.168.1.22:5432` (VM 202 `database`)
- **Isolation Principle**: Stores all GreenWave application data (users, pickups, routes, photos). Completely isolated from SQLite Management authentication.

---

## 2. Table Schemas

### `user` Table
```sql
CREATE TYPE user_role AS ENUM ('admin', 'manager', 'staff', 'driver');

CREATE TABLE "user" (
    id SERIAL PRIMARY KEY,
    "fullName" VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL, -- bcrypt (12 rounds)
    role user_role NOT NULL DEFAULT 'staff',
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### `pickup` Table
```sql
CREATE TYPE pickup_status AS ENUM ('pending', 'scheduled', 'in_progress', 'completed', 'cancelled');

CREATE TABLE pickup (
    id SERIAL PRIMARY KEY,
    "userId" INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    status pickup_status NOT NULL DEFAULT 'pending',
    "wasteType" VARCHAR(100) NOT NULL DEFAULT 'electronics',
    "estimatedWeightKg" NUMERIC(10, 2),
    "actualWeightKg" NUMERIC(10, 2),
    "priceTotal" NUMERIC(10, 2),
    "assignedDriverId" INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    "scheduledDate" TIMESTAMP WITH TIME ZONE,
    "completedAt" TIMESTAMP WITH TIME ZONE,
    "notes" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### `photo` Table
```sql
CREATE TABLE photo (
    id SERIAL PRIMARY KEY,
    "pickupId" INTEGER REFERENCES pickup(id) ON DELETE CASCADE,
    "objectKey" VARCHAR(500) NOT NULL,
    "bucketName" VARCHAR(255) NOT NULL DEFAULT 'greenwave-photos',
    "originalFilename" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "uploadedBy" INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

---

## 3. Migration Workflow
1. Add new migration SQL files to `database/migrations/` with a numbered prefix (e.g. `004_add_tracking_column.sql`).
2. Run migrations locally:
```bash
./infrastructure/scripts/setup-local-dev.sh
```
3. Test backward compatibility and rollbacks before promoting to staging.
