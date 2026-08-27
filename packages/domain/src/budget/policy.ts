export interface BudgetOverride {
  override: boolean;
  decisionRef?: string;
}

export function validOverride(override?: BudgetOverride): override is Required<BudgetOverride> {
  return override?.override === true && Boolean(override.decisionRef?.trim());
}
