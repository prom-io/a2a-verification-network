import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { QueryFailedError, EntityNotFoundError, TypeORMError } from 'typeorm';

interface PgError extends Error {
  code?: string;
  detail?: string;
  constraint?: string;
  table?: string;
  column?: string;
}

const PG_ERROR_MAP: Record<string, { status: number; message: string }> = {
  '23505': { status: HttpStatus.CONFLICT, message: 'Duplicate value violates unique constraint' },
  '23503': { status: HttpStatus.BAD_REQUEST, message: 'Foreign key constraint violated' },
  '23502': { status: HttpStatus.BAD_REQUEST, message: 'Required field is missing' },
  '23514': { status: HttpStatus.BAD_REQUEST, message: 'Check constraint violated' },
  '22P02': { status: HttpStatus.BAD_REQUEST, message: 'Invalid input syntax' },
  '40001': { status: HttpStatus.CONFLICT, message: 'Serialization failure, please retry' },
  '40P01': { status: HttpStatus.CONFLICT, message: 'Deadlock detected, please retry' },
  '57014': { status: HttpStatus.REQUEST_TIMEOUT, message: 'Query cancelled due to timeout' },
};

@Catch(TypeORMError, QueryFailedError, EntityNotFoundError)
export class DatabaseErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(DatabaseErrorFilter.name);

  catch(exception: TypeORMError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof EntityNotFoundError) {
      return response.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Resource not found',
      });
    }

    if (exception instanceof QueryFailedError) {
      const pgErr = exception as unknown as PgError;
      const mapped = pgErr.code ? PG_ERROR_MAP[pgErr.code] : undefined;
      if (mapped) {
        this.logger.warn(`DB error ${pgErr.code}: ${mapped.message} [${pgErr.constraint ?? pgErr.detail ?? ''}]`);
        return response.status(mapped.status).json({
          statusCode: mapped.status,
          message: mapped.message,
          code: pgErr.code,
          constraint: pgErr.constraint,
        });
      }
      this.logger.error(`Unmapped DB error: ${pgErr.code} ${pgErr.message}`);
    } else {
      this.logger.error(`TypeORM error: ${exception.message}`);
    }

    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Database error',
    });
  }
}
