import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { decryptSecret, encryptSecret } from './secret.js';

const key = randomBytes(32);

test('encrypt then decrypt round-trips and ciphertext differs', () => {
  const secret = '-----BEGIN OPENSSH PRIVATE KEY-----\nabc123\n-----END-----';
  const encrypted = encryptSecret(secret, key);
  assert.ok(encrypted.startsWith('enc:v1:'));
  assert.notEqual(encrypted, secret);
  assert.equal(decryptSecret(encrypted, key), secret);
});

test('legacy plaintext (no prefix) passes through unchanged', () => {
  assert.equal(decryptSecret('plain-old-value', key), 'plain-old-value');
});

test('a different key cannot decrypt', () => {
  const encrypted = encryptSecret('hunter2', key);
  assert.throws(() => decryptSecret(encrypted, randomBytes(32)));
});
