# Security Policy & Audit Standards

## 1. Zero-Trust Security Invariants
1. **No Production Credentials in Code**: Never commit `.env`, `.pem`, `.key`, API keys, database passwords, or JWT secrets.
2. **Strict Datastore Isolation**:
   - Management Console accounts reside exclusively in SQLite `/opt/greenwave-management/data/management-auth.db`.
   - Main Application accounts reside in PostgreSQL `192.168.1.22:5432`.
   - No application user may log in to `https://gwgcservers.ca`.
3. **Password Security**:
   - Management SuperAdmin: **Argon2id** hashing with per-user salt.
   - Application Users: **bcrypt** with 12 salt rounds.
   - Passwords must be at least 8 characters, containing uppercase, lowercase, numbers, and symbols.
4. **MFA Enforceability**:
   - Management Console enforces RFC 6238 TOTP with AES-256-GCM encrypted secrets and SHA-256 single-use recovery codes.
5. **Cookie Hardening**:
   - Session cookies use `__Host-` prefix: `HttpOnly; Secure; SameSite=Strict; Path=/`.
   - JavaScript cannot access session tokens.
6. **Input Sanitization & Injection Defense**:
   - Parameterized SQL queries via TypeORM and `pg` prepared statements.
   - Strict DTO validation with `class-validator`.
   - Content Security Policy (CSP) and HTTP security headers via Helmet.
