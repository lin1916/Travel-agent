import { describe, expect, it } from 'vitest';
import { assertSafeRequest, buildSecurityHeaders, isAllowedOutboundUrl } from '../src/http-security.js';
import { ReplayGuard } from '../src/webhook-replay.js';

describe('http and webhook security', () => {
  it('rejects oversized requests and unsafe browser mutations', () => {
    expect(() => assertSafeRequest({ method: 'POST', contentLength: 2_000_000, maxBytes: 1_000_000, isBrowser: true, csrfToken: undefined, csrfCookie: 'x' })).toThrow();
    expect(() => assertSafeRequest({ method: 'POST', contentLength: 10, maxBytes: 100, isBrowser: true, csrfToken: 'bad', csrfCookie: 'good' })).toThrow();
  });
  it('allows only configured supplier hosts and rejects localhost SSRF', () => {
    expect(isAllowedOutboundUrl('https://api.example.com/orders', ['api.example.com'])).toBe(true);
    expect(isAllowedOutboundUrl('http://127.0.0.1:8080/', ['127.0.0.1'])).toBe(false);
    expect(isAllowedOutboundUrl('https://evil.example/', ['api.example.com'])).toBe(false);
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
});

