export function isLocalPlanningMemoryMode(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.NODE_ENV === 'development'
    && environment.LOCAL_PLANNING_MEMORY_MODE === 'true'
    && !environment.DATABASE_URL?.trim();
}

export function shouldRunBootstrapMigrations(environment: NodeJS.ProcessEnv = process.env): boolean {
  return !isLocalPlanningMemoryMode(environment);
}
