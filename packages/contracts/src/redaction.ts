export function redactSensitiveText(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]')
    .replace(/\b\d{17}[\dXx]\b/g, '[REDACTED_ID]')
    .replace(/\b1[3-9]\d{9}\b/g, '[REDACTED_PHONE]')
    .replace(/\b\d{12,19}\b/g, '[REDACTED_PAYMENT]')
    .replace(/authorization\s*:\s*(?:bearer\s+)?\S+/gi, 'authorization: [REDACTED]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|token|secret|cookie|security[_ -]?code)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/((?:passport|password|bank\s*card|card\s*number|\u62a4\u7167|\u5bc6\u7801|\u8eab\u4efd\u8bc1|\u94f6\u884c\u5361)\s*[:\u53f7=]?\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

export function redactSensitiveValue<T>(value: T): T {
  if (typeof value === 'string') return redactSensitiveText(value) as T;
  if (Array.isArray(value)) return value.map(item => redactSensitiveValue(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactSensitiveValue(item)]),
    ) as T;
  }
  return value;
}
