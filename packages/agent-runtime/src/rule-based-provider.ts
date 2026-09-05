import type { StructuredAgentOutput } from '@travel/contracts';
import type { LlmProvider, LlmTurnInput } from './llm-provider.js';

const DATE = /\b(20\d{2}-\d{2}-\d{2})(?:T[^\s]+)?\b/g;
const TRAVELERS = /(?:for\s*)?(\d{1,2})\s*(?:travelers?|\u4eba)/iu;

function cstMidnight(date: string): string { return `${date}T00:00:00.000+08:00`; }

function extractDestination(message: string): string {
  const explicit = message.match(/(?:to|in|\u53bb|\u524d\u5f80)\s*([\p{L}\u4e00-\u9fff]{2,32})/iu)?.[1]
    ?? message.match(/plan\s+([\p{L}\u4e00-\u9fff]{2,32})/iu)?.[1];
  return explicit ?? '\u672a\u6307\u5b9a\u76ee\u7684\u5730';
}

export class RuleBasedProvider implements LlmProvider {
  async generatePlan(input: LlmTurnInput): Promise<StructuredAgentOutput> {
    if (input.toolResults.length) {
      const completed = input.toolResults.filter(result => result.status === 'completed').length;
      return { assistantMessage: `Found planning results for ${completed} categories.`, planningContextPatch: null, missingFields: [], toolCalls: [], actionRequests: [], planProposal: null };
    }
    const dates = [...input.userMessage.matchAll(DATE)].map(match => cstMidnight(match[1]));
    if (dates.length === 0) {
      return { assistantMessage: 'What dates would you like to travel? Please provide a start date, for example 2026-09-01.', planningContextPatch: null, missingFields: ['startsAt'], toolCalls: [], actionRequests: [], planProposal: null };
    }
    if (dates.length === 1) {
      return { assistantMessage: 'What is the end date for your trip?', planningContextPatch: null, missingFields: ['endsAt'], toolCalls: [], actionRequests: [], planProposal: null };
    }
    const startsAt = dates[0];
    const endsAt = dates[1];
    const travelerMatch = input.userMessage.match(TRAVELERS);
    const travelers = Number(travelerMatch?.[1] ?? 1);
    if (travelerMatch && (travelers < 1 || travelers > 6)) {
      return { assistantMessage: 'How many travelers should I plan for? Please provide a number from 1 to 6.', planningContextPatch: null, missingFields: ['travelerCount'], toolCalls: [], actionRequests: [], planProposal: null };
    }
    const destination = extractDestination(input.userMessage);
    const toolCalls = (['train', 'stay', 'attraction', 'dining'] as const).map(kind => ({
      toolName: 'search_offers',
      input: { tripId: input.tripId, kind, destination, startsAt, endsAt, travelers },
    }));
    return {
      assistantMessage: `\u6211\u4f1a\u67e5\u627e ${destination} 的交通、住宿、景点和餐饮选项。`,
      planningContextPatch: null,
      missingFields: [],
      toolCalls,
      actionRequests: [],
      planProposal: null,
    };
  }
}
