import { Router, type Request, type Response } from 'express';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

type AnyHandler = (...args: any[]) => unknown;

function wrapHandler(handler: unknown): unknown {
  // Leave non-functions and 4-arg error handlers untouched.
  if (typeof handler !== 'function' || handler.length === 4) return handler;
  return (req: Request, res: Response, next: (err?: unknown) => void) => {
    try {
      const result = (handler as AnyHandler)(req, res, next);
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        (result as Promise<unknown>).catch(next);
      }
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Express 4 does not forward rejected promises from async handlers to the error
 * middleware, so a thrown DB error would leave the request hanging. This router
 * wraps every handler so those errors reach the central error handler instead.
 */
export function createRouter(): Router {
  const router = Router();
  for (const method of METHODS) {
    const original = (router[method] as AnyHandler).bind(router);
    (router as any)[method] = (path: unknown, ...handlers: unknown[]) =>
      original(path, ...handlers.map(wrapHandler));
  }
  return router;
}
