import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PREFIX = 'enc:v1:';

/**
 * Load (or create) a stable 32-byte encryption key in the data directory. Stored
 * with 0600 perms; not committed. Used to encrypt secrets at rest (e.g. SSH keys).
 */
export function loadOrCreateKey(dataDir: string): Buffer {
  const file = join(dataDir, '.secret.key');
  try {
    const hex = readFileSync(file, 'utf8').trim();
    if (hex.length === 64) return Buffer.from(hex, 'hex');
  } catch {
    // No key yet; create one below.
  }
  const key = randomBytes(32);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, key.toString('hex'));
  try {
    chmodSync(file, 0o600);
  } catch {
    // Best effort.
  }
  return key;
}

/** AES-256-GCM encrypt; returns a self-describing string. */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/** Decrypt a value produced by encryptSecret; values without the prefix (legacy
 * plaintext) are returned unchanged. */
export function decryptSecret(value: string, key: Buffer): string {
  if (!value.startsWith(PREFIX)) return value;
  const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
