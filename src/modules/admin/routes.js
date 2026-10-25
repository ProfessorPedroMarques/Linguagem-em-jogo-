import { rules, validate } from '../../lib/validate.js'
import { requireRole } from '../auth/routes.js'

export function registerAdminRoutes(router) {
  // Consulta da trilha de auditoria (somente administradores). Os registros não contêm senhas, tokens nem e-mails.
  router.get('/api/admin/audit-logs', requireRole('admin'), (ctx) => {
    const { page, pageSize } = validate(
      { page: rules.integer({ min: 1, max: 100000, fallback: 1 }), pageSize: rules.integer({ min: 1, max: 100, fallback: 20 }) },
      ctx.query,
    )
    const total = ctx.db.prepare('SELECT COUNT(*) AS total FROM audit_logs').get().total
    const rows = ctx.db
      .prepare(
        'SELECT id, actor_user_id, action, entity, entity_id, metadata, request_id, created_at FROM audit_logs ORDER BY id DESC LIMIT ? OFFSET ?',
      )
      .all(pageSize, (page - 1) * pageSize)
    return {
      data: rows.map((r) => ({
        id: r.id,
        actorUserId: r.actor_user_id,
        action: r.action,
        entity: r.entity,
        entityId: r.entity_id,
        metadata: r.metadata ? JSON.parse(r.metadata) : null,
        requestId: r.request_id,
        createdAt: r.created_at,
      })),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    }
  })
}
