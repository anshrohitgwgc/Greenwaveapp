# GreenWave Recycling Inc. — Stripe Production Setup & Payment Architecture

## 1. Executive Summary & Topology
GreenWave Recycling Inc. operates customer-facing payments and administrative operations across two isolated domains:
- **Primary Operational Domain:** `https://gwgc.cloud` (Internal staff, managers, dispatch, finance, administration)
- **Customer Payment Domain:** `https://pay.gwgcservers.ca` (Public checkout portal for invoice payments)

All payment processing integrates with Stripe using **Stripe.js v3** and **Stripe Payment Elements**. GreenWave uses Stripe-hosted payment elements to keep raw cardholder data out of GreenWave infrastructure and reduce PCI DSS scope. Credit card Primary Account Numbers (PANs), CVVs, and magnetic stripe data **never** traverse, touch, or persist on GreenWave servers or frontend DOM trees. This architectural separation reflects engineering design and does not constitute a formal compliance assessment or certification.

```
+---------------------------------------------------------------------------------------------------+
|                                      PAYMENT ARCHITECTURE                                         |
+---------------------------------------------------------------------------------------------------+
  [ Customer Web Browser ]
      |
      | 1. Opens payment link: https://pay.gwgcservers.ca/pay/{token}
      v
  [ NGINX Reverse Proxy @ 192.168.1.11 ]
      |
      | 2. Proxies /api/public/pay/:token to API cluster (.12 / .21 / .31)
      v
  [ NestJS PublicPaymentsController ]
      |
      | 3. Resolves SHA-256 token -> Returns invoice details & publishable key
      v
  [ Customer Web Browser ]
      |
      | 4. Requests clientSecret: POST /api/public/pay/:token/intent
      | 5. Stripe.js elements.create('payment') -> Renders iframe from js.stripe.com
      | 6. Customer enters card details -> Sent directly to https://api.stripe.com
      v
  [ Stripe Infrastructure ]
      |
      | 7. Webhook POST to https://gwgc.cloud/api/payments/stripe/webhook
      v
  [ NestJS StripeWebhookController ]
      |
      | 8. Verifies raw signature with whsec_...
      | 9. Checks provider_events for idempotency
      | 10. Marks invoice PAID, records payment, creates balanced GL journal entry
      v
  [ PostgreSQL Production Database ]
```

---

## 2. Environment Variables & Secret Configuration

Production secrets must be stored securely in the system environment on the API nodes (`.12`, `.21`, `.31`) and loaded via systemd or HashiCorp Vault. **Never commit secrets to version control.**

```bash
# ==============================================================================
# STRIPE GATEWAY CREDENTIALS (Live Mode)
# ==============================================================================
STRIPE_SECRET_KEY=sk_live_51P...               # Restricted live secret key
STRIPE_PUBLISHABLE_KEY=pk_live_51P...           # Public frontend key
STRIPE_WEBHOOK_SECRET=whsec_...                 # Live webhook signing secret
STRIPE_ACCOUNT_ID=acct_...                      # GreenWave connected account ID

# ==============================================================================
# DOMAIN & ROUTING CONFIGURATION
# ==============================================================================
PAYMENT_PORTAL_BASE_URL=https://pay.gwgcservers.ca
FRONTEND_BASE_URL=https://gwgc.cloud
API_BASE_URL=https://gwgc.cloud/api

# ==============================================================================
# WEBHOOK RETRY & TIMEOUT SETTINGS
# ==============================================================================
STRIPE_MAX_NETWORK_RETRIES=3
STRIPE_TIMEOUT_MS=20000
```

---

## 3. Public Payment Link & Checkout Contract

Payment links are delivered to customers via email or SMS using the secure base URL:
`https://pay.gwgcservers.ca/pay/{raw_token}`

### 3.1 Token Hashing & Lookup Security
- **Raw Token:** Cryptographically secure 256-bit random string (`crypto.randomBytes(32).toString('hex')`).
- **Storage:** GreenWave database stores **only** the SHA-256 hash of the token (`payment_link_token_hash`) in the `invoices` table.
- **Lookup:** When a customer visits `/pay/:token`, the backend computes `sha256(token)` and queries by hash. Even in the event of a read replica dump, unhashed tokens cannot be enumerated.

### 3.2 Public API Endpoints (`PublicPaymentsController`)

| Endpoint | Method | Purpose | Rate Limit |
|---|---|---|---|
| `/api/public/pay/:token` | `GET` | Resolve invoice details, amount due, and Stripe publishable key | 60 req/min |
| `/api/public/pay/:token/intent` | `POST` | Create or retrieve an idempotent Stripe PaymentIntent | 20 req/min |
| `/api/public/pay/:token/status` | `GET` | Poll payment status during/after confirmation | 60 req/min |

#### Sample Response: `GET /api/public/pay/:token`
```json
{
  "state": "ready",
  "invoiceId": "550e8400-e29b-41d4-a716-446655440000",
  "invoiceNumber": "INV-2026-0042",
  "customerName": "Cascade Paper Corp",
  "currency": "CAD",
  "amountTotalMinor": 125000,
  "amountPaidMinor": 0,
  "amountDueMinor": 125000,
  "dueDate": "2026-09-30",
  "publishableKey": "pk_live_51P..."
}
```

---

## 4. Stripe Payment Element Frontend Integration

The payment portal at `https://pay.gwgcservers.ca` is powered by production vanilla JavaScript without third-party frontend dependencies, dynamically loading Stripe.js v3.

### 4.1 Lifecycle & Implementation (`assets/app.js`)
1. **Dynamic Library Loading:** `loadStripeSdk()` dynamically loads `https://js.stripe.com/v3/` if not already present on `window.Stripe`.
2. **Intent Provisioning:** Calls `POST /api/public/pay/:token/intent` to obtain the `clientSecret`.
3. **Element Initialization:**
   ```javascript
   const stripe = window.Stripe(publishableKey);
   const elements = stripe.elements({
     clientSecret: intent.clientSecret,
     appearance: {
       theme: 'stripe',
       variables: {
         colorPrimary: '#0F7A4C',
         colorText: '#1E293B',
         colorDanger: '#DC2626',
         fontFamily: 'Inter, system-ui, sans-serif',
         borderRadius: '8px',
       },
     },
   });
   const paymentElement = elements.create('payment');
   paymentElement.mount('#stripe-payment-element');
   ```
4. **Payment Submission:**
   ```javascript
   const { error } = await stripe.confirmPayment({
     elements,
     confirmParams: {
       return_url: `${window.location.origin}/pay/${token}?redirect_status=succeeded`,
     },
   });
   ```
5. **State Rendering:** The portal cleanly handles 5 distinct UI states:
   - `ready`: Active form with invoice summary and Payment Element.
   - `processing`: Spinner and polling indicator.
   - `paid`: Green confirmation banner with receipt details.
   - `refunded`: Info banner indicating transaction has been refunded.
   - `not_payable`: Voided, cancelled, or expired token display.

---

## 5. Webhook Signature Verification & Idempotent Processing

Stripe webhooks are delivered to:
`POST https://gwgc.cloud/api/payments/stripe/webhook`

### 5.1 Raw Body Preservation
NestJS `main.ts` configures an Express body parser that retains the unaltered raw buffer for Stripe webhook requests on `/api/payments/stripe/webhook`:
```typescript
app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));
```

### 5.2 Signature Verification
The webhook controller validates the `stripe-signature` header using the official SDK:
```typescript
const event = this.stripeService.constructEvent(
  rawBody,
  signatureHeader,
  process.env.STRIPE_WEBHOOK_SECRET,
);
```
Any mismatch or signature timestamp drift exceeding tolerance throws a 400 Bad Request error.

### 5.3 Deduplication & Idempotency (`provider_events` table)
To guarantee at-most-once processing across API cluster nodes:
1. When an event arrives, an insert is attempted into `provider_events` with unique index on `(provider, event_id)`.
2. If duplicate key error occurs, the event has already been recorded and is immediately acknowledged with HTTP 200 without reprocessing.
3. Supported events:
   - `payment_intent.succeeded`: Marks payment received, records `payments` row, updates `invoices.status = 'PAID'`, posts double-entry GL journal entry (`DR Stripe Clearing, DR Stripe Fee Expense, CR Accounts Receivable`).
   - `payment_intent.payment_failed`: Records failure reason, notifies operations team.
   - `charge.refunded`: Persists refund record and posts GL reversal entry.
   - `charge.dispute.created`: Creates record in `stripe_disputes`, flags invoice for manager attention.
   - `payout.paid`: Persists record in `stripe_payouts` for bank reconciliation matching.

---

## 6. Admin Refund Workflow & RBAC

Refunds are restricted to users with the `admin` role or the explicit permission `accounting:refund`.

### 6.1 Refund Execution (`POST /api/payments/:id/refund`)
1. **Validation:**
   - Verifies user authentication and authorization.
   - Loads payment and checks status is `SUCCEEDED`.
   - Ensures `refundAmountMinor <= (amountMinor - amountRefundedMinor)`.
2. **Stripe API Call:**
   ```typescript
   const refund = await this.stripe.refunds.create({
     payment_intent: payment.stripePaymentIntentId,
     amount: dto.amountMinor,
     reason: dto.reason, // 'requested_by_customer' | 'duplicate' | 'fraudulent'
   });
   ```
3. **Database Updates (Atomic Transaction):**
   - Creates row in `payment_refunds`.
   - Updates `payments.amount_refunded_minor` and `payments.status`.
   - Recalculates `invoices.amount_paid_minor` and updates status to `PARTIALLY_PAID` or `OPEN`.
   - Posts balanced journal entry to General Ledger:
     - `DR Recycling Services Revenue` (or Refund Expense)
     - `CR Stripe Clearing CAD`

---

## 7. Operational Runbook & Production Verification

### 7.1 Webhook Endpoint Health Check
```bash
curl -i -X POST https://gwgc.cloud/api/payments/stripe/webhook \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
# Expected response: 400 Bad Request (Missing stripe-signature header)
```

### 7.2 Manual Stripe Sync Trigger (Admin Only)
To synchronize payouts, balance transactions, and disputes from Stripe:
```bash
curl -i -X POST https://gwgc.cloud/api/payments/stripe/sync \
  -H "Cookie: greenwave_session=..." \
  -H "X-CSRF-Token: ..."
# Response: 200 OK with sync summary counts
```

### 7.3 Security Audit Checklist
- [x] No live or test secret keys (`sk_live_...`, `sk_test_...`) in frontend codebase.
- [x] No webhook secrets (`whsec_...`) in client-side code.
- [x] Public pay tokens are hashed with SHA-256 before database lookup.
- [x] Strict CORS configured for `https://pay.gwgcservers.ca` on public endpoints.
- [x] Rate limiting enforced on all public payment endpoints.
- [x] Service worker explicitly bypasses caching for all `/api/public/pay/*` routes.
