function redact(value: unknown, sensitiveValues: readonly string[]): unknown {
  if (typeof value === 'string') {
    return sensitiveValues
      .filter(item => item.length > 0)
      .reduce((result, item) => result.split(item).join('[REDACTED]'), value);
  }
  if (Array.isArray(value)) return value.map(item => redact(item, sensitiveValues));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redact(item, sensitiveValues)]),
    );
  }
  return value;
}

export function serializeRedacted(value: unknown, sensitiveValues: readonly string[]): string {
  return JSON.stringify(redact(value, sensitiveValues)) ?? 'null';
}
