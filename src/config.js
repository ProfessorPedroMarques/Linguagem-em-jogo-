import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function loadEnvFile(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (!m) continue
    let value = m[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[m[1]] = value
  }
  return out
}

const toBool = (v, fallback) => (v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'sim'].includes(String(v).toLowerCase()))
const toInt = (v, fallback, { min = -Infinity, max = Infinity } = {}) => {
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

/**
 * Lê a configuração de variáveis de ambiente (e do arquivo .env, se existir).
 * `overrides` tem prioridade e é usado principalmente pelos testes.
 */
export function loadConfig(overrides = {}, { readEnvFile = true } = {}) {
  const fileEnv = readEnvFile ? loadEnvFile(path.join(ROOT_DIR, '.env')) : {}
  const env = { ...fileEnv, ...process.env }
  const nodeEnv = overrides.env ?? env.NODE_ENV ?? 'development'
  const production = nodeEnv === 'production'

  const config = {
    env: nodeEnv,
    production,
    host: env.HOST ?? '127.0.0.1',
    port: toInt(env.PORT, 3001, { min: 0, max: 65535 }),
    databasePath: env.DATABASE_PATH ? path.resolve(ROOT_DIR, env.DATABASE_PATH) : path.join(ROOT_DIR, 'data', 'linguagem.db'),
    appUrl: env.APP_URL ?? 'http://localhost:5173',
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
    cookieName: env.COOKIE_NAME ?? 'lj_session',
    cookieSecure: toBool(env.COOKIE_SECURE, production),
    sessionTtlHours: toInt(env.SESSION_TTL_HOURS, 8, { min: 1, max: 24 * 30 }),
    sessionIdleMinutes: toInt(env.SESSION_IDLE_MINUTES, 120, { min: 5, max: 24 * 60 }),
    allowPublicRegistration: toBool(env.ALLOW_PUBLIC_REGISTRATION, !production),
    loginMaxAttempts: toInt(env.LOGIN_MAX_ATTEMPTS, 5, { min: 1, max: 100 }),
    loginLockMinutes: toInt(env.LOGIN_LOCK_MINUTES, 15, { min: 1, max: 24 * 60 }),
    rateLimitWindowMs: 60_000,
    rateLimitMax: toInt(env.RATE_LIMIT_MAX, 300, { min: 1 }),
    authRateLimitMax: toInt(env.AUTH_RATE_LIMIT_MAX, 20, { min: 1 }),
    bodyLimitBytes: 100_000,
    passwordResetTtlMinutes: 30,
    trustProxy: toBool(env.TRUST_PROXY, false),
    logLevel: env.LOG_LEVEL ?? (nodeEnv === 'test' ? 'silent' : 'info'),
  }
  return { ...config, ...overrides }
}

/** Retorna avisos de configuração insegura (não impede a execução). */
export function configWarnings(config) {
  const warnings = []
  if (config.production && !config.cookieSecure) warnings.push('COOKIE_SECURE=false em produção: use HTTPS e defina COOKIE_SECURE=true.')
  if (config.corsOrigins.includes('*')) warnings.push('CORS_ORIGINS contém "*": liste apenas as origens do front-end.')
  if (config.production && config.allowPublicRegistration) warnings.push('Cadastro público está habilitado em produção.')
  return warnings
}
