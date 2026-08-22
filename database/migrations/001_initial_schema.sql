-- ==============================================================================
-- GreenWave Core Application - Migration 001: Initial User Schema
-- PostgreSQL 16 Schema
-- ==============================================================================

CREATE TYPE user_role AS ENUM ('admin', 'manager', 'staff', 'driver');

CREATE TABLE IF NOT EXISTS "user" (
    id SERIAL PRIMARY KEY,
    "fullName" VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'staff',
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_email ON "user" (email);
CREATE INDEX IF NOT EXISTS idx_user_role ON "user" (role);
