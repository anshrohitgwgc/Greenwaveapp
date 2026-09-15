import * as bcrypt from 'bcrypt';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

describe('Unit: Authentication & Password Security', () => {
  it('1. Correctly hashes passwords using bcrypt with 12 rounds', async () => {
    const raw = 'TestPassword123!';
    const hash = await bcrypt.hash(raw, 12);
    assert.ok(hash.startsWith('$2b$12$'), 'Must use bcrypt $2b$ algorithm with 12 rounds');
    assert.notEqual(raw, hash);

    const matches = await bcrypt.compare(raw, hash);
    assert.equal(matches, true);
  });

  it('2. Rejects incorrect passwords during verification', async () => {
    const raw = 'CorrectPassword123!';
    const hash = await bcrypt.hash(raw, 12);
    const matches = await bcrypt.compare('WrongPassword456!', hash);
    assert.equal(matches, false);
  });
});
