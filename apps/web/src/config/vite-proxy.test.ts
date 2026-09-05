import { describe, expect, it } from 'vitest';
import * as viteConfiguration from '../../vite.config.ts';

interface ProxyEntry {
  target: string;
  changeOrigin: boolean;
  rewrite?: (path: string) => string;
}

describe('Vite API proxies', () => {
  it('rewrites API requests but preserves AMap service paths', () => {
    const createApiProxy = (viteConfiguration as typeof viteConfiguration & {
      createApiProxy?: (host: string, port: string) => Record<string, ProxyEntry>;
    }).createApiProxy;

    expect(createApiProxy).toBeTypeOf('function');
    const proxy = createApiProxy?.('127.0.0.1', '4010');
    expect(proxy?.['/api']).toMatchObject({ target: 'http://127.0.0.1:4010', changeOrigin: true });
    expect(proxy?.['/api'].rewrite?.('/api/v1/map/public-config')).toBe('/v1/map/public-config');
    expect(proxy?.['/_AMapService']).toEqual({ target: 'http://127.0.0.1:4010', changeOrigin: true });
  });
});
