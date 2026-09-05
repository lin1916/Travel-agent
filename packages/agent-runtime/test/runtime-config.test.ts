import { describe, expect, it } from 'vitest';
import { resolveAgentRuntimeConfig } from '../src/runtime-config.js';

describe('resolveAgentRuntimeConfig', () => {
  it('keeps legacy runtime as the default', () => {
    expect(resolveAgentRuntimeConfig({ NODE_ENV: 'development' }).mode).toBe('legacy');
  });

  it('enables Pi only with an explicit mode and configured model key', () => {
    expect(resolveAgentRuntimeConfig({
      NODE_ENV: 'development',
      TRAVEL_AGENT_RUNTIME: 'pi',
      TRAVEL_LLM_API_KEY: 'present',
      TRAVEL_LLM_BASE_URL: 'https://apizh-ai.com',
      TRAVEL_LLM_RESPONSES_PATH: '/responses',
      TRAVEL_LLM_MODEL: 'gpt-5.5',
    })).toMatchObject({ mode: 'pi', apiKeyConfigured: true });
  });

  it('keeps Pi disabled when the running Node version is below the minimum', () => {
    const original = process.version;
    Object.defineProperty(process, 'version', { configurable: true, value: 'v22.18.0' });
    try {
      const config = resolveAgentRuntimeConfig({
        NODE_ENV: 'development',
        TRAVEL_AGENT_RUNTIME: 'pi',
        TRAVEL_LLM_API_KEY: 'present',
      });
      expect(config.nodeVersion).toBe('v22.18.0');
      expect(config.piEnabled).toBe(false);
    } finally {
      Object.defineProperty(process, 'version', { configurable: true, value: original });
    }
  });

  it('rejects Pi mode in production when the model key is missing', () => {
    expect(() => resolveAgentRuntimeConfig({ NODE_ENV: 'production', TRAVEL_AGENT_RUNTIME: 'pi' }))
      .toThrow('Pi runtime requires a configured model API key');
  });
});
