# GreenWave Operations Platform — Login Security & Access Architecture

## 1. Executive Summary

The GreenWave Operations Platform is a dedicated, single-tenant commercial operations platform for industrial recycling and healthcare supply operations. Public user self-registration is strictly disallowed. All authentication flows are restricted to business-authorized staff accounts provisioned by administrators.

---

## 2. Login Page Hardening

### UI Sanitization & Cleanup
The login screen (`#gate` in `index.html` and `assets/app.js`) has been scrubbed of all consumer/setup prompts:
- **Removed**: "First time setting this up?"
- **Removed**: "Setup" links
- **Removed**: "Create account" / "Sign up" / "Register"
- **Removed**: "Create your first admin" public links

### Standard Business Authentication Form
The gate contains only:
1. **Brand Header**: GreenWave Recycling Inc. logo and title.
2. **Work Email Field**: Standard email input with browser autofill integration (`autocomplete="email"`).
3. **Password Field**: Secure password input with show/hide toggle and `autocomplete="current-password"`.
4. **Sign In Button**: Primary submission action with active state indicator ("Signing In…").
5. **Security Notice**: "GreenWave Operations Platform. Authorized personnel only."

### Graceful Error Handling
- **401 Unauthorized**: Displays a clean, unified message: *"Email or password is incorrect. Please check both and try again."* (No email enumeration).
- **429 Too Many Requests**: Rate limiting alert: *"Too many login attempts. Please wait a moment and try again."*
- **0 / Network Failure**: Connection diagnostic alert: *"Unable to connect to GreenWave services. Please check your connection and try again."*

---

## 3. Server-Side Protection & Registration Lockdown

### Disabled Public Registration
The `POST /auth/register` endpoint is protected by bootstrap guards:
- When any user exists in the database (`users.count() > 0`), all requests to `POST /auth/register` are rejected with `403 Forbidden` / `409 Conflict`.
- Initial admin seeding is performed via secure database migration or server bootstrapping with hashed credentials (`bcrypt` with 12 rounds).
- Users can only be created by authenticated administrators via `POST /users` (protected by `JwtAuthGuard` + `RolesGuard('admin')`).

### Self-Role Escalation Prevention
- Non-admin callers attempting to call `PATCH /users/:id` with `{ "role": "admin" }` are rejected with `403 Forbidden`.
- Non-admin callers attempting to assign warehouse facilities via `PUT /users/:id/warehouses` are rejected with `403 Forbidden`.

### Password Hashing & Sanitization
- All user passwords are encrypted using `bcrypt` with 12 salt rounds.
- Database queries and API responses strip `password` / `passwordHash` fields before serializing user records.
- Audit logging automatically filters any sensitive keys (`password`, `token`, `access_token`, `secret`) from metadata payloads.
