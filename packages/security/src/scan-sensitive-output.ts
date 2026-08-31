import { readFileSync } from 'node:fs';
const PATTERNS = [/id_card/i,/身份证/,/passport/i,/bank(card)?/i,/银行卡/,/password/i,/secret/i,/authorization/i,/phone/i,/email/i];
export function scanSensitiveOutput(value: string): string[] { return PATTERNS.filter(pattern => pattern.test(value)).map(pattern => pattern.source); }
export function assertSensitiveOutputSafe(value: unknown): void { const text = typeof value === 'string' ? value : JSON.stringify(value); if (scanSensitiveOutput(text ?? '').length) throw new Error('sensitive output detected'); }
export function scanFile(path: string): string[] { return scanSensitiveOutput(readFileSync(path,'utf8')); }
