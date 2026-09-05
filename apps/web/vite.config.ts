import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export function createApiProxy(apiHost: string, apiPort: string) {
  const target = `http://${apiHost}:${apiPort}`;
  return {
    '/api': { target, changeOrigin: true, rewrite: (path: string) => path.replace(/^\/api/, '') },
    '/_AMapService': { target, changeOrigin: true },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../../', '');
  const apiPort = process.env.API_PORT ?? env.API_PORT ?? '3000';
  const apiHost = process.env.API_HOST ?? env.API_HOST ?? '127.0.0.1';
  const apiProxy = createApiProxy(apiHost, apiPort);
  return {
    plugins: [react()],
    server: { proxy: apiProxy },
    preview: { proxy: apiProxy },
  };
});
