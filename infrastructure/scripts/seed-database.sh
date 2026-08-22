#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "🌱 Seeding database with test fixtures..."
if docker ps | grep -q greenwave-local-postgres; then
    docker exec -i greenwave-local-postgres psql -U greenwave_dev -d greenwave_dev < "${REPO_ROOT}/database/seeds/001_dev_users.sql"
    docker exec -i greenwave-local-postgres psql -U greenwave_dev -d greenwave_dev < "${REPO_ROOT}/database/seeds/002_dev_pickups.sql"
    echo "✅ Development seeds loaded into local PostgreSQL container."
else
    echo "⚠️  Postgres container greenwave-local-postgres is not running. Start it with docker compose."
fi
