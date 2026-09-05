import type { MapPublicConfig } from '../../lib/api-client';

declare global { interface Window { AMap?: any; _AMapSecurityConfig?: { serviceHost?: string } } }

let loading: Promise<any> | undefined;
export function loadAMap(config: MapPublicConfig): Promise<any> {
  if (!config.jsKey) return Promise.reject(new Error('AMap public key is not configured'));
  if (window.AMap) return Promise.resolve(window.AMap);
  if (loading) return loading;
  window._AMapSecurityConfig = { serviceHost: config.proxyUrl };
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(config.jsKey)}`;
    script.onload = () => window.AMap ? resolve(window.AMap) : reject(new Error('AMap loaded without global')); 
    script.onerror = () => { loading = undefined; reject(new Error('AMap script failed to load')); };
    document.head.appendChild(script);
  });
  return loading;
}
