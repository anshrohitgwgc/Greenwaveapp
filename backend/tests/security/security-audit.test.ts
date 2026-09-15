import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Security: Codebase & Secret Hygiene Audit', () => {
  it('1. Repository must NOT contain committed private keys or certificates', () => {
    const rootDir = path.resolve(__dirname, '../..');
    const sensitiveExtensions = ['.pem', '.key', '.p12', '.pfx'];
    
    function scanDir(dir: string) {
      if (dir.includes('node_modules') || dir.includes('.git')) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          assert.ok(!sensitiveExtensions.includes(ext), `Forbidden credential file found: ${fullPath}`);
        }
      }
    }

    scanDir(rootDir);
  });

  it('2. .env.example must only contain variable names and NO real secret values', () => {
    const envExamplePath = path.resolve(__dirname, '../../.env.example');
    if (fs.existsSync(envExamplePath)) {
      const content = fs.readFileSync(envExamplePath, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const [key, value] = trimmed.split('=');
          if (['SESSION_SECRET', 'JWT_SECRET', 'MINIO_SECRET_KEY', 'DB_PASSWORD'].includes(key.trim())) {
            assert.ok(!value || value.trim() === '' || value.includes('local-dev') || value.includes('example'), `Real secret detected in .env.example for key ${key}`);
          }
        }
      }
    }
  });
});
