import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { openDatabase } from './db/connection.js'
import { runMigrations } from './db/migrate.js'
import { AppError } from './lib/errors.js'
import { allowedOrigin, baseHeaders, clientIp, isOriginAllowed, readJsonBody, sendJson, UNSAFE_METHODS } from './lib/http.js'
import { createLogger } from './lib/logger.js'
import { createMailer } from './lib/mailer.js'
import { createRateLimiter } from './lib/rateLimit.js'
import { Router } from './lib/router.js'
import { parseCookies } from './lib/security.js'
import { registerAdminRoutes } from './modules/admin/routes.js'
import { createAuthService } from './modules/auth/service.js'
import { registerAuthRoutes } from './modules/auth/routes.js'
import { registerHealthRoutes } from './modules/health/routes.js'
import { openApiDocument } from './openapi.js'

/**
 * Monta a aplicação. Funciona como API Gateway do monólito modular:
 * CORS, limites, identificador de requisição, autenticação, roteamento e erros padronizados
 * passam todos por aqui antes de chegar aos módulos.
 */
export function createApp({ config, db: providedDb } = {}) {
  const logger = createLogger(config.logLevel)
  const db = providedDb ?? openDatabase(config.databasePath)
  runMigrations(db)

  const mailer = createMailer({ config, logger })
  const services = { auth: createAuthService({ db, config, mailer }) }
  const limiter = createRateLimiter({ windowMs: config.rateLimitWindowMs, max: config.rateLimitMax })
  const authLimiter = createRateLimiter({ windowMs: config.rateLimitWindowMs, max: config.authRateLimitMax })

  const router = new Router()
  registerHealthRoutes(router)
  registerAuthRoutes(router)
  registerAdminRoutes(router)
  router.get('/api/docs.json', () => ({ raw: openApiDocument }))

  const securityHeaders = baseHeaders(config)

  async function handle(req, res) {
    const started = process.hrtime.bigint()
    const incomingId = String(req.headers['x-request-id'] ?? '')
    const requestId = /^[\w-]{8,64}$/.test(incomingId) ? incomingId : randomUUID()
    const [pathname, queryString = ''] = (req.url ?? '/').split('?')
    const ctx = {
      req, res, config, db, logger, services, mailer, authLimiter,
      requestId,
      ip: clientIp(req, config),
      query: Object.fromEntries(new URLSearchParams(queryString)),
      body: {},
      params: {},
      auth: null,
      cookies: [],
    }
    let status = 500

    try {
      for (const [key, value] of Object.entries(securityHeaders)) res.setHeader(key, value)
      res.setHeader('X-Request-Id', requestId)

      const origin = allowedOrigin(req, config)
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Access-Control-Allow-Credentials', 'true')
        res.setHeader('Vary', 'Origin')
      }
      if (req.method === 'OPTIONS') {
        if (origin) {
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS')
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Request-Id')
          res.setHeader('Access-Control-Max-Age', '600')
        }
        status = 204
        sendJson(res, 204)
        return
      }

      const global = limiter.check(ctx.ip)
      if (!global.allowed) {
        throw new AppError(429, 'RATE_LIMITED', 'Muitas requisições. Aguarde um instante.', undefined, {
          'Retry-After': String(global.retryAfterSec),
        })
      }

      const { route, params, pathMatched } = router.match(req.method, pathname)
      if (!route) {
        throw pathMatched
          ? new AppError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido para este endereço.')
          : new AppError(404, 'NOT_FOUND', 'Endereço não encontrado.')
      }
      ctx.params = params

      if (UNSAFE_METHODS.has(req.method)) {
        if (!isOriginAllowed(req, config)) throw new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Origem não autorizada.')
        ctx.body = await readJsonBody(req, config.bodyLimitBytes)
      }

      ctx.auth = services.auth.authenticate(parseCookies(req.headers.cookie)[config.cookieName])

      const guards = route.handlers.slice(0, -1)
      const handler = route.handlers.at(-1)
      for (const guard of guards) await guard(ctx)
      const result = (await handler(ctx)) ?? {}

      status = result.status ?? 200
      if (ctx.cookies.length) res.setHeader('Set-Cookie', ctx.cookies)
      if (result.raw !== undefined) sendJson(res, status, result.raw)
      else if (status === 204) sendJson(res, 204)
      else sendJson(res, status, { data: result.data ?? null, ...(result.meta ? { meta: result.meta } : {}) })
    } catch (err) {
      const known = err instanceof AppError
      status = known ? err.status : 500
      if (!known) logger.error('Erro inesperado', { requestId, err })
      if (ctx.cookies.length) res.setHeader('Set-Cookie', ctx.cookies)
      sendJson(
        res,
        status,
        {
          error: {
            code: known ? err.code : 'INTERNAL_ERROR',
            message: known ? err.message : 'Ocorreu um erro inesperado. Tente novamente em instantes.',
            ...(known && err.details ? { details: err.details } : {}),
          },
          requestId,
        },
        known ? err.headers : undefined,
      )
    } finally {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6
      logger.info('request', {
        requestId,
        method: req.method,
        path: pathname,
        status,
        durationMs: Math.round(durationMs * 10) / 10,
        userId: ctx.auth?.user.id ?? null,
      })
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      logger.error('Falha ao responder', { err })
      if (!res.headersSent) res.statusCode = 500
      res.end()
    })
  })

  return {
    server,
    db,
    mailer,
    services,
    logger,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(config.port, config.host, () => resolve(server.address()))
      }),
    close: () =>
      new Promise((resolve) => {
        limiter.close()
        authLimiter.close()
        server.close(() => {
          if (!providedDb) db.close()
          resolve()
        })
        server.closeAllConnections?.()
      }),
  }
}
