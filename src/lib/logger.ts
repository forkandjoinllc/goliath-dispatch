/**
 * Structured logging with mandatory redaction.
 *
 * Any key that looks like a secret, credential or regulated identifier is
 * replaced before serialization — logs are treated as a lower-trust store than
 * the database.
 */

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

const REDACT_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /api[-_]?key/i,
  /\bein\b/i,
  /tax[-_]?id/i,
  /license[-_]?number/i,
  /ssn/i,
  /card[-_]?number/i,
  /account[-_]?number/i,
  /signature[-_]?data/i,
  /credentials/i,
]

const REDACTED = '[redacted]'

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]'
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack }
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACT_PATTERNS.some((p) => p.test(key)) ? REDACTED : redact(val, depth + 1)
    }
    return out
  }
  return value
}

function currentLevel(): Level {
  const raw = process.env.LOG_LEVEL as Level | undefined
  return raw && raw in LEVELS ? raw : 'info'
}

export interface LogContext {
  requestId?: string
  tenantId?: string
  actorUserId?: string
  effectiveUserId?: string
  route?: string
  jobType?: string
  [key: string]: unknown
}

function emit(level: Level, message: string, context?: LogContext) {
  if (LEVELS[level] < LEVELS[currentLevel()]) return
  const payload = {
    level,
    time: new Date().toISOString(),
    message,
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  }
  const line =
    process.env.LOG_FORMAT === 'json'
      ? JSON.stringify(payload)
      : `${payload.time} ${level.toUpperCase().padEnd(5)} ${message}${
          context ? ' ' + JSON.stringify(redact(context)) : ''
        }`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit('debug', message, context),
  info: (message: string, context?: LogContext) => emit('info', message, context),
  warn: (message: string, context?: LogContext) => emit('warn', message, context),
  error: (message: string, context?: LogContext) => emit('error', message, context),
  child(base: LogContext) {
    return {
      debug: (m: string, c?: LogContext) => emit('debug', m, { ...base, ...c }),
      info: (m: string, c?: LogContext) => emit('info', m, { ...base, ...c }),
      warn: (m: string, c?: LogContext) => emit('warn', m, { ...base, ...c }),
      error: (m: string, c?: LogContext) => emit('error', m, { ...base, ...c }),
    }
  },
}
