import { randomUUID } from 'node:crypto';

export interface SafeRequestOptions { method: string; contentLength?: number; maxBytes?: number; isBrowser?: boolean; csrfToken?: string; csrfCookie?: string }
export function assertSafeRequest(options: SafeRequestOptions): void { const max=options.maxBytes ?? 1_000_000; if ((options.contentLength ?? 0)>max) throw new Error('request body too large'); if (options.isBrowser && !['GET','HEAD','OPTIONS'].includes(options.method.toUpperCase()) && (!options.csrfToken || !options.csrfCookie || options.csrfToken !== options.csrfCookie)) throw new Error('csrf validation failed'); }
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
    const requestHeader = headerValue(headers['x-request-id']);
    const correlationHeader = headerValue(headers['x-correlation-id']);
    request.requestId = requestHeader && /^[A-Za-z0-9._:-]{1,128}$/.test(requestHeader) ? requestHeader : cryptoRandomId();
    request.correlationId = correlationHeader && /^[A-Za-z0-9._:-]{1,128}$/.test(correlationHeader) ? correlationHeader : request.requestId;
  };
}
function cryptoRandomId(): string { return randomUUID(); }
export function buildSecurityHeaders(): Record<string,string> { return {'content-security-policy': "default-src 'self'; frame-ancestors 'none'; object-src 'none'", 'x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','strict-transport-security':'max-age=31536000; includeSubDomains'}; }
export const secureCookieOptions = { httpOnly:true, secure:true, sameSite:'lax' as const };
function privateHost(host:string): boolean { const h=host.toLowerCase(); return h==='localhost' || h==='127.0.0.1' || h==='::1' || h.startsWith('10.') || h.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(h) || h.endsWith('.localhost') || h.endsWith('.internal'); }
export function isAllowedOutboundUrl(raw:string, allowlist: readonly string[]): boolean { try { const u=new URL(raw); if (u.protocol!=='https:' || privateHost(u.hostname)) return false; return allowlist.some(host => u.hostname===host || u.hostname.endsWith(`.${host}`)); } catch { return false; } }
export function supplierRequestOptions(timeoutMs=5000): { timeoutMs:number } { if (!Number.isFinite(timeoutMs) || timeoutMs<=0 || timeoutMs>30_000) throw new Error('invalid supplier timeout'); return { timeoutMs }; }
const OPAQUE_REFERENCE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|(?:vault-ref|traveler|ref|grant|decision|intent|trip|offer|order|auth|supplier|external|webhook|local|sha256)[-_:](?=[a-z0-9]{16,128}$)(?=[a-z0-9]*[a-z])(?=[a-z0-9]*[0-9])[a-z0-9]{16,128})$/;
export function isOpaqueReference(value: string): boolean { return OPAQUE_REFERENCE.test(value); }
