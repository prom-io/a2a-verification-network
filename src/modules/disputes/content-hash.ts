import { createHash } from 'crypto';

/** Largest evidence body accepted inline; anything bigger is referenced by URI. */
export const MAX_INLINE_EVIDENCE_BYTES = 64 * 1024;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** SHA-256 of the content as 0x-prefixed lowercase hex. */
export function sha256Hex(content: Buffer): string {
  return `0x${createHash('sha256').update(content).digest('hex')}`;
}

/** Hashes are compared case-insensitively and stored in lowercase. */
export function normalizeHash(hash: string): string {
  return hash.trim().toLowerCase();
}

/**
 * Decodes base64 strictly. Buffer.from silently drops characters it does not
 * understand, which would let two different payloads decode to the same bytes
 * and therefore to the same "verified" hash.
 */
export function decodeBase64Strict(value: string): Buffer | null {
  if (value.length === 0 || value.length % 4 !== 0 || !BASE64.test(value)) return null;
  const decoded = Buffer.from(value, 'base64');
  return decoded.toString('base64') === value ? decoded : null;
}
