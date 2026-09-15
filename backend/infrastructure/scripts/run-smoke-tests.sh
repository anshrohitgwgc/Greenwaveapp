#!/usr/bin/env bash
set -euo pipefail

echo "🧪 Running GreenWave Local Smoke Tests..."
curl -sSf http://localhost:3000/health >/dev/null && echo "✅ API /health: OK" || echo "❌ API /health: FAILED"
curl -sSf http://localhost:9000/minio/health/live >/dev/null && echo "✅ MinIO /health/live: OK" || echo "❌ MinIO /health/live: FAILED"
echo "✅ Smoke verification complete."
