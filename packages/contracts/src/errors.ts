import { z } from 'zod';
export const AppErrorCodeSchema = z.enum(['validation_error','unauthorized','forbidden','conflict','policy_blocked','supplier_unavailable','unknown_external_result']);
export type AppErrorCode = z.infer<typeof AppErrorCodeSchema>;
export interface AppError { code: AppErrorCode; httpStatus: number; retryable: boolean; publicMessage: string; correlationId: string; internalDetail?: string }
export const AppErrorSchema = z.object({ code: AppErrorCodeSchema, httpStatus: z.number().int(), retryable: z.boolean(), publicMessage: z.string(), correlationId: z.string(), internalDetail: z.string().optional() });
export function toPublicError(error: AppError): Omit<AppError, 'internalDetail'> { const { internalDetail: _internalDetail, ...publicError } = error; return publicError; }
const defaults: Record<AppErrorCode, Pick<AppError, 'httpStatus'|'retryable'|'publicMessage'>> = {
  validation_error: { httpStatus: 400, retryable: false, publicMessage: 'The request is invalid.' },
  unauthorized: { httpStatus: 401, retryable: false, publicMessage: 'Authentication is required.' },
  forbidden: { httpStatus: 403, retryable: false, publicMessage: 'You are not allowed to perform this action.' },
  conflict: { httpStatus: 409, retryable: false, publicMessage: 'The resource changed. Refresh and try again.' },
  policy_blocked: { httpStatus: 422, retryable: false, publicMessage: 'This action is blocked by the travel policy.' },
  supplier_unavailable: { httpStatus: 503, retryable: true, publicMessage: 'The supplier is temporarily unavailable.' },
  unknown_external_result: { httpStatus: 202, retryable: false, publicMessage: 'The supplier result is still being verified.' },
};
export function createAppError(code: AppErrorCode, correlationId: string, internalDetail?: string): AppError {
  return { code, correlationId, ...defaults[code], ...(internalDetail === undefined ? {} : { internalDetail }) };
}
