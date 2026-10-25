const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 }
const SENSITIVE = /pass|senha|token|secret|authorization|cookie|hash/i

function redact(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE.test(k) ? '[omitido]' : redact(v, depth + 1)
  }
  return out
}

/** Logger estruturado (uma linha JSON por evento) que omite campos sensíveis. */
export function createLogger(level = 'info', sink = (line) => process.stdout.write(line + '\n')) {
  const min = LEVELS[level] ?? LEVELS.info
  const log = (name, msg, fields) => {
    if (LEVELS[name] < min) return
    const entry = { time: new Date().toISOString(), level: name, msg, ...redact(fields) }
    if (fields?.err instanceof Error) {
      entry.err = { name: fields.err.name, message: fields.err.message, stack: fields.err.stack }
    }
    sink(JSON.stringify(entry))
  }
  return {
    debug: (m, f) => log('debug', m, f),
    info: (m, f) => log('info', m, f),
    warn: (m, f) => log('warn', m, f),
    error: (m, f) => log('error', m, f),
  }
}
