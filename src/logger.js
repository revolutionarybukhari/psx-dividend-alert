// Tiny structured logger. Pino if available, otherwise console.
// Keeping the dep optional means npm install works on minimal images.

let pino;
try {
  ({ default: pino } = await import('pino'));
} catch {
  pino = null;
}

export const logger = pino
  ? pino({
      level: process.env.LOG_LEVEL ?? 'info',
      transport:
        process.stdout.isTTY && process.env.NODE_ENV !== 'production'
          ? {
              target: 'pino-pretty',
              options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
            }
          : undefined,
    })
  : {
      level: process.env.LOG_LEVEL ?? 'info',
      debug: (...a) => console.debug(...a),
      info: (...a) => console.log(...a),
      warn: (...a) => console.warn(...a),
      error: (...a) => console.error(...a),
      fatal: (...a) => console.error(...a),
      child: () => logger,
    };
