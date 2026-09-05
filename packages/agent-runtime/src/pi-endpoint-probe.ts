import {
  assertOutboundUrl,
  isAllowedOutboundUrlResolved,
  supplierRequestOptions,
} from '@travel/security';

export interface PiEndpointProbeConfig {
  baseUrl: string;
  responsesPath: string;
  apiKey: string;
  model: string;
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  timeoutMs: number;
  allowlist?: readonly string[];
}

export type PiEndpointProbeErrorCode =
  | 'missing_configuration'
  | 'unsafe_endpoint'
  | 'endpoint_unreachable'
  | 'http_error'
  | 'invalid_json'
  | 'missing_structured_output'
  | 'timeout';

export interface PiEndpointProbeResult {
  reachable: boolean;
  protocol: 'openai-responses';
  model: string;
  errorCode?: PiEndpointProbeErrorCode;
}

const reasoningEfforts = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const;

const planningOutputJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['assistantMessage', 'missingFields', 'toolCalls', 'actionRequests'],
  properties: {
    assistantMessage: { type: 'string' },
    missingFields: { type: 'array', items: { type: 'string' } },
    toolCalls: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['toolName', 'input'],
        properties: {
          toolName: { type: 'string' },
          input: { type: 'object', additionalProperties: true },
        },
      },
    },
    actionRequests: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'resourceId'],
        properties: {
          kind: { type: 'string' },
          resourceId: { type: 'string' },
        },
      },
    },
  },
} as const;

function result(model: string, errorCode?: PiEndpointProbeErrorCode): PiEndpointProbeResult {
  return errorCode
    ? { reachable: false, protocol: 'openai-responses', model, errorCode }
    : { reachable: true, protocol: 'openai-responses', model };
}

function endpoint(baseUrl: string, responsesPath: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${responsesPath.replace(/^\/+/, '')}`;
}

function outputText(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === 'string' && record.output_text.trim()) return record.output_text;
  if (!Array.isArray(record.output)) return undefined;
  for (const item of record.output) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const partRecord = part as Record<string, unknown>;
      if (partRecord.type === 'output_text' && typeof partRecord.text === 'string' && partRecord.text.trim()) {
        return partRecord.text;
      }
    }
  }
  return undefined;
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'name' in error && (error as { name?: unknown }).name === 'AbortError');
}

function isValidReasoningEffort(value: string): value is PiEndpointProbeConfig['reasoningEffort'] {
  return (reasoningEfforts as readonly string[]).includes(value);
}

export async function probePiEndpoint(
  config: PiEndpointProbeConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<PiEndpointProbeResult> {
  const source = config as Partial<PiEndpointProbeConfig>;
  const baseUrl = typeof source.baseUrl === 'string' ? source.baseUrl.trim() : '';
  const responsesPath = typeof source.responsesPath === 'string' ? source.responsesPath.trim() : '';
  const apiKey = typeof source.apiKey === 'string' ? source.apiKey.trim() : '';
  const model = typeof source.model === 'string' ? source.model.trim() : '';
  const reasoningEffort = typeof source.reasoningEffort === 'string' ? source.reasoningEffort.trim() : '';
  const timeoutMs = source.timeoutMs;

  if (
    !baseUrl
    || !responsesPath
    || !apiKey
    || !model
    || !isValidReasoningEffort(reasoningEffort)
    || typeof timeoutMs !== 'number'
    || !Number.isFinite(timeoutMs)
    || timeoutMs <= 0
    || timeoutMs > 30_000
  ) {
    return result(model, 'missing_configuration');
  }

  let target: URL;
  let allowlist: readonly string[];
  try {
    allowlist = source.allowlist?.length ? source.allowlist : [new URL(baseUrl).hostname];
    target = assertOutboundUrl(endpoint(baseUrl, responsesPath), allowlist);
  } catch {
    return result(model, 'unsafe_endpoint');
  }

  if (fetchImpl === globalThis.fetch && !(await isAllowedOutboundUrlResolved(target.toString(), allowlist))) {
    return result(model, 'unsafe_endpoint');
  }

  const controller = new AbortController();
  const timeout = supplierRequestOptions(timeoutMs).timeoutMs;
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    let response: Response;
    try {
      response = await fetchImpl(target.toString(), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          store: false,
          reasoning: { effort: reasoningEffort },
          input: [
            {
              role: 'system',
              content: [{
                type: 'input_text',
                text: 'You are a travel planning compatibility probe. Return only the requested structured planning object and do not use tools.',
              }],
            },
            {
              role: 'user',
              content: [{
                type: 'input_text',
                text: 'Return a minimal structured planning object with an empty toolCalls array and an empty actionRequests array.',
              }],
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'travel_planning_output',
              strict: true,
              schema: planningOutputJsonSchema,
            },
          },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      return result(model, controller.signal.aborted || isAbortError(error) ? 'timeout' : 'endpoint_unreachable');
    }

    if (!response.ok) return result(model, 'http_error');

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      return result(model, controller.signal.aborted || isAbortError(error) ? 'timeout' : 'invalid_json');
    }

    return outputText(payload) ? result(model) : result(model, 'missing_structured_output');
  } finally {
    clearTimeout(timer);
  }
}
