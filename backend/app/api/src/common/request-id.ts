import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

type RequestWithId = Request & { requestId?: string };

/**
 * Correlation id for every request: reuses a well-formed inbound X-Request-Id
 * (NGINX can set one) or mints a UUID, and echoes it on the response so a
 * support report can be matched to server logs, audit rows, and ledger entries.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.headers[REQUEST_ID_HEADER];
  const id = typeof inbound === 'string' && VALID_REQUEST_ID.test(inbound) ? inbound : randomUUID();
  (req as RequestWithId).requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export function getRequestId(req: Request | undefined): string | null {
  return (req as RequestWithId | undefined)?.requestId ?? null;
}
