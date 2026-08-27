import { createAppError, type AppError, type AppErrorCode } from '@travel/contracts';

export class ApplicationError extends Error {
  readonly detail: AppError;
  readonly code: AppErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(code: AppErrorCode, internalDetail?: string) {
    const detail = createAppError(code, 'application', internalDetail);
    super(detail.publicMessage);
    this.name = 'ApplicationError';
    this.detail = detail;
    this.code = detail.code;
    this.httpStatus = detail.httpStatus;
    this.retryable = detail.retryable;
  }
}
