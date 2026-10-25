import { AppError } from '../../lib/errors.js'
import { rules, validate } from '../../lib/validate.js'
import { serializeCookie } from '../../lib/security.js'

/** Guard: exige usuário autenticado. */
export function requireAuth(ctx) {
  if (!ctx.auth) throw new AppError(401, 'UNAUTHENTICATED', 'É preciso entrar para continuar.')
}

/** Guard: exige uma das funções informadas. */
export const requireRole = (...roles) => (ctx) => {
  requireAuth(ctx)
  if (!roles.includes(ctx.auth.user.role)) throw new AppError(403, 'FORBIDDEN', 'Você não tem permissão para esta ação.')
}

/** Guard: limita tentativas por IP nas rotas sensíveis de autenticação. */
export function authRateLimit(ctx) {
  const result = ctx.authLimiter.check(ctx.ip)
  if (!result.allowed) {
    throw new AppError(429, 'RATE_LIMITED', 'Muitas tentativas. Aguarde um instante e tente novamente.', undefined, {
      'Retry-After': String(result.retryAfterSec),
    })
  }
}

function setSessionCookie(ctx, session) {
  ctx.cookies.push(
    serializeCookie(ctx.config.cookieName, session.token, {
      maxAgeSeconds: session.maxAgeSeconds,
      secure: ctx.config.cookieSecure,
    }),
  )
}

function clearSessionCookie(ctx) {
  ctx.cookies.push(serializeCookie(ctx.config.cookieName, '', { maxAgeSeconds: 0, secure: ctx.config.cookieSecure }))
}

export function registerAuthRoutes(router) {
  router.post('/api/auth/register', authRateLimit, async (ctx) => {
    const input = validate(
      {
        name: rules.string({ min: 2, max: 100 }),
        email: rules.email(),
        password: rules.newPassword((i) => ({ email: i.email, name: i.name })),
        role: rules.oneOf(['teacher', 'guardian']),
      },
      ctx.body,
    )
    const { user, session } = await ctx.services.auth.register(input, ctx)
    setSessionCookie(ctx, session)
    return { status: 201, data: { user } }
  })

  router.post('/api/auth/login', authRateLimit, async (ctx) => {
    const input = validate(
      { identifier: rules.string({ min: 3, max: 254 }), password: rules.anyPassword() },
      ctx.body,
    )
    const { user, session } = await ctx.services.auth.login(input, ctx)
    setSessionCookie(ctx, session)
    return { data: { user } }
  })

  router.post('/api/auth/logout', (ctx) => {
    if (ctx.auth) ctx.services.auth.logout(ctx.auth.sessionId, ctx.auth.user.id, ctx.requestId)
    clearSessionCookie(ctx)
    return { status: 204 }
  })

  router.get('/api/auth/me', requireAuth, (ctx) => ({ data: { user: ctx.auth.user } }))

  router.post('/api/auth/change-password', requireAuth, async (ctx) => {
    const input = validate(
      {
        currentPassword: rules.anyPassword(),
        newPassword: rules.newPassword(() => ({ email: ctx.auth.user.email, name: ctx.auth.user.name })),
      },
      ctx.body,
    )
    await ctx.services.auth.changePassword({
      userId: ctx.auth.user.id,
      sessionId: ctx.auth.sessionId,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      requestId: ctx.requestId,
    })
    return { data: { message: 'Senha alterada. Outras sessões foram encerradas.' } }
  })

  router.post('/api/auth/forgot-password', authRateLimit, async (ctx) => {
    const input = validate({ email: rules.email() }, ctx.body)
    await ctx.services.auth.forgotPassword(input, ctx)
    return {
      status: 202,
      data: { message: 'Se o e-mail estiver cadastrado, enviaremos as instruções para criar uma nova senha.' },
    }
  })

  router.post('/api/auth/reset-password', authRateLimit, async (ctx) => {
    const input = validate(
      { token: rules.string({ min: 20, max: 200, trim: true }), password: rules.newPassword() },
      ctx.body,
    )
    await ctx.services.auth.resetPassword(input, ctx)
    return { data: { message: 'Senha redefinida. Entre com a nova senha.' } }
  })
}
