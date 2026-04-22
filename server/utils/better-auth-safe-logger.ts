type BetterAuthLogLevel = 'debug' | 'info' | 'warn' | 'error'

interface BetterAuthLoggerOptions {
  disableColors?: boolean
  disabled?: boolean
  level?: BetterAuthLogLevel
  log?: (level: BetterAuthLogLevel, message: string, ...args: unknown[]) => void
}

interface BetterAuthLogSink {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

const workerConsole = globalThis.console

const DEFAULT_SINK: BetterAuthLogSink = {
  debug: (...args) => workerConsole.debug('[better-auth:debug]', ...args),
  info: (...args) => workerConsole.info('[better-auth:info]', ...args),
  warn: (...args) => workerConsole.warn('[better-auth:warn]', ...args),
  error: (...args) => workerConsole.error('[better-auth:error]', ...args),
}

function formatError(error: Error): string {
  const name = typeof error.name === 'string' && error.name.length > 0 ? error.name : 'Error'
  const message =
    typeof error.message === 'string' && error.message.length > 0 ? error.message : '(no message)'
  const firstStackLine =
    typeof error.stack === 'string' ? error.stack.split('\n')[0]?.trim() : undefined

  if (firstStackLine && firstStackLine !== `${name}: ${message}`) {
    return `${name}: ${message} (${firstStackLine})`
  }

  return `${name}: ${message}`
}

function createJsonReplacer() {
  const seen = new WeakSet<object>()

  return (_key: string, current: unknown) => {
    if (typeof current === 'bigint') return current.toString()
    if (typeof current === 'function') return `[Function ${current.name || 'anonymous'}]`
    if (typeof current === 'symbol') return current.toString()

    try {
      if (current instanceof Error) {
        return formatError(current)
      }
    } catch {
      return '[Unserializable error]'
    }

    if (current && typeof current === 'object') {
      if (seen.has(current)) return '[Circular]'
      seen.add(current)
    }

    return current
  }
}

export function serializeBetterAuthLogArg(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  if (typeof value === 'undefined') return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'symbol') return value.toString()
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`

  try {
    if (value instanceof Error) {
      return formatError(value)
    }
  } catch {
    return '[Unserializable error]'
  }

  try {
    const json = JSON.stringify(value, createJsonReplacer())
    if (typeof json === 'string') return json
  } catch {
    // Fall through to a coarse string tag when structural inspection explodes.
  }

  try {
    return Object.prototype.toString.call(value)
  } catch {
    return '[Unserializable value]'
  }
}

function getSinkMethod(
  sink: BetterAuthLogSink,
  level: BetterAuthLogLevel,
): (...args: unknown[]) => void {
  if (level === 'error') return sink.error
  if (level === 'warn') return sink.warn
  if (level === 'debug') return sink.debug
  return sink.info
}

function emitFallbackLog(
  level: BetterAuthLogLevel,
  message: string,
  renderedArgs: string[],
  sinkError: unknown,
): void {
  try {
    const payload = [
      `[better-auth logger fallback] ${message}`,
      ...renderedArgs,
      `(logger failure) ${serializeBetterAuthLogArg(sinkError)}`,
    ].join(' ')

    if (level === 'error' || level === 'warn') {
      workerConsole.error(payload)
      return
    }

    workerConsole.log(payload)
  } catch {
    // Intentionally swallow fallback logging failures: auth endpoints must not fail on logging.
  }
}

export function createBetterAuthSafeLogger(
  sink: BetterAuthLogSink = DEFAULT_SINK,
): BetterAuthLoggerOptions {
  return {
    disableColors: true,
    level: 'warn',
    log(level: BetterAuthLogLevel, message: string, ...args: unknown[]) {
      const renderedArgs = args.map(serializeBetterAuthLogArg)

      try {
        getSinkMethod(sink, level).call(sink, message, ...renderedArgs)
      } catch (error) {
        emitFallbackLog(level, message, renderedArgs, error)
      }
    },
  }
}
