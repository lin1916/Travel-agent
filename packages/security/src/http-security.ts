import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { randomUUID } from 'node:crypto';

export interface SafeRequestOptions { method: string; contentLength?: number; maxBytes?: number; isBrowser?: boolean; csrfToken?: string; csrfCookie?: string }
export function assertSafeRequest(options: SafeRequestOptions): void { const max=options.maxBytes ?? 1_000_000; if ((options.contentLength ?? 0)>max) throw new Error('request body too large'); if (options.isBrowser && !['GET','HEAD','OPTIONS'].includes(options.method.toUpperCase()) && (!options.csrfToken || !options.csrfCookie || options.csrfToken !== options.csrfCookie)) throw Object.assign(new Error('csrf validation failed'), { statusCode: 403 }); }
function headerValue(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }
function cookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  return cookieHeader?.split(';').map(item => item.trim()).find(item => item.startsWith(`${name}=`))?.slice(name.length + 1);
}
export function createFastifySecurityHook(options: { maxBytes?: number } = {}) {
  return async (request: { method: string; headers?: Record<string, string | string[] | undefined>; requestId?: string; correlationId?: string }): Promise<void> => {
    const headers = request.headers ?? {};
    const origin = headerValue(headers.origin);
    assertSafeRequest({
      method: request.method,
      maxBytes: options.maxBytes,
      contentLength: Number(headerValue(headers['content-length']) ?? 0),
      isBrowser: Boolean(origin || headerValue(headers['sec-fetch-site'])),
      csrfToken: headerValue(headers['x-csrf-token']),
      csrfCookie: cookieValue(headerValue(headers.cookie), 'csrf-token'),
    });
    // Caller supplied IDs are untrusted data.  Stable IDs are issued only by the API.
    request.requestId = cryptoRandomId();
    request.correlationId = request.requestId;
  };
}
function cryptoRandomId(): string { return randomUUID(); }
export function buildSecurityHeaders(): Record<string,string> { return {'content-security-policy': "default-src 'self'; frame-ancestors 'none'; object-src 'none'", 'x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','strict-transport-security':'max-age=31536000; includeSubDomains'}; }
export const secureCookieOptions = { httpOnly:true, secure:true, sameSite:'lax' as const };
function ipv4ToNumber(value: string): number | null {
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d+$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((result, part) => result * 256 + Number(part), 0);
}
function privateIp(value: string): boolean {
  const normalized = value.toLowerCase().replace(/^\[|\]$/g, '');
  const dottedPrefix = normalized.split('.')[0];
  if (normalized.includes('.') && /^\d+$/.test(dottedPrefix) && normalized.split('.').length > 4) {
    const candidate = normalized.split('.').slice(0, 4).join('.');
    if (ipv4ToNumber(candidate) !== null) return privateIp(candidate);
  }
  if (normalized.startsWith('::ffff:')) {
    const suffix = normalized.slice(7);
    const words = suffix.split(':');
    if (words.length === 2 && words.every(word => /^[0-9a-f]{1,4}$/.test(word))) {
      const mapped = `${parseInt(words[0], 16) >> 8}.${parseInt(words[0], 16) & 255}.${parseInt(words[1], 16) >> 8}.${parseInt(words[1], 16) & 255}`;
      return privateIp(mapped);
    }
    if (isIP(suffix) === 4) return privateIp(suffix);
  }
  if (isIP(normalized) === 4) {
    const n = ipv4ToNumber(normalized);
    if (n === null) return true;
    return (n >= 0x0a000000 && n <= 0x0affffff) || (n >= 0x0b000000 && n <= 0x0bffffff)
      || (n >= 0x7f000000 && n <= 0x7fffffff) || (n >= 0xa9fe0000 && n <= 0xa9feffff)
      || (n >= 0xac100000 && n <= 0xac1fffff) || (n >= 0xc0a80000 && n <= 0xc0a8ffff)
      || n === 0 || n >= 0xe0000000;
  }
  if (isIP(normalized) === 6) {
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb');
  }
  return normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.internal') || normalized.endsWith('.local') || /(?:^|\.)\d{1,3}(?:\.\d{1,3}){3}\.(?:nip\.io|sslip\.io|xip\.io)$/.test(normalized);
}
function normalizedHost(host: string): string {
  const value = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const numeric = ipv4ToNumber(value);
  if (numeric !== null) return `${(numeric >>> 24) & 255}.${(numeric >>> 16) & 255}.${(numeric >>> 8) & 255}.${numeric & 255}`;
  return value;
}
function allowedHost(host: string, allowlist: readonly string[]): boolean {
  const normalized = normalizedHost(host);
  return allowlist.some(entry => {
    const allowed = normalizedHost(entry);
    return normalized === allowed || normalized.endsWith(`.${allowed}`);
  });
}
export function isAllowedOutboundUrl(raw:string, allowlist: readonly string[]): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || privateIp(u.hostname) || !allowedHost(u.hostname, allowlist)) return false;
    return true;
  } catch { return false; }
}
export async function isAllowedOutboundUrlResolved(raw: string, allowlist: readonly string[]): Promise<boolean> {
  if (!isAllowedOutboundUrl(raw, allowlist)) return false;
  try {
    const hostname = new URL(raw).hostname.replace(/^\[|\]$/g, '');
    if (isIP(hostname)) return !privateIp(hostname);
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every(address => !privateIp(address.address));
  } catch { return false; }
}
export function supplierRequestOptions(timeoutMs=5000): { timeoutMs:number } { if (!Number.isFinite(timeoutMs) || timeoutMs<=0 || timeoutMs>30_000) throw new Error('invalid supplier timeout'); return { timeoutMs }; }
export function assertOutboundUrl(raw: string, allowlist: readonly string[]): URL {
  if (!isAllowedOutboundUrl(raw, allowlist)) throw new Error('outbound URL rejected by security policy');
  return new URL(raw);
}
export async function secureOutboundFetch(
  raw: string,
  init: RequestInit = {},
  options: { allowlist: readonly string[]; timeoutMs?: number; fetch?: typeof fetch } = { allowlist: [] },
): Promise<Response> {
  const url = assertOutboundUrl(raw, options.allowlist);
  if (!(await isAllowedOutboundUrlResolved(url.toString(), options.allowlist))) throw new Error('outbound URL rejected by security policy');
  const timeout = supplierRequestOptions(options.timeoutMs ?? 5_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout.timeoutMs);
  try {
    const signal = init.signal ? (AbortSignal.any ? AbortSignal.any([init.signal, controller.signal]) : controller.signal) : controller.signal;
    return await (options.fetch ?? globalThis.fetch)(url, { ...init, signal });
  } finally { clearTimeout(timer); }
}
const OPAQUE_REFERENCE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|(?:vault-ref|traveler|ref|grant|decision|intent|trip|offer|order|auth|supplier|external|webhook|local|sha256)[-_:](?=[a-z0-9]{16,128}$)(?=[a-z0-9]*[a-z])(?=[a-z0-9]*[0-9])[a-z0-9]{16,128})$/;
export function isOpaqueReference(value: string): boolean { return OPAQUE_REFERENCE.test(value); }
/** Provider-issued/cryptographically verifiable references accepted in production durable payloads. */
export function isProviderIssuedOpaqueReference(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
