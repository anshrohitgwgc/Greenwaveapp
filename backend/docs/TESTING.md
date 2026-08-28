# Automated Testing & Verification Guide

## 1. Test Categories

| Test Suite | Location | Command |
| :--- | :--- | :--- |
| **Unit Tests** | `tests/unit/` | `npm run test:unit` |
| **Security Tests** | `tests/security/` | `npm run test:security` |
| **Integration Tests** | `tests/integration/` | `npm run test:integration` |
| **Load Tests** | `tests/load/` | `node tests/load/load-test.js` |
| **Smoke Tests** | `tests/smoke/` | `./infrastructure/scripts/run-smoke-tests.sh` |

---

## 2. Running All Tests Locally
```bash
# Run backend test suite
npm run test

# Run security audit scan
npm run test:security

# Build frontend verification
npm run build:web
```
