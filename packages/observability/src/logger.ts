export interface LogEvent { name: string; requestId: string; correlationId: string; fields?: Record<string, unknown> }
export interface RedactedLogger { info(event: LogEvent, fields?: Record<string, unknown>): void; warn(event: LogEvent, fields?: Record<string, unknown>): void; error(event: LogEvent, fields?: Record<string, unknown>): void }
const SENSITIVE = /(^|_|-)(name|fullname|firstname|lastname|id(number|card)?|passport(number)?|phone(number)?|mobile|email|authorization|cookie|password|secret|token|payment|card(number)?|cvv|encrypted|ciphertext|plaintext|rawbody|traveler)(_|-|$)/i;
function redact(value: unknown, key = ''): unknown {
  if (SENSITIVE.test(key)) return '[REDACTED]';
  if (typeof value === 'string') {
    return value.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]').replace(/\b\d{17}[\dXx]\b/g, '[REDACTED_ID]').replace(/\b1[3-9]\d{9}\b/g, '[REDACTED_PHONE]').replace(/\b\d{12,19}\b/g, '[REDACTED_PAYMENT]');
  }
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, redact(v,k)]));
  return value;
}
export function serializeLogEvent(event: LogEvent, fields?: Record<string, unknown>): string {
  const safe = { name: event.name, requestId: event.requestId, correlationId: event.correlationId, fields: redact({ ...(event.fields ?? {}), ...(fields ?? {}) }) };
  return JSON.stringify(safe);
}
export function createRedactedLogger(write: (line: string) => void = line => process.stdout.write(`${line}\n`)): RedactedLogger {
  const emit = (level: string, event: LogEvent, fields?: Record<string, unknown>) => write(serializeLogEvent({ ...event, fields: { ...(event.fields ?? {}), ...(fields ?? {}), level } }));
  return { info: (e,f) => emit('info',e,f), warn: (e,f) => emit('warn',e,f), error: (e,f) => emit('error',e,f) };
}
export { redact };
