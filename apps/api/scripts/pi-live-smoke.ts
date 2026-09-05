import { probePiEndpoint, type PiEndpointProbeConfig } from '@travel/agent-runtime';

const defaultBaseUrl = 'https://apizh-ai.com';
const defaultResponsesPath = '/responses';
const defaultModel = 'gpt-5.5';
const defaultReasoningEffort = 'xhigh';
const defaultTimeoutMs = 30_000;

function configuredEnvironment(): PiEndpointProbeConfig | undefined {
  const apiKey = process.env.TRAVEL_LLM_API_KEY?.trim();
  if (process.env.TRAVEL_AGENT_RUNTIME?.trim() !== 'pi' || !apiKey) return undefined;

  return {
    baseUrl: process.env.TRAVEL_LLM_BASE_URL?.trim() || defaultBaseUrl,
    responsesPath: process.env.TRAVEL_LLM_RESPONSES_PATH?.trim() || defaultResponsesPath,
    apiKey,
    model: process.env.TRAVEL_LLM_MODEL?.trim() || defaultModel,
    reasoningEffort: (process.env.TRAVEL_LLM_REASONING_EFFORT?.trim() || defaultReasoningEffort) as PiEndpointProbeConfig['reasoningEffort'],
    timeoutMs: Number(process.env.TRAVEL_LLM_TIMEOUT_MS ?? String(defaultTimeoutMs)),
  };
}

async function main(): Promise<number> {
  const config = configuredEnvironment();
  if (!config) {
    console.log('status=failed errorCode=missing_configuration');
    return 1;
  }

  const startedAt = Date.now();
  const result = await probePiEndpoint(config);
  if (!result.reachable) {
    console.log(`status=failed errorCode=${result.errorCode ?? 'endpoint_unreachable'}`);
    return 1;
  }

  console.log(`status=ok latencyMs=${Date.now() - startedAt} model=${result.model}`);
  return 0;
}

main().then((exitCode) => {
  process.exitCode = exitCode;
}).catch(() => {
  console.log('status=failed errorCode=endpoint_unreachable');
  process.exitCode = 1;
});
