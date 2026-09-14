import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Regression cover for the secret-hygiene and API-exposure hardening.
 *
 * These assert on the shipped artefacts, not on intentions: the tracked file
 * list, the canonical frontend that gets copied to /var/www/greenwave-app/dist,
 * and the controllers as written. No test here prints a matched value.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const API_SRC = path.join(REPO_ROOT, 'backend/app/api/src');

/** Patterns that must never appear in a browser-delivered artefact. */
const SECRET_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['database URL with credentials', /(?:postgres|postgresql|mysql|mongodb)(?:\+srv)?:\/\/[^:/\s"']{1,60}:[^@\s"']{3,}@/],
  ['assigned JWT/session secret', /(?:JWT_SECRET|SESSION_SECRET|SECRET_KEY)\s*[=:][ \t]*["'][^"'\s]{6,}["']/],
  ['assigned database password', /(?:DB_PASSWORD|POSTGRES_PASSWORD|PGPASSWORD)\s*[=:][ \t]*["'][^"'\s]{4,}["']/],
  ['assigned redis password', /REDIS_PASSWORD\s*[=:][ \t]*["'][^"'\s]{4,}["']/],
  ['assigned MinIO credential', /(?:MINIO_SECRET_KEY|MINIO_ACCESS_KEY|MINIO_ROOT_PASSWORD)\s*[=:][ \t]*["'][^"'\s]{4,}["']/],
  ['hardcoded JWT literal', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['hardcoded bearer token', /["']Bearer\s+[A-Za-z0-9._-]{24,}["']/],
  ['Stripe live secret key', /\bsk_live_[A-Za-z0-9]{16,}/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['GitHub personal access token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
];

/** The canonical vanilla-JS frontend that is deployed as the production dist. */
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

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

describe('Security: Environment file protection', () => {
  it('1. No .env file is tracked by git (templates excepted)', () => {
    const tracked = git(['ls-files']).split('\n').filter(Boolean);
    const offenders = tracked.filter((f) => {
      const base = path.basename(f);
      if (/\.(example|template|sample)$/.test(base)) return false;
      return base === '.env' || base.startsWith('.env.') || base.endsWith('.env');
    });
    assert.deepEqual(
      offenders,
      [],
      `Environment files must never be tracked. Tracked: ${offenders.join(', ')}`,
    );
  });

  it('2. .gitignore ignores .env at the repository root and at any depth', () => {
    const mustBeIgnored = [
      '.env',
      '.env.production',
      '.env.local',
      'assets/.env',
      'backend/.env',
      'backend/app/api/.env',
      'some/new/service/.env',
    ];
    for (const candidate of mustBeIgnored) {
      let ignored = true;
      try {
        git(['check-ignore', '-q', '--no-index', candidate]);
      } catch {
        ignored = false;
      }
      assert.ok(ignored, `${candidate} must be git-ignored but is not`);
    }
  });

  it('3. .gitignore does NOT ignore legitimate templates or configuration', () => {
    const mustStayTrackable = [
      '.env.example',
      'backend/.env.example',
      'docs/setup.env.example',
      'backend/app/api/src/main.ts',
      'index.html',
    ];
    for (const candidate of mustStayTrackable) {
      let ignored = true;
      try {
        git(['check-ignore', '-q', '--no-index', candidate]);
      } catch {
        ignored = false;
      }
      assert.ok(!ignored, `${candidate} must remain trackable but is git-ignored`);
    }
  });

  it('4. .env.example assigns no value to any secret-bearing key', () => {
    const p = path.join(REPO_ROOT, 'backend/.env.example');
    assert.ok(fs.existsSync(p), 'backend/.env.example must exist');
    const secretKeys = [
      'DB_PASSWORD', 'JWT_SECRET', 'JWT_PRIVATE_KEY', 'SESSION_SECRET',
      'MINIO_SECRET_KEY', 'MINIO_ACCESS_KEY', 'REDIS_PASSWORD', 'API_KEY',
    ];
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const key = trimmed.slice(0, trimmed.indexOf('=')).trim();
      const value = trimmed.slice(trimmed.indexOf('=') + 1).trim();
      if (secretKeys.includes(key)) {
        assert.equal(value, '', `${key} in .env.example must have an empty placeholder value`);
      }
    }
  });
});

describe('Security: Production frontend bundle contains no secrets', () => {
  it('5. Every deployed frontend file is free of secret patterns', () => {
    for (const rel of FRONTEND_FILES) {
      const p = path.join(REPO_ROOT, rel);
      assert.ok(fs.existsSync(p), `expected frontend file missing: ${rel}`);
      const content = fs.readFileSync(p, 'utf8');
      for (const [label, pattern] of SECRET_PATTERNS) {
        assert.ok(
          !pattern.test(content),
          `${rel} contains a ${label} — value intentionally not printed`,
        );
      }
    }
  });

  it('6. The frontend ships no source maps and references none', () => {
    const assetsDir = path.join(REPO_ROOT, 'assets');
    const maps = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.map'));
    assert.deepEqual(maps, [], `Source maps must not ship: ${maps.join(', ')}`);
    for (const rel of ['assets/app.js', 'assets/api.js', 'assets/store.js']) {
      const content = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      assert.ok(
        !/[/][/][#]\s*sourceMappingURL=/.test(content),
        `${rel} must not reference a source map`,
      );
    }
  });

  it('7. The auth token is never written to localStorage and never logged', () => {
    const api = fs.readFileSync(path.join(REPO_ROOT, 'assets/api.js'), 'utf8');
    assert.ok(
      /sessionStorage\.setItem\(\s*TOKEN_KEY/.test(api),
      'the session token must be stored in sessionStorage',
    );
    assert.ok(
      !/localStorage\.(?:set|get)Item\(\s*TOKEN_KEY/.test(api),
      'the session token must never be placed in localStorage',
    );
    for (const rel of ['assets/api.js', 'assets/app.js', 'assets/store.js', 'index.html', 'sw.js']) {
      const content = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      assert.ok(
        !/console\.[a-z]+\([^)]*(?:token|Authorization|password|secret|credential)/i.test(content),
        `${rel} must not log tokens, credentials or authorization headers`,
      );
    }
  });

  it('8. Signing out clears both the token and the cached session', () => {
    const api = fs.readFileSync(path.join(REPO_ROOT, 'assets/api.js'), 'utf8');
    const app = fs.readFileSync(path.join(REPO_ROOT, 'assets/app.js'), 'utf8');
    assert.ok(/clearSession:\s*function\s*\(\)\s*\{\s*setToken\(null\)/.test(api),
      'Api.clearSession must drop the stored token');
    assert.ok(/function signOut\(\)[\s\S]{0,600}Api\.clearSession\(\)[\s\S]{0,200}S\.clearSession\(\)/.test(app),
      'signOut must clear the API token and the local session');
  });
});

describe('Security: API exposure', () => {
  /** Controllers that are public by design, with the reason they are. */
  const INTENTIONALLY_PUBLIC: Record<string, string> = {
    'app.controller.ts': 'root banner + /health, no data',
    'public-payments.controller.ts': 'customer payment portal, scoped by an unguessable per-invoice token',
    'stripe-webhook.controller.ts': 'Stripe webhook ingress, authenticated via Stripe signature verification (HMAC-SHA256)',
    'storage.controller.ts': 'declares no routes',
  };

  function controllerFiles(): string[] {
    const out: string[] = [];
    (function walk(dir: string) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.controller.ts')) out.push(full);
      }
    })(API_SRC);
    return out;
  }

  it('9. Every controller exposing routes requires authentication', () => {
    const unguarded: string[] = [];
    for (const file of controllerFiles()) {
      const base = path.basename(file);
      if (base in INTENTIONALLY_PUBLIC) continue;
      const src = fs.readFileSync(file, 'utf8');
      const hasRoutes = /@(?:Get|Post|Patch|Put|Delete)\(/.test(src);
      if (!hasRoutes) continue;
      if (!/@UseGuards\([^)]*JwtAuthGuard/.test(src)) unguarded.push(base);
    }
    assert.deepEqual(
      unguarded,
      [],
      `These controllers serve routes without JwtAuthGuard: ${unguarded.join(', ')}`,
    );
  });

  it('10. The pickups resource is authenticated and role-scoped', () => {
    const src = fs.readFileSync(
      path.join(API_SRC, 'pickups/pickups.controller.ts'),
      'utf8',
    );
    assert.ok(/@UseGuards\(JwtAuthGuard,\s*RolesGuard\)/.test(src),
      'pickups must be guarded by JwtAuthGuard and RolesGuard');
    // Every mutating route must additionally be limited to admin/manager.
    const mutating = src.match(/@(?:Post|Patch|Put|Delete)\([^)]*\)\s*\n\s*@Roles\(([^)]*)\)/g) ?? [];
    assert.equal(mutating.length, 3, 'each of POST/PATCH/DELETE must carry an @Roles restriction');
    for (const decl of mutating) {
      assert.ok(/'admin'/.test(decl) && /'manager'/.test(decl),
        'pickup mutations must be limited to admin and manager');
      assert.ok(!/'staff'/.test(decl) && !/'driver'/.test(decl),
        'pickup mutations must not be open to staff or driver');
    }
  });

  it('11. CORS is an explicit allowlist, never a reflected or wildcard origin', () => {
    const raw = fs.readFileSync(path.join(API_SRC, 'main.ts'), 'utf8');
    // Assert on the code, not on prose: the file's own comments describe the
    // misconfiguration this replaced and would otherwise match.
    const main = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.ok(!/origin:\s*true/.test(main),
      'CORS must not reflect an arbitrary Origin (origin: true)');
    assert.ok(!/origin:\s*['"]\*['"]/.test(main),
      'CORS must not use a wildcard origin on an authenticated API');
    assert.ok(/CORS_ALLOWED_ORIGINS/.test(main),
      'the CORS allowlist must be overridable by environment');
    assert.ok(/origins\.includes\(origin\)/.test(main),
      'the allowlist must be consulted for browser origins');
  });

  it('12. Production refuses to boot with a development JWT secret', () => {
    const main = fs.readFileSync(path.join(API_SRC, 'main.ts'), 'utf8');
    assert.ok(/JWT_SECRET/.test(main) && /throw new Error/.test(main),
      'production boot must reject a missing or dev JWT_SECRET');
  });

  it('13. No OpenAPI/Swagger surface is registered', () => {
    for (const file of controllerFiles().concat([path.join(API_SRC, 'main.ts')])) {
      const src = fs.readFileSync(file, 'utf8');
      assert.ok(!/SwaggerModule|DocumentBuilder|@nestjs\/swagger/.test(src),
        `${path.basename(file)} must not register API documentation in production`);
    }
  });
});
