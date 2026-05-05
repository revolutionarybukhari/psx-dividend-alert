// Tiny structured logger. Pino if available, otherwise console.
// Keeping the dep optional means npm install works on minimal images.
//
// Default level is `info` for normal runs, but `silent` when running under
// `node --test`. Pino's log lines were confusing Node 20's TAP-over-pipe
// test runner ("Unable to deserialize cloned data" on the parent side)
// because chunks of JSON log output were being read as malformed TAP
// frames. Silencing in tests sidesteps that and also keeps test output
// clean — set LOG_LEVEL explicitly if you need logs during a test run.

let pino;
try {
  ({ default: pino } = await import('pino'));
} catch {
  pino = null;
}

const inTest = !!process.env.NODE_TEST_CONTEXT;
const level = process.env.LOG_LEVEL ?? (inTest ? 'silent' : 'info');
const silent = level === 'silent';
const noop = () => {};

export const logger = pino
  ? pino({
      level,
      transport:
        process.stdout.isTTY && process.env.NODE_ENV !== 'production'
          ? {
              target: 'pino-pretty',
              options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
            }
          : undefined,
    })
  : {
      level,
      debug: silent ? noop : (...a) => console.debug(...a),
      info: silent ? noop : (...a) => console.log(...a),
      warn: silent ? noop : (...a) => console.warn(...a),
      error: silent ? noop : (...a) => console.error(...a),
      fatal: silent ? noop : (...a) => console.error(...a),
      child() {
        return logger;
      },
    };
