import { describe, expect, it } from 'vitest';
import { probePiEndpoint, type PiEndpointProbeConfig } from '../src/pi-endpoint-probe.js';

const config: PiEndpointProbeConfig = {
  baseUrl: 'https://responses.example.test',
  responsesPath: '/responses',
  apiKey: 'secret-key',
  model: 'gpt-5.5',
  reasoningEffort: 'minimal',
  timeoutMs: 100,
  allowlist: ['responses.example.test'],
};

function response(body: unknown, init: ResponseInit = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function validFetch(probeConfig = config, body = JSON.stringify({ assistantMessage: 'Ready', missingFields: [], toolCalls: [], actionRequests: [] })) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    expect(String(input)).toBe('https://responses.example.test/responses');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer secret-key',
      'content-type': 'application/json',
    });
    const requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(requestBody).toMatchObject({ model: probeConfig.model, store: false, reasoning: { effort: probeConfig.reasoningEffort } });
    expect(requestBody.input).toEqual([
      { role: 'system', content: [{ type: 'input_text', text: expect.any(String) }] },
      { role: 'user', content: [{ type: 'input_text', text: expect.any(String) }] },
    ]);
    expect(requestBody.tools).toBeUndefined();
    expect(requestBody.text).toMatchObject({ format: { type: 'json_schema', name: 'travel_planning_output', strict: true } });
    return response({ output_text: body });
  };
}

describe('probePiEndpoint', () => {
  it('accepts a valid structured Responses payload without exposing response content', async () => {
    const result = await probePiEndpoint(config, validFetch());
    expect(result).toMatchObject({ reachable: true, protocol: 'openai-responses', model: 'gpt-5.5' });
    expect(JSON.stringify(result)).not.toMatch(/secret|passport|phone|authorization/i);
  });

  it('returns a stable error code for an unreachable endpoint', async () => {
    await expect(probePiEndpoint(config, async () => { throw new Error('network secret'); }))
      .resolves.toMatchObject({ reachable: false, errorCode: 'endpoint_unreachable' });
  });

  it('returns missing configuration without making a request', async () => {
    let called = false;
    const result = await probePiEndpoint({ ...config, apiKey: ' ' }, async () => {
      called = true;
      return response({ output_text: '{}' });
    });
    expect(result).toMatchObject({ reachable: false, model: 'gpt-5.5', errorCode: 'missing_configuration' });
    expect(called).toBe(false);
  });

  it('rejects an unsafe endpoint before network access', async () => {
    let called = false;
    const result = await probePiEndpoint({ ...config, baseUrl: 'http://localhost:3000' }, async () => {
      called = true;
      return response({ output_text: '{}' });
    });
    expect(result).toMatchObject({ reachable: false, errorCode: 'unsafe_endpoint' });
    expect(called).toBe(false);
  });

  it('returns http_error for non-success responses', async () => {
    const result = await probePiEndpoint(config, async () => response({ error: 'secret' }, { status: 401 }));
    expect(result).toMatchObject({ reachable: false, model: 'gpt-5.5', errorCode: 'http_error' });
    expect(JSON.stringify(result)).not.toMatch(/secret|401/);
  });

  it('returns invalid_json when the response body is not JSON', async () => {
    const result = await probePiEndpoint(config, async () => response('not-json'));
    expect(result).toMatchObject({ reachable: false, errorCode: 'invalid_json' });
  });

  it('returns missing_structured_output when output text is absent', async () => {
    const result = await probePiEndpoint(config, async () => response({ output: [{ type: 'message', content: [{ type: 'input_text', text: 'nope' }] }] }));
    expect(result).toMatchObject({ reachable: false, errorCode: 'missing_structured_output' });
  });

  it('accepts output text nested in a Responses message', async () => {
    const result = await probePiEndpoint(config, async () => response({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }] }));
    expect(result).toMatchObject({ reachable: true, protocol: 'openai-responses', model: 'gpt-5.5' });
  });

  it('returns timeout when the request is aborted by the timeout policy', async () => {
    const result = await probePiEndpoint({ ...config, timeoutMs: 1 }, async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    expect(result).toMatchObject({ reachable: false, errorCode: 'timeout' });
  });

  it('preserves an unknown configured model in the result', async () => {
    const unknownModelConfig = { ...config, model: 'vendor-model-x' };
    const result = await probePiEndpoint(unknownModelConfig, validFetch(unknownModelConfig, '{}'));
    expect(result).toMatchObject({ reachable: true, model: 'vendor-model-x' });
  });
});
