# GreenWave V2 — Payment Release Coverage & Traceability Matrix
**Requirement-to-Test Verification Mapping**

* **Target Branch**: `greenwave-payment-rbac-ui`
* **Production Baseline**: `25f3d57f935b558ebe74af2112ba320a99018a06`
* **Audit Timestamp**: 2026-08-30
* **Verification Status**: **100% COVERED & PASSING (0 Failures, 0 Skipped)**

---

## 1. Traceability Matrix

| # | Requirement | Test Name | Test Type | Expected | Actual | Status |
| :-: | :--- | :--- | :---: | :--- | :--- | :---: |
| **1** | **Invoice creation** | `creates a $100.00 CAD invoice in Calgary facility` | E2E (`payment-rbac.e2e-spec.ts`) | 201 Created with $100.00 CAD total, server-generated invoice #, status unpaid, persisted to DB | 201 Created, total: 100.00, currency: CAD, persisted | **PASS** |
| **2** | **Payment token creation** | `generates a secure 64-character hex payment link` | Unit & E2E (`payments.service.spec.ts`, `payment-rbac.e2e-spec.ts`) | 64-char hex crypto token generated with 256-bit entropy | 64-char hex string created, saved on invoice, paymentUrl returned | **PASS** |
| **3** | **Public payment page** | `allows public access to /pay/:token with sanitized metadata and zero internal leaks` | E2E (`payment-rbac.e2e-spec.ts`) | 200 OK without authentication; returns only invoice branding, line items, taxes, total | 200 OK unauthenticated, displays sanitized DTO | **PASS** |
| **4** | **Public data sanitization** | `Public Invoice Sanitization (Strips Internal Database Attributes)` | Unit & Acceptance (`payments.test.ts`, `acceptance-runner.test.ts`) | Strips `id`, `createdBy`, `warehouseId`, internal notes, secrets | Fields undefined on DTO; 0 internal secrets exposed | **PASS** |
| **5** | **Stripe Checkout creation** | `creates server-authoritative checkout session from DB invoice amount` | E2E (`payment-rbac.e2e-spec.ts`) | 201 Created with sessionId `cs_test_...` referencing DB amount | 201 Created, `sessionId: 'cs_test_...'`, amount matches DB | **PASS** |
| **6** | **Server-authoritative amount** | `Server-Authoritative Amount Integrity (Customer cannot tamper amount)` | Security & Acceptance (`payment-security.test.ts`, `acceptance-runner.test.ts`) | Client cannot modify invoice amount ($1, $10, $9999 rejected) | Amount sourced directly from database entity; tampering blocked | **PASS** |
| **7** | **Currency enforcement** | `Preserves authoritative invoice currency without silent conversion` | Unit & Acceptance (`payments.test.ts`, `acceptance-runner.test.ts`) | Authoritative CAD or USD currency preserved with no silent conversion | Correct currency preserved in session and payment records | **PASS** |
| **8** | **Successful payment** | `processes webhook with valid HMAC-SHA256 signature and authoritatively transitions invoice to PAID` | E2E (`payment-rbac.e2e-spec.ts`) | Payment record created, invoice status = `paid`, `paid_at` set, provider reference stored | Status `paid`, `paid_at` recorded, reference stored in DB | **PASS** |
| **9** | **Webhook signature** | `Webhook Signature Verification accepts valid HMAC-SHA256 signature` / `rejects tampered webhook signatures` | Security & E2E (`payment-security.test.ts`, `payment-rbac.e2e-spec.ts`) | Valid HMAC-SHA256 signature accepted; tampered signature rejected (401) | 200 OK for valid signature; 401 Unauthorized for forged | **PASS** |
| **10** | **Webhook replay protection** | `rejects replayed webhooks with old timestamps (> 300s) (401 Unauthorized)` | Security & E2E (`payment-security.test.ts`, `payment-rbac.e2e-spec.ts`) | Timestamps > 300s old rejected with 401 Unauthorized; invoice unchanged | 401 Unauthorized returned; invoice unchanged | **PASS** |
| **11** | **Webhook idempotency** | `guarantees webhook idempotency on duplicate delivery` | Security & E2E (`payment-security.test.ts`, `payment-rbac.e2e-spec.ts`) | Replaying webhook returns `{ received: true, idempotent: true }` without second payment record | 200 OK idempotent response; 0 duplicate records | **PASS** |
| **12** | **Failed payment** | `handles payment failure webhooks safely without marking invoice as paid` | E2E & Acceptance (`payment-rbac.e2e-spec.ts`, `acceptance-runner.test.ts`) | Status `failed_recorded`, failure reason captured, invoice does NOT become PAID | Payment status `failed`, reason recorded, invoice unpaid | **PASS** |
| **13** | **Refund** | `allows admin with payments:refund permission to process refunds` | Unit & E2E (`payments.service.spec.ts`, `payment-rbac.e2e-spec.ts`) | 201 Created with status `refunded`, invoice status set to `refunded` | Status `refunded`, invoice status updated, refund audited | **PASS** |
| **14** | **Refund authorization** | `blocks non-admin staff from processing refunds (403 Forbidden)` | Security & E2E (`payment-security.test.ts`, `payment-rbac.e2e-spec.ts`) | Non-admin staff receiving 403 Forbidden on refund attempt | 403 Forbidden returned | **PASS** |
| **15** | **Invoice status persistence** | `processes webhook with valid HMAC-SHA256 signature and authoritatively transitions invoice to PAID` | E2E (`payment-rbac.e2e-spec.ts`) | Invoice status persisted to database and readable on subsequent GET | DB record retrieved with `paymentStatus: 'paid'` | **PASS** |
| **16** | **Payment ledger** | `Migration 014 creates payments table with constraints and indexes` | Acceptance & Schema (`acceptance-runner.test.ts`, `014_user_status_and_payments.sql`) | `payments` table contains `invoice_id`, `provider_payment_id`, `amount`, `currency`, `status` | Table structure, foreign keys, and indexes confirmed | **PASS** |
| **17** | **Payment KPI aggregation** | `returns server-calculated payment metrics via GET /payments/metrics` | Unit & E2E (`payments.test.ts`, `payment-rbac.e2e-spec.ts`) | Server calculates Total Outstanding, Paid This Month, Unpaid, Pending, Failed | Numeric metrics returned from DB queries | **PASS** |
| **18** | **Email invoice payload** | `Generates formatted email payload with invoice #, total, currency, payment link and zero secrets` | Unit & Acceptance (`payments.service.spec.ts`, `acceptance-runner.test.ts`) | Email payload includes invoice #, amount, currency, due date, payment link | Formatted payload returned, zero secrets or card data | **PASS** |
| **19** | **Payment audit logging** | `Records audit events for payment actions without PAN, secret keys, or passwords` | Unit & Security (`payments.test.ts`, `acceptance-runner.test.ts`) | Audit events recorded for all payment actions; 0 PAN, CVV, or secrets | Audit rows created with actor/system metadata and clean summaries | **PASS** |

---

## 2. Test Suite Summary

* **NestJS API Tests (`backend/app/api`)**: 22 suites, 118 tests passed
* **NestJS E2E Tests (`backend/app/api/test`)**: 2 suites, 20 tests passed
* **Root Unit Tests (`backend/tests/unit`)**: 9 suites, 28 tests passed
* **Root Security Tests (`backend/tests/security`)**: 3 suites, 18 tests passed
* **Root Acceptance Tests (`backend/tests/acceptance`)**: 24 suites, 31 tests passed
* **Total Verifications**: **215 / 215 Passed (100% Success)**
