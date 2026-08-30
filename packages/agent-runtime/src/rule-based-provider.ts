import type { AgentContext, StructuredAgentOutput } from '@travel/contracts';
import type { LlmProvider } from './llm-provider.js';

const DATE = /\b(20\d{2}-\d{2}-\d{2})(?:T[^\s]+)?\b/g;
const TRAVELERS = /(?:for|\u4eba|travelers?)[^0-9]{0,8}(\d{1,2})/i;

function extractDestination(message: string): string {
  const explicit = message.match(/(?:to|in|\u53bb|\u524d\u5f80)\s*([\p{L}\u4e00-\u9fff]{2,32})/iu)?.[1]
    ?? message.match(/plan\s+([\p{L}\u4e00-\u9fff]{2,32})/iu)?.[1];
  return explicit ?? '\u672a\u6307\u5b9a\u76ee\u7684\u5730';
}

export class RuleBasedProvider implements LlmProvider {
  async generatePlan(input: AgentContext): Promise<StructuredAgentOutput> {
    const dates = [...input.userMessage.matchAll(DATE)].map(match => `${match[1]}T00:00:00.000Z`);
    if (dates.length === 0) {
      return { assistantMessage: 'What dates would you like to travel? Please provide a start date, for example 2026-09-01.', missingFields: ['startsAt'], toolCalls: [], actionRequests: [] };
    }
    if (dates.length === 1) {
      return { assistantMessage: 'What is the end date for your trip?', missingFields: ['endsAt'], toolCalls: [], actionRequests: [] };
    }
    const startsAt = dates[0];
    const endsAt = dates[1];
    const travelers = Math.min(6, Math.max(1, Number(input.userMessage.match(TRAVELERS)?.[1] ?? 1)));
    const destination = extractDestination(input.userMessage);
    const toolCalls = (['train', 'stay', 'attraction', 'dining'] as const).map(kind => ({
      toolName: 'search_offers',
      input: { tripId: input.tripId, kind, destination, startsAt, endsAt, travelers },
    }));
    return {
      assistantMessage: `\u6211\u4f1a\u67e5\u627e ${destination} 的交通、住宿、景点和餐饮选项。`,
      missingFields: [],
      toolCalls,
      actionRequests: [],
    };
  }
}
