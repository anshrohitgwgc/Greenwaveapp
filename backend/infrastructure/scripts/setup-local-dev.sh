#!/usr/bin/env bash
# ==============================================================================
# GreenWave Local Development Setup Script
# Sets up local PostgreSQL, Redis, MinIO, runs migrations, and seeds test data.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "🌿 [GreenWave] Initializing Local Development Environment..."

# 1. Check Node.js and npm
command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required (v20+ LTS recommended: https://nodejs.org)"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "❌ npm is required"; exit 1; }

echo "✅ Node.js $(node -v) & npm $(npm -v) detected."

# 2. Copy .env.example to .env if not present
if [ ! -f "${REPO_ROOT}/.env" ]; then
    echo "📄 Creating local development .env from .env.example..."
    cat << 'ENVEOF' > "${REPO_ROOT}/.env"
# Local Development Environment (Auto-generated)
NODE_ENV=development
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=greenwave_dev
DB_PASSWORD=localdevpass123
DB_DATABASE=greenwave_dev
REDIS_HOST=localhost
REDIS_PORT=6379
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin123
MINIO_BUCKET_NAME=greenwave-photos
JWT_SECRET=local-dev-jwt-secret-do-not-use-in-prod
JWT_EXPIRATION=86400s
SESSION_SECRET=local-dev-session-secret-change-in-prod
VITE_API_URL=http://localhost:3000
EXPO_PUBLIC_API_URL=http://localhost:3000
ENVEOF
fi

# 3. Check Docker status
if command -v docker >/dev/null 2>&1; then
    echo "🐳 Starting local Docker containers (PostgreSQL, Redis, MinIO)..."
    docker compose -f "${REPO_ROOT}/infrastructure/docker/docker-compose.yml" up -d postgres redis minio createbuckets || true

    echo "⏳ Checking PostgreSQL container readiness..."
    for i in {1..15}; do
        if docker exec greenwave-local-postgres pg_isready -U greenwave_dev -d greenwave_dev >/dev/null 2>&1; then
            echo "✅ PostgreSQL ready."
            break
        fi
        sleep 1
    done

    # 4. Seed local database
    echo "🌱 Seeding local development database..."
    "${SCRIPT_DIR}/seed-database.sh" || true
else
    echo "ℹ️  Docker is not currently installed or running."
    echo "   To run local databases in Docker, install Docker Desktop: https://www.docker.com/products/docker-desktop"
    echo "   Or use your local PostgreSQL (port 5432), Redis (port 6379), and MinIO (port 9000)."
fi

# 5. Install API dependencies
echo "📦 Installing API dependencies..."
npm --prefix "${REPO_ROOT}/app/api" install

# 6. Install Web dependencies
echo "📦 Installing Web dependencies..."
npm --prefix "${REPO_ROOT}/app/web" install

# 7. Install Mobile dependencies
if [ -d "${REPO_ROOT}/app/mobile" ]; then
    echo "📦 Installing Mobile dependencies..."
    npm --prefix "${REPO_ROOT}/app/mobile" install --legacy-peer-deps || true
fi

echo ""
echo "🎉 [GreenWave] Local Development Environment Setup Complete!"
echo "   - Web App:   http://localhost:5173"
echo "   - API:       http://localhost:3000"
echo "   - MinIO S3:  http://localhost:9000 (Console: http://localhost:9001)"
echo "   - Postgres:  localhost:5432 (DB: greenwave_dev, User: greenwave_dev)"
echo "   - Redis:     localhost:6379"
echo ""
echo "To start development servers:"
echo "   npm run dev:api     # In terminal 1: Starts NestJS API on http://localhost:3000"
echo "   npm run dev:web     # In terminal 2: Starts Vite Web on http://localhost:5173"
echo "   npm run dev:mobile  # In terminal 3: Starts Expo Mobile App"
