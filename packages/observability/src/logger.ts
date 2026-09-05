export interface LogEvent { name: string; requestId: string; correlationId: string; fields?: Record<string, unknown> }
export interface RedactedLogger { info(event: LogEvent, fields?: Record<string, unknown>): void; warn(event: LogEvent, fields?: Record<string, unknown>): void; error(event: LogEvent, fields?: Record<string, unknown>): void }
const SENSITIVE = /(name|fullname|firstname|lastname|idnumber|idcard|passport|phonenumber|mobile|email|authorization|cookie|password|secret|token|payment|card|cvv|encrypted|ciphertext|plaintext|rawbody|traveler)/i;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
function safeIdentifier(value: string): string { return SAFE_ID.test(value) && !/(?:\d{7,}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/.test(value) ? value : '[REDACTED_ID]'; }
function sensitiveKey(key: string): boolean { return SENSITIVE.test(key.replace(/([a-z])([A-Z])/g, '$1$2').toLowerCase().replace(/[^a-z]/g, '')); }
function redact(value: unknown, key = ''): unknown {
  if (sensitiveKey(key)) return '[REDACTED]';
  if (typeof value === 'string') {
    return value.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]').replace(/\b\d{17}[\dXx]\b/g, '[REDACTED_ID]').replace(/\b1[3-9]\d{9}\b/g, '[REDACTED_PHONE]').replace(/\b\d{12,19}\b/g, '[REDACTED_PAYMENT]');
  }
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, redact(v,k)]));
  return value;
}
export function serializeLogEvent(event: LogEvent, fields?: Record<string, unknown>): string {
  const safe = { name: event.name, requestId: safeIdentifier(event.requestId), correlationId: safeIdentifier(event.correlationId), fields: redact({ ...(event.fields ?? {}), ...(fields ?? {}) }) };
  return JSON.stringify(safe);
}
export function createRedactedLogger(write: (line: string) => void = line => process.stdout.write(`${line}\n`)): RedactedLogger {
  const emit = (level: string, event: LogEvent, fields?: Record<string, unknown>) => write(serializeLogEvent({ ...event, fields: { ...(event.fields ?? {}), ...(fields ?? {}), level } }));
  return { info: (e,f) => emit('info',e,f), warn: (e,f) => emit('warn',e,f), error: (e,f) => emit('error',e,f) };
}
export { redact };
