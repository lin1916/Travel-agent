import { describe, expect, it } from 'vitest';
import { assertSafeRequest, buildSecurityHeaders, createFastifySecurityHook, isAllowedOutboundUrl, isAllowedOutboundUrlResolved, secureOutboundFetch } from '../src/http-security.js';
import { ReplayGuard } from '../src/webhook-replay.js';
import { scanSensitiveOutput } from '../src/scan-sensitive-output.js';

describe('http and webhook security', () => {
  it('rejects oversized requests and unsafe browser mutations', () => {
    expect(() => assertSafeRequest({ method: 'POST', contentLength: 2_000_000, maxBytes: 1_000_000, isBrowser: true, csrfToken: undefined, csrfCookie: 'x' })).toThrow();
    expect(() => assertSafeRequest({ method: 'POST', contentLength: 10, maxBytes: 100, isBrowser: true, csrfToken: 'bad', csrfCookie: 'good' })).toThrow();
  });
  it('provides a runtime request hook that applies the same CSRF and size policy', async () => {
    const hook = createFastifySecurityHook({ maxBytes: 100 });
    await expect(hook({ method: 'POST', headers: { origin: 'https://app.example', 'content-length': '10', cookie: 'csrf-token=good' } } as any)).rejects.toThrow('csrf');
  });
  it('always assigns server-owned correlation identifiers and ignores caller values', async () => {
    const request: any = { method: 'GET', headers: { 'x-request-id': '13800138000', 'x-correlation-id': 'passport-110101199001011234' } };
    await createFastifySecurityHook()(request);
    expect(request.requestId).not.toBe('13800138000');
    expect(request.correlationId).not.toBe('passport-110101199001011234');
    expect(request.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(request.correlationId).toBe(request.requestId);
  });
  it('allows only configured supplier hosts and rejects localhost SSRF', () => {
    expect(isAllowedOutboundUrl('https://api.example.com/orders', ['api.example.com'])).toBe(true);
    expect(isAllowedOutboundUrl('http://127.0.0.1:8080/', ['127.0.0.1'])).toBe(false);
    expect(isAllowedOutboundUrl('https://evil.example/', ['api.example.com'])).toBe(false);
    expect(isAllowedOutboundUrl('https://2130706433/', ['2130706433'])).toBe(false);
    expect(isAllowedOutboundUrl('https://[::ffff:127.0.0.1]/', ['[::ffff:127.0.0.1]'])).toBe(false);
    expect(isAllowedOutboundUrl('https://[::ffff:7f00:1]/', ['[::ffff:7f00:1]'])).toBe(false);
    expect(isAllowedOutboundUrl('https://127.0.0.1.nip.io/', ['127.0.0.1.nip.io'])).toBe(false);
  });
  it('allows a configured public IPv4 address through resolved outbound checks', async () => {
    await expect(isAllowedOutboundUrlResolved('https://1.1.1.1/orders', ['1.1.1.1'])).resolves.toBe(true);
  });
  it('enforces the outbound policy on the actual fetch boundary', async () => {
    const fetcher = async () => new Response('{}', { status: 200 });
    await expect(secureOutboundFetch('https://evil.example/orders', {}, { allowlist: ['api.example.com'], fetch: fetcher })).rejects.toThrow('outbound URL rejected');
  });
  it('adds secure headers', () => {
    const headers = buildSecurityHeaders();
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['x-content-type-options']).toBe('nosniff');
  });
  it('rejects stale and duplicate webhook signatures', () => {
    const guard = new ReplayGuard({ maxAgeSeconds: 300, now: () => new Date(1_000_000) });
    expect(() => guard.assertFresh('evt-1', 999_000)).toThrow();
    guard.accept('evt-2', 900);
    expect(() => guard.accept('evt-2', 900)).toThrow();
  });
  it('detects sensitive values rather than merely matching field names', () => {
    expect(scanSensitiveOutput('contact=13800138000')).not.toEqual([]);
    expect(scanSensitiveOutput('safe-order-ref')).toEqual([]);
  });
});

