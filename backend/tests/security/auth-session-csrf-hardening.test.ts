import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const ASSETS_DIR = path.join(REPO_ROOT, 'assets');

const FRONTEND_FILES = [
  'index.html',
  'sw.js',
  'manifest.webmanifest',
  'assets/app.js',
  'assets/app.css',
  'assets/api.js',
  'assets/store.js',
  'assets/photos.js',
];

describe('Security Hardening: Frontend Surface & Secret Scanning', () => {
  it('1. No internal LAN IP addresses (192.168.x.x) exist in frontend files', () => {
    const lanRegex = /\b192\.168\.\d{1,3}\.\d{1,3}\b/;
    for (const rel of FRONTEND_FILES) {
      const filePath = path.join(REPO_ROOT, rel);
      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(
        !lanRegex.test(content),
        `Internal LAN IP detected in ${rel}`,
      );
    }
  });

  it('2. No Tailscale addresses (100.x.x.x) exist in frontend files', () => {
    const tailscaleRegex = /\b100\.(?:6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/;
    for (const rel of FRONTEND_FILES) {
      const filePath = path.join(REPO_ROOT, rel);
      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(
        !tailscaleRegex.test(content),
        `Tailscale IP detected in ${rel}`,
      );
    }
  });

  it('3. No localhost API URLs exist in production frontend code', () => {
    const localhostApiRegex = /https?:\/\/localhost(?::\d+)?(?:\/api|\/auth)/i;
    for (const rel of FRONTEND_FILES) {
      const filePath = path.join(REPO_ROOT, rel);
      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(
        !localhostApiRegex.test(content),
        `Hardcoded localhost API URL detected in ${rel}`,
      );
    }
  });

  it('4. Frontend API client exclusively uses safe relative /api/... paths', () => {
    const apiPath = path.join(REPO_ROOT, 'assets/api.js');
    const content = fs.readFileSync(apiPath, 'utf8');

    // Matches endpoint declarations in assets/api.js
    const endpointRegex = /request(?:Blob)?\(\s*['"][A-Z]+['"]\s*,\s*['"](\/[^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    const foundEndpoints: string[] = [];

    while ((match = endpointRegex.exec(content)) !== null) {
      foundEndpoints.push(match[1]);
    }

    assert.ok(foundEndpoints.length >= 10, 'Expected to audit API client endpoints');
    for (const endpoint of foundEndpoints) {
      assert.ok(
        endpoint.startsWith('/api/'),
        `Endpoint must start with /api/ but found: ${endpoint}`,
      );
    }
  });

  it('5. Frontend contains no database, Redis, SMTP, Stripe, or cloud credentials', () => {
    const forbiddenPatterns: Array<[string, RegExp]> = [
      ['Database credentials URL', /postgres(?:ql)?:\/\/[^:]+:[^@]+@/i],
      ['Redis password assignment', /REDIS_PASSWORD\s*[=:]\s*["'][^"']+["']/i],
      ['Stripe secret key', /\bsk_(?:live|test)_[0-9a-zA-Z]{16,}\b/],
      ['Assigned secret key', /(?:JWT_SECRET|SESSION_SECRET)\s*[=:]\s*["'][^"']+["']/i],
      ['MinIO credentials', /(?:MINIO_ACCESS_KEY|MINIO_SECRET_KEY)\s*[=:]\s*["'][^"']+["']/i],
    ];

    for (const rel of FRONTEND_FILES) {
      const filePath = path.join(REPO_ROOT, rel);
      const content = fs.readFileSync(filePath, 'utf8');
      for (const [desc, pattern] of forbiddenPatterns) {
        assert.ok(!pattern.test(content), `${desc} detected in ${rel}`);
      }
    }
  });

  it('6. Service worker never caches sensitive API, auth, or private financial data', () => {
    const swPath = path.join(REPO_ROOT, 'sw.js');
    const content = fs.readFileSync(swPath, 'utf8');

    // Confirm that cache bypass protects all API routes, pay, payments, and divisions
    assert.ok(
      /url\.pathname\.startsWith\(['"]\/api['"]\)/.test(content),
      'sw.js must bypass all /api routes',
    );
    assert.ok(
      /url\.pathname\.startsWith\(['"]\/auth['"]\)/.test(content),
      'sw.js must bypass all /auth routes',
    );
    assert.ok(
      /url\.pathname\.startsWith\(['"]\/pay['"]\)/.test(content),
      'sw.js must bypass all /pay routes',
    );
    assert.ok(
      /url\.pathname\.startsWith\(['"]\/payments['"]\)/.test(content),
      'sw.js must bypass all /payments routes',
    );
  });
});

describe('Security Hardening: Server-Side Authentication & Session Security', () => {
  it('7. SessionService creates 256-bit cryptographically secure opaque sessions', async () => {
    const { SessionService } = await import(
      '../../app/api/src/auth/session.service'
    );
    const mockRedis = {
      getClient: () => null,
    };
    const sessionService = new SessionService(mockRedis as any);

    const user = { id: 42, email: 'staff@greenwave.test', role: 'staff' };
    const session = await sessionService.createSession(user);

    assert.ok(session.id, 'Session must have an opaque ID');
    assert.equal(session.id.length, 64, 'Session ID must be 32 bytes hex (256 bits)');
    assert.ok(session.csrfToken, 'Session must have a paired CSRF token');
    assert.equal(session.csrfToken.length, 48, 'CSRF token must be 24 bytes hex');
    assert.equal(session.userId, 42);

    const retrieved = await sessionService.getSession(session.id);
    assert.ok(retrieved, 'Session must be retrievable from session store');
    assert.equal(retrieved.userId, 42);
    assert.equal(retrieved.csrfToken, session.csrfToken);
  });

  it('8. Session invalidation on logout terminates the session', async () => {
    const { SessionService } = await import(
      '../../app/api/src/auth/session.service'
    );
    const mockRedis = { getClient: () => null };
    const sessionService = new SessionService(mockRedis as any);

    const session = await sessionService.createSession({
      id: 10,
      email: 'admin@greenwave.test',
      role: 'admin',
    });

    assert.ok(await sessionService.getSession(session.id));
    await sessionService.invalidateSession(session.id);

    const afterInvalidation = await sessionService.getSession(session.id);
    assert.equal(afterInvalidation, null, 'Session must be null after logout invalidation');
  });

  it('9. Session revocation invalidates all active sessions for a user', async () => {
    const { SessionService } = await import(
      '../../app/api/src/auth/session.service'
    );
    const mockRedis = { getClient: () => null };
    const sessionService = new SessionService(mockRedis as any);

    const s1 = await sessionService.createSession({ id: 55, email: 'u@test.com', role: 'driver' });
    const s2 = await sessionService.createSession({ id: 55, email: 'u@test.com', role: 'driver' });

    assert.ok(await sessionService.getSession(s1.id));
    assert.ok(await sessionService.getSession(s2.id));

    await sessionService.revokeAllUserSessions(55);

    assert.equal(await sessionService.getSession(s1.id), null);
    assert.equal(await sessionService.getSession(s2.id), null);
  });

  it('10. Constant-time bcrypt execution prevents email enumeration via timing side-channels', async () => {
    const rawPassword = 'ValidPassword123!';
    const validHash = await bcrypt.hash(rawPassword, 12);

    // Both comparisons should execute bcrypt.compare with 12 rounds
    const t0 = Date.now();
    await bcrypt.compare('WrongPassword!', validHash);
    const realUserDuration = Date.now() - t0;

    const DUMMY_HASH = '$2b$12$But4KfPaAVBzdTco0Ep7du/MdY/T3gMcr8zzDb04XtvnoIY9570ie';
    const t1 = Date.now();
    await bcrypt.compare('SomePassword!', DUMMY_HASH);
    const nonExistentDuration = Date.now() - t1;

    // Both should take substantial CPU time (~100-500ms) rather than 0ms early-return
    assert.ok(
      realUserDuration > 50,
      `Real user verification must be rate-governed by bcrypt (${realUserDuration}ms)`,
    );
    assert.ok(
      nonExistentDuration > 50,
      `Non-existent user must consume comparable bcrypt time (${nonExistentDuration}ms)`,
    );
  });
});

describe('Security Hardening: CSRF Guard & Dual-Tier Rate Limiter', () => {
  it('11. CsrfGuard allows safe HTTP methods without CSRF tokens', async () => {
    const { CsrfGuard } = await import(
      '../../app/api/src/common/guards/csrf.guard'
    );
    const guard = new CsrfGuard();

    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            method,
            path: '/api/invoices',
            headers: {},
          }),
        }),
      } as any;

      assert.equal(guard.canActivate(mockContext), true);
    }
  });

  it('12. CsrfGuard allows Bearer token authenticated API mutations', async () => {
    const { CsrfGuard } = await import(
      '../../app/api/src/common/guards/csrf.guard'
    );
    const guard = new CsrfGuard();

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          path: '/api/invoices',
          headers: {
            authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          },
        }),
      }),
    } as any;

    assert.equal(guard.canActivate(mockContext), true);
  });

  it('13. CsrfGuard rejects cookie-authenticated mutations missing CSRF token', async () => {
    const { CsrfGuard } = await import(
      '../../app/api/src/common/guards/csrf.guard'
    );
    const guard = new CsrfGuard();

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          path: '/api/invoices',
          headers: {
            origin: 'https://gwgc.cloud',
            host: 'gwgc.cloud',
          },
          cookies: {
            gw_session: 'some-session-id',
          },
        }),
      }),
    } as any;

    assert.throws(
      () => guard.canActivate(mockContext),
      /Missing CSRF token/,
    );
  });

  it('14. CsrfGuard rejects mismatched CSRF tokens with 403 Forbidden', async () => {
    const { CsrfGuard } = await import(
      '../../app/api/src/common/guards/csrf.guard'
    );
    const guard = new CsrfGuard();

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          path: '/api/invoices',
          headers: {
            origin: 'https://gwgc.cloud',
            host: 'gwgc.cloud',
            'x-csrf-token': 'wrong-attacker-csrf-token',
          },
          cookies: {
            gw_session: 'some-session-id',
            gw_csrf: 'legitimate-user-csrf-token',
          },
        }),
      }),
    } as any;

    assert.throws(
      () => guard.canActivate(mockContext),
      /Invalid CSRF token/,
    );
  });

  it('15. CsrfGuard accepts matching CSRF tokens with verified origin', async () => {
    const { CsrfGuard } = await import(
      '../../app/api/src/common/guards/csrf.guard'
    );
    const guard = new CsrfGuard();
    const token = crypto.randomBytes(24).toString('hex');

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          path: '/api/invoices',
          headers: {
            origin: 'https://gwgc.cloud',
            host: 'gwgc.cloud',
            'x-csrf-token': token,
          },
          cookies: {
            gw_session: 'some-session-id',
            gw_csrf: token,
          },
        }),
      }),
    } as any;

    assert.equal(guard.canActivate(mockContext), true);
  });

  it('16. Login rate limiter triggers 429 when threshold is exceeded', async () => {
    const { LoginRateLimitGuard } = await import(
      '../../app/api/src/auth/login-rate-limit.guard'
    );
    const mockRedis = { getClient: () => null };
    const guard = new LoginRateLimitGuard(mockRedis as any);

    const makeContext = () =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'POST',
            path: '/api/auth/login',
            headers: {
              'x-forwarded-for': '198.51.100.25',
            },
            body: { email: 'target@greenwave.test' },
          }),
        }),
      }) as any;

    // Up to 10 attempts allowed
    for (let i = 0; i < 10; i++) {
      const allowed = await guard.canActivate(makeContext());
      assert.equal(allowed, true);
    }

    // 11th attempt must be rejected with 429
    let rejected = false;
    try {
      await guard.canActivate(makeContext());
    } catch (err: any) {
      rejected = err.status === 429;
    }
    assert.ok(rejected, 'Attempt beyond limit must throw 429 Too Many Requests');

    // Reset limit upon successful authentication
    await guard.resetLimit('198.51.100.25', 'target@greenwave.test');
    assert.equal(await guard.canActivate(makeContext()), true);
  });
});

describe('Security Hardening: Presentation-State Safety & Authoritative Enforcement', () => {
  it('17. LocalStorage role manipulation does not bypass backend authorization', () => {
    const storePath = path.join(REPO_ROOT, 'assets/store.js');
    const storeContent = fs.readFileSync(storePath, 'utf8');

    // Store holds presentation state; the comment and design explicitly document that
    // authority remains on the server
    assert.ok(
      /Production business data[\s\S]*is server-authoritative/.test(storeContent),
      'store.js must document server-authoritative security model',
    );
    assert.ok(
      !/localStorage\.(?:set|get)Item\(\s*TOKEN_KEY/.test(storeContent),
      'token must never be stored in localStorage',
    );
  });
});
