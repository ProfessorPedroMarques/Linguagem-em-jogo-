const SENSITIVE = /pass|senha|token|secret|hash|cookie|email/i

function clean(metadata) {
  if (!metadata || typeof metadata !== 'object') return null
  const out = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE.test(key)) continue
    out[key] = typeof value === 'string' ? value.slice(0, 200) : value
  }
  return Object.keys(out).length ? JSON.stringify(out) : null
}

/** Registra uma operação relevante. Nunca grava senhas, tokens ou e-mails. */
export function writeAudit(db, { actorId = null, action, entity = null, entityId = null, metadata = null, requestId = null }) {
  db.prepare(
    'INSERT INTO audit_logs (actor_user_id, action, entity, entity_id, metadata, request_id) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(actorId, action, entity, entityId, clean(metadata), requestId)
}
