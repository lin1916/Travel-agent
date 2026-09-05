export type AgentRuntimeMode = 'legacy' | 'pi';

export interface AgentRuntimeConfig {
  mode: AgentRuntimeMode;
  piEnabled: boolean;
  model: string;
  baseUrl: string;
  responsesPath: string;
  apiKeyConfigured: boolean;
  nodeVersion: string;
}

const DEFAULT_MODEL = 'gpt-5.5';
const DEFAULT_BASE_URL = 'https://apizh-ai.com';
const DEFAULT_RESPONSES_PATH = '/responses';
const MIN_PI_NODE_VERSION = [22, 19, 0] as const;

function supportsPiNodeVersion(version: string): boolean {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const current = match.slice(1).map(Number);
  for (let index = 0; index < MIN_PI_NODE_VERSION.length; index += 1) {
    if (current[index] !== MIN_PI_NODE_VERSION[index]) return current[index] > MIN_PI_NODE_VERSION[index];
  }
  return true;
}

export function resolveAgentRuntimeConfig(environment: NodeJS.ProcessEnv): AgentRuntimeConfig {
  const mode: AgentRuntimeMode = environment.TRAVEL_AGENT_RUNTIME?.trim() === 'pi' ? 'pi' : 'legacy';
  const apiKeyConfigured = Boolean(environment.TRAVEL_LLM_API_KEY?.trim());

  if (mode === 'pi' && environment.NODE_ENV?.trim() === 'production' && !apiKeyConfigured) {
    throw new Error('Pi runtime requires a configured model API key');
  }

  return {
    mode,
    piEnabled: mode === 'pi' && apiKeyConfigured && supportsPiNodeVersion(process.version),
    model: environment.TRAVEL_LLM_MODEL?.trim() || DEFAULT_MODEL,
    baseUrl: environment.TRAVEL_LLM_BASE_URL?.trim() || DEFAULT_BASE_URL,
    responsesPath: environment.TRAVEL_LLM_RESPONSES_PATH?.trim() || DEFAULT_RESPONSES_PATH,
    apiKeyConfigured,
    nodeVersion: process.version,
  };
}
