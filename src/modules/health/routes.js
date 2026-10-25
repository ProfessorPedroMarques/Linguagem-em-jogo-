import { AppError } from '../../lib/errors.js'

export function registerHealthRoutes(router) {
  router.get('/api/health', (ctx) => {
    try {
      ctx.db.prepare('SELECT 1').get()
    } catch {
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Banco de dados indisponível.')
    }
    return { data: { status: 'ok', database: 'ok', time: new Date().toISOString() } }
  })
}
