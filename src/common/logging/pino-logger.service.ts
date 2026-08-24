import { Injectable, LoggerService, LogLevel } from '@nestjs/common';
import pino, { Logger as PinoLogger } from 'pino';
import { requestContext } from './request-context';

const LEVELS: Record<string, string> = {
  log: 'info',
  error: 'error',
  warn: 'warn',
  debug: 'debug',
  verbose: 'trace',
  fatal: 'fatal',
};

function buildLogger(): PinoLogger {
  const isProduction = process.env.NODE_ENV === 'production';

  return pino({
    level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
    // Pretty output is development-only: it costs a transport process and
    // makes the output unparseable by the log pipeline.
    transport: isProduction
      ? undefined
      : { target: 'pino-pretty', options: { singleLine: true, colorize: true } },
    base: {
      service: 'verification-network',
      env: process.env.NODE_ENV ?? 'development',
    },
    redact: {
      // These reach the logger through error objects and request dumps. A
      // private key in a log line is a compromised key.
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'privateKey',
        'PRIVATE_KEY',
        '*.privateKey',
        'password',
        '*.password',
      ],
      censor: '[redacted]',
    },
  });
}

/**
 * Nest logger backed by pino, emitting one JSON object per line.
 *
 * Every line carries the current request id, pulled from async local storage
 * rather than passed in, so log lines written after the response has been sent
 * — verdict publication continues in the background — still join back to the
 * request that caused them.
 */
@Injectable()
export class PinoLoggerService implements LoggerService {
  private readonly logger = buildLogger();

  log(message: unknown, context?: string) {
    this.write('log', message, context);
  }

  error(message: unknown, stack?: string, context?: string) {
    this.write('error', message, context, stack ? { stack } : undefined);
  }

  warn(message: unknown, context?: string) {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string) {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string) {
    this.write('verbose', message, context);
  }

  fatal(message: unknown, context?: string) {
    this.write('fatal', message, context);
  }

  setLogLevels?(_levels: LogLevel[]): void {
    // Level is controlled by LOG_LEVEL so it can be changed without a deploy.
  }

  private write(
    level: keyof typeof LEVELS,
    message: unknown,
    context?: string,
    extra?: Record<string, unknown>,
  ): void {
    const payload: Record<string, unknown> = {
      context,
      requestId: requestContext.requestId(),
      ...extra,
    };

    // Services already log JSON strings; keep them as objects rather than
    // nesting escaped JSON inside a message field.
    if (typeof message === 'string') {
      const parsed = this.tryParse(message);
      if (parsed) {
        this.logger[LEVELS[level] as 'info']({ ...payload, ...parsed });
        return;
      }
      this.logger[LEVELS[level] as 'info'](payload, message);
      return;
    }

    this.logger[LEVELS[level] as 'info']({ ...payload, ...(message as object) });
  }

  private tryParse(message: string): Record<string, unknown> | null {
    if (!message.startsWith('{')) return null;
    try {
      const parsed = JSON.parse(message);
      return typeof parsed === 'object' && parsed !== null ? parsed : null;
    } catch {
      return null;
    }
  }
}
