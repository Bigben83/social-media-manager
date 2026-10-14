const pino = require('pino');

/**
 * Create a structured pino logger bound to a service name.
 * Pass the returned instance to Fastify as { loggerInstance: log } so that
 * app.log and the request-level child loggers all share the same config.
 *
 * Standard fields emitted on every line: service, level, time, msg
 * Callers should add: action, platform, outcome, err (and any extras).
 */
function createLogger(service) {
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    base: { service },
    redact: { paths: ['req.headers.authorization', 'req.headers.cookie', '*.accessToken', '*.refreshToken', '*.apiKey', '*.appSecret', '*.codeVerifier'], censor: '[REDACTED]' },
    serializers: { req(req) { return { method: req.method, url: (req.url || '').split('?')[0], remoteAddress: req.remoteAddress }; } },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) { return { level: label }; },
    },
  });
}

module.exports = { createLogger };
