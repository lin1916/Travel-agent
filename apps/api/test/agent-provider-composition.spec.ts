import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPlanningProvider,
  ModelConfigurationError,
  RuleBasedProvider,
  ThirdPartyResponsesProvider,
} from '@travel/agent-runtime';
import { AgentModule } from '../src/modules/agent/agent.module.js';
import { ConversationModule } from '../src/modules/conversations/conversation.module.js';

const environmentKeys = [
  'NODE_ENV',
  'DATABASE_URL',
  'TRAVEL_LLM_BASE_URL',
  'TRAVEL_LLM_RESPONSES_PATH',
  'TRAVEL_LLM_API_KEY',
  'TRAVEL_LLM_MODEL',
  'TRAVEL_LLM_REASONING_EFFORT',
  'TRAVEL_LLM_TIMEOUT_MS',
  'TRAVEL_AGENT_TEST_PROVIDER',
] as const;

const originalEnvironment = Object.fromEntries(
  environmentKeys.map(key => [key, process.env[key]]),
);

function restoreEnvironment(): void {
  for (const key of environmentKeys) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function configuredEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    TRAVEL_LLM_BASE_URL: 'https://responses.example.test',
    TRAVEL_LLM_RESPONSES_PATH: '/responses',
    TRAVEL_LLM_API_KEY: 'test-only-key',
    TRAVEL_LLM_MODEL: 'gpt-5.5',
    TRAVEL_LLM_REASONING_EFFORT: 'xhigh',
    TRAVEL_LLM_TIMEOUT_MS: '60000',
    ...overrides,
  };
}

describe('agent planning provider composition', () => {
  afterEach(restoreEnvironment);

  it('fails production AgentModule composition without model credentials', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://agent-provider-composition@127.0.0.1:5432/travel_agent',
    });
    delete process.env.TRAVEL_LLM_API_KEY;

    await expect(Test.createTestingModule({ imports: [AgentModule] }).compile())
      .rejects.toBeInstanceOf(ModelConfigurationError);
  });

  it('creates a third-party Responses provider from configured environment', () => {
    expect(createPlanningProvider(configuredEnvironment())).toBeInstanceOf(ThirdPartyResponsesProvider);
  });

  it('allows the rule provider only with the explicit test override', () => {
    expect(createPlanningProvider({ NODE_ENV: 'test', TRAVEL_AGENT_TEST_PROVIDER: 'rule' }))
      .toBeInstanceOf(RuleBasedProvider);
    expect(createPlanningProvider(configuredEnvironment({ TRAVEL_AGENT_TEST_PROVIDER: 'rule' })))
      .toBeInstanceOf(ThirdPartyResponsesProvider);
  });

  it('compiles ConversationModule with its planning context dependencies', async () => {
    Object.assign(process.env, { NODE_ENV: 'test', TRAVEL_AGENT_TEST_PROVIDER: 'rule' });
    delete process.env.DATABASE_URL;

    await expect(Test.createTestingModule({ imports: [ConversationModule] }).compile()).resolves.toBeDefined();
  });
});
