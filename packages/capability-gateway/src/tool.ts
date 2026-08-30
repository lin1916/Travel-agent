import type { RiskLevel } from '@travel/contracts';
import type { ZodType } from 'zod';
import type { CapabilityContext } from './context.js';

export interface CapabilityTool<I, O> {
  name: string;
  risk: RiskLevel;
  inputSchema: ZodType<I>;
  execute(context: CapabilityContext, input: I): Promise<O>;
}
