# GreenWave Recycling Inc. — Production Release Configuration Guide

This document defines the production runtime environment variables and architectural boundaries for the Payments, Finance, and Employee Operations platform.

> [!CAUTION]
> **Zero Real Secrets Policy:** This document contains variable names, format specifications, and configuration parameters. It must **never** contain live keys, production database passwords, webhook signing secrets, or private credentials.

---

## 1. Required Production Environment Variables

### 1.1 Backend Environment Configuration (`/etc/greenwave/api.env` on API nodes .12, .21, .31)

```bash
# ==============================================================================
# STRIPE PAYMENT GATEWAY CONFIGURATION
# ==============================================================================
# Backend-Only: Live secret API key from Stripe Dashboard (Developers > API keys)
# Format: sk_live_... (Restricted key with PaymentIntent, Refund, Payout, Balance read/write)
STRIPE_SECRET_KEY=<required-backend-secret>

# Backend-Only: Webhook signing secret from Stripe Dashboard (Developers > Webhooks)
# Format: whsec_... (Specific to endpoint https://gwgc.cloud/api/payments/stripe/webhook)
STRIPE_WEBHOOK_SECRET=<required-backend-secret>

# Frontend-Safe: Publishable key sent to client browsers for Stripe Elements initialization
# Format: pk_live_...
STRIPE_PUBLISHABLE_KEY=<required-publishable-key>

# Optional: Stripe Connect account ID if operating on a connected account
STRIPE_ACCOUNT_ID=<optional-acct-id>

# ==============================================================================
# DOMAIN & ROUTING TOPOLOGY
# ==============================================================================
# Public customer checkout domain
PAYMENT_DOMAIN=https://pay.gwgcservers.ca
PAYMENT_PORTAL_BASE_URL=https://pay.gwgcservers.ca

# Primary operations portal domain
FRONTEND_BASE_URL=https://gwgc.cloud
API_BASE_URL=https://gwgc.cloud/api

# Allowed CORS origins for API cluster
# Comma-separated list of trusted browser origins
CORS_ALLOWED_ORIGINS=https://gwgc.cloud,https://www.gwgc.cloud,https://app.gwgcservers.ca,https://pay.gwgcservers.ca

# ==============================================================================
# SECURITY BASELINE & AUTHENTICATION
# ==============================================================================
# Backend-Only: 256-bit cryptographically secure session signing secret
SESSION_SECRET=<required-backend-secret>

# Backend-Only: JWT signing secret (refuses to boot in production if dev/default)
JWT_SECRET=<required-backend-secret>

# Cookie domain setting (blank for host-only cookies, or .gwgc.cloud if sharing)
COOKIE_DOMAIN=gwgc.cloud
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax

# ==============================================================================
# DATABASE & CACHING CLUSTER (Internal VM Network)
# ==============================================================================
DATABASE_URL=postgresql://<db-user>:<db-password>@192.168.1.22:5432/greenwave_prod
REDIS_URL=redis://:<redis-password>@192.168.1.14:6379/0

# ==============================================================================
# TRANSACTIONAL EMAIL SERVICE
# ==============================================================================
SMTP_HOST=<smtp-provider-host>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<smtp-username>
SMTP_PASSWORD=<required-backend-secret>
MAIL_FROM_ADDRESS=sales@greenwaverecycling.ca
MAIL_SALES_ADDRESS=sales@greenwaverecycling.ca
```

---

## 2. Variable Scope & Placement Boundaries

| Variable Name | Scope | Placement | Frontend Safe? | Purpose |
|---|---|---|:---:|---|
| `STRIPE_SECRET_KEY` | Backend Only | Systemd / Vault on API nodes | **NO** | API calls to Stripe (charge, refund, payout) |
| `STRIPE_WEBHOOK_SECRET` | Backend Only | Systemd / Vault on API nodes | **NO** | HMAC-SHA256 signature verification |
| `STRIPE_PUBLISHABLE_KEY` | Public / Frontend | Delivered via `/api/public/pay/:token` | **YES** | Initializes Stripe Elements in browser |
| `PAYMENT_DOMAIN` | Backend / Routing | Systemd / NGINX | **YES** | Base URL for generated invoice payment links |
| `SESSION_SECRET` | Backend Only | Systemd / Vault on API nodes | **NO** | Signs opaque session IDs |
| `JWT_SECRET` | Backend Only | Systemd / Vault on API nodes | **NO** | Encrypts authentication tokens |
| `DATABASE_URL` | Backend Only | Systemd / Vault on API nodes | **NO** | PostgreSQL connection pool |
| `REDIS_URL` | Backend Only | Systemd / Vault on API nodes | **NO** | Session store, rate limit counters, cache |
| `SMTP_PASSWORD` | Backend Only | Systemd / Vault on API nodes | **NO** | Outbound transactional email delivery |

---

## 3. Stripe Webhook Endpoint & Event Configuration

### 3.1 Webhook Endpoint Destination
- **URL:** `POST https://gwgc.cloud/api/payments/stripe/webhook`
- **Reverse Proxy Routing:** NGINX forwards to API cluster nodes (.12, .21, .31) on port 3000.
- **Payload Formatting:** NGINX must pass the raw request stream without body re-encoding.
- **NestJS Ingress:** Middleware preserves `req.rawBody` buffer before JSON parsing for cryptographic verification.

### 3.2 Required Stripe Events (18 Events Handled)
Configure these exact 18 events in the Stripe Dashboard under **Developers > Webhooks**:
1. `payment_intent.succeeded` (Triggers invoice settlement, payment record, ledger entry)
2. `payment_intent.processing` (Updates UI to processing state)
3. `payment_intent.requires_action` (Tracks 3DS verification)
4. `payment_intent.payment_failed` (Records failure reason, flags invoice)
5. `payment_intent.canceled` (Cleans up expired/abandoned intents)
6. `charge.updated` (Reflects metadata changes)
7. `refund.created` (Initiates refund tracking)
8. `refund.updated` (Tracks processing status)
9. `refund.failed` (Reverses pending refund and notifies staff)
10. `charge.dispute.created` (Logs dispute, holds funds)
11. `charge.dispute.updated` (Updates dispute evidence status)
12. `charge.dispute.closed` (Resolves dispute outcome)
13. `charge.dispute.funds_withdrawn` (Posts contra-revenue journal entry)
14. `charge.dispute.funds_reinstated` (Reverses dispute withdrawal)
15. `payout.paid` (Records settlement from Stripe to bank)
16. `payout.failed` (Alerts finance team of failed bank transfer)
17. `payout.updated` (Updates payout arrival date)
18. `payout.canceled` (Records canceled payout transfer)

---

## 4. Cross-Origin Resource Sharing (CORS) & Browser Boundaries

1. **Origins Allowed:**
   - `https://gwgc.cloud` (Operations Web App)
   - `https://www.gwgc.cloud` (Operations Web App alias)
   - `https://app.gwgcservers.ca` (Admin alias)
   - `https://pay.gwgcservers.ca` (Public Payment Portal)
2. **CORS Restrictions:**
   - Wildcard (`*`) origins are strictly prohibited.
   - Credentials (`Access-Control-Allow-Credentials: true`) enabled for authenticated cookie requests.
   - Public pay endpoints (`/api/public/pay/*`) respond to `https://pay.gwgcservers.ca` without cookies.

---

## 5. Cookie & Session Security Invariants

- **Cookie Name:** `gw_session`
- **Security Flags:**
  - `HttpOnly`: Enforced. JavaScript cannot read session cookies.
  - `Secure`: Enforced. Only transmitted over TLS (HTTPS).
  - `SameSite`: `Lax` (prevents CSRF while allowing top-level navigation).
- **CSRF Token:** Required on all mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) carrying cookies, sent via `X-CSRF-Token` header.
- **Service Worker Bypass:** `sw.js` explicitly returns immediately without caching for `/api/*`, `/auth/*`, `/pay/*`, `/p/*`, `/payments/*`, `/accounting/*`, `/banking/*`, `/payables/*`, and `/employees/*`.
