#!/usr/bin/env bash
# Clears operational/test records from the LOCAL/STAGING database only.
# Preserves products (materials), users, roles, permissions, warehouses,
# warehouse assignments, and customers. See app/api/scripts/reset-local-test-data.js
# for the actual logic and safety checks (refuses anything but localhost).
#
# Usage:
#   ./reset-local-test-data.sh           # dry run - prints before-counts, changes nothing
#   ./reset-local-test-data.sh --yes     # actually deletes, prints before/after counts
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
node "${REPO_ROOT}/app/api/scripts/reset-local-test-data.js" "$@"
