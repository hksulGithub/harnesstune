import { createMiddleware } from 'hono/factory';

export const sanitizeMiddleware = createMiddleware(async (c, next) => {
  // Redact Authorization header before any downstream logging
  const authHeader = c.req.header('Authorization');
  if (authHeader) {
    // Replace console.log/warn/error to redact tokens in log output
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const redact = (fn: typeof console.log) => (...args: unknown[]) => {
      const redacted = args.map(a =>
        typeof a === 'string' ? a.replace(/Bearer\s+\S+/g, 'Bearer [REDACTED]') : a
      );
      fn(...redacted);
    };
    console.log = redact(originalLog);
    console.warn = redact(originalWarn);
    console.error = redact(originalError);
    try {
      await next();
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    }
  } else {
    await next();
  }
});
