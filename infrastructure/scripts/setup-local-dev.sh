#!/usr/bin/env bash
# ==============================================================================
# GreenWave Local Development Setup Script
# Sets up local PostgreSQL, Redis, MinIO, runs migrations, and seeds test data.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "🌿 [GreenWave] Starting Local Development Setup..."

# 1. Check Node.js and Docker
command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required (v20+ recommended)"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "❌ npm is required"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "❌ Docker is required for local services"; exit 1; }

echo "✅ Node.js $(node -v) & Docker detected."

# 2. Copy .env.example to .env.local if not present
if [ ! -f "${REPO_ROOT}/.env" ]; then
    echo "📄 Creating local development .env from .env.example..."
    cp "${REPO_ROOT}/.env.example" "${REPO_ROOT}/.env"
fi

# 3. Start local Docker Compose services
echo "🐳 Starting local Docker containers (PostgreSQL, Redis, MinIO)..."
docker compose -f "${REPO_ROOT}/infrastructure/docker/docker-compose.yml" up -d postgres redis minio createbuckets

echo "⏳ Waiting for PostgreSQL to become ready..."
until docker exec greenwave-local-postgres pg_isready -U greenwave_dev -d greenwave_dev >/dev/null 2>&1; do
    sleep 1
done

# 4. Install API dependencies
echo "📦 Installing API dependencies..."
npm --prefix "${REPO_ROOT}/app/api" install

# 5. Install Web dependencies
echo "📦 Installing Web dependencies..."
npm --prefix "${REPO_ROOT}/app/web" install

# 6. Seed local database
echo "🌱 Seeding local development database..."
"${SCRIPT_DIR}/seed-database.sh"

echo ""
echo "🎉 [GreenWave] Local Development Environment Ready!"
echo "   - Web App:   http://localhost:5173"
echo "   - API:       http://localhost:3000"
echo "   - MinIO S3:  http://localhost:9000 (Console: http://localhost:9001)"
echo "   - Postgres:  localhost:5432 (Database: greenwave_dev, User: greenwave_dev)"
echo "   - Redis:     localhost:6379"
echo ""
echo "To start developing:"
echo "   npm run dev:api  (in one terminal)"
echo "   npm run dev:web  (in another terminal)"
