import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { requestContext } from './request-context';

export const REQUEST_ID_HEADER = 'x-request-id';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // An id supplied by the caller is reused so a trace spans the agent layer,
    // the payment rail and this service instead of restarting at each hop.
    const incoming = req.headers[REQUEST_ID_HEADER];
    const requestId =
      (Array.isArray(incoming) ? incoming[0] : incoming)?.trim() || randomUUID();

    req.headers[REQUEST_ID_HEADER] = requestId;
    (req as Request & { requestId: string }).requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    requestContext.run({ requestId }, () => next());
  }
}
