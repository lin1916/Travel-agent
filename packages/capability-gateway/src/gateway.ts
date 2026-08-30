import { createAppError, RiskLevelSchema } from '@travel/contracts';
import { CapabilityContextSchema, type CapabilityContext } from './context.js';
import { PolicyChecker } from './policy-checker.js';
import type { CapabilityTool } from './tool.js';

export interface ExecutionPolicyCheck {
  check(context: CapabilityContext, input: unknown, tool: CapabilityTool<unknown, unknown>): Promise<ExecutionPolicyResult> | ExecutionPolicyResult;
}
export interface ExecutionPolicyResult { allowed: boolean; reason?: string; consume?: () => Promise<void> | void }
export type ExecutionPolicyEvaluator = ExecutionPolicyCheck | ((context: CapabilityContext, input: unknown, tool: CapabilityTool<unknown, unknown>) => Promise<ExecutionPolicyResult> | ExecutionPolicyResult);

export class CapabilityGateway {
  private readonly tools = new Map<string, CapabilityTool<unknown, unknown>>();

  constructor(tools: CapabilityTool<unknown, unknown>[] = [], private readonly policyChecker = new PolicyChecker(), private readonly executionPolicy?: ExecutionPolicyEvaluator) {
    for (const tool of tools) this.register(tool);
  }

  register<I, O>(tool: CapabilityTool<I, O>): void {
    if (this.tools.has(tool.name)) throw new Error(`capability already registered: ${tool.name}`);
    this.tools.set(tool.name, tool as CapabilityTool<unknown, unknown>);
  }

  has(name: string): boolean { return this.tools.has(name); }

  list(): string[] { return [...this.tools.keys()]; }

  riskOf(name: string) { return this.tools.get(name)?.risk; }

  async execute<O>(name: string, rawContext: CapabilityContext, input: unknown): Promise<O> {
    const contextResult = CapabilityContextSchema.safeParse(rawContext);
    if (!contextResult.success) {
      throw createAppError('validation_error', rawContext?.correlationId ?? 'unknown', contextResult.error.issues[0]?.message);
    }
    const context = contextResult.data;
    const tool = this.tools.get(name);
    if (!tool) throw this.policyChecker.blocked(context, `tool is not allow-listed: ${name}`);
    if (!RiskLevelSchema.safeParse(tool.risk).success) throw createAppError('validation_error', context.correlationId, `invalid risk level for tool: ${name}`);

    const inputResult = tool.inputSchema.safeParse(input);
    if (!inputResult.success) {
      throw createAppError('validation_error', context.correlationId, inputResult.error.issues[0]?.message);
    }
    if (input && typeof input === 'object' && 'tripId' in input && (input as { tripId?: unknown }).tripId !== context.tripId) {
      throw this.policyChecker.blocked(context, 'tool input trip does not match capability context');
    }
    const decision = this.policyChecker.check(tool, context);
    if (!decision.allowed) throw this.policyChecker.blocked(context, decision.reason ?? 'policy denied');
    if (tool.risk === 'commit' || tool.risk === 'redirect') {
      if (!this.executionPolicy) throw this.policyChecker.blocked(context, 'execution policy evaluator is required for external side effects');
      const executionDecision = await (typeof this.executionPolicy === 'function' ? this.executionPolicy(context, inputResult.data, tool) : this.executionPolicy.check(context, inputResult.data, tool));
      if (!executionDecision.allowed) throw this.policyChecker.blocked(context, executionDecision.reason ?? 'execution policy denied');
      if (!executionDecision.consume) throw this.policyChecker.blocked(context, 'single-use action decision consumption is required');
      await executionDecision.consume();
    }
    return tool.execute(context, inputResult.data) as Promise<O>;
  }
}
