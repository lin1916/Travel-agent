import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { ApplicationError } from '@travel/application';
import { toPublicError } from '@travel/contracts';

interface ErrorReply {
  status(statusCode: number): { send(body: unknown): void };
}

@Catch(ApplicationError)
export class ApplicationErrorFilter implements ExceptionFilter {
  catch(exception: ApplicationError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ErrorReply>();
    const publicError = toPublicError(exception.detail);
    response
      .status(publicError.httpStatus || HttpStatus.INTERNAL_SERVER_ERROR)
      .send(publicError);
  }
}
