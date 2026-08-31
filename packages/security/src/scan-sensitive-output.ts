import { readFileSync } from 'node:fs';
const PATTERNS = [
  /\b\d{17}[\dXx]\b/,
  /\b1[3-9]\d{9}\b/,
  /\b(?:\d[ -]?){13,19}\b/,
  /\bBearer\s+[A-Za-z0-9._~-]{20,}\b/i,
  /\beyJ[A-Za-z0-9_-]{20,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
export function scanSensitiveOutput(value: string): string[] { return PATTERNS.filter(pattern => pattern.test(value)).map(pattern => pattern.source); }
export function assertSensitiveOutputSafe(value: unknown): void { const text = typeof value === 'string' ? value : JSON.stringify(value); if (scanSensitiveOutput(text ?? '').length) throw new Error('sensitive output detected'); }
export function scanFile(path: string): string[] { return scanSensitiveOutput(readFileSync(path,'utf8')); }
