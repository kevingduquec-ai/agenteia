import { createHash } from 'node:crypto';

export function contentHash(parts: Array<string | number | null | undefined>): string {
  const normalized = parts.map((part) => (part === null || part === undefined ? '' : String(part))).join('|');
  return createHash('sha256').update(normalized).digest('hex');
}
