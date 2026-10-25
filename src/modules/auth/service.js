import { randomUUID } from 'node:crypto'
import { transaction } from '../../db/connection.js'
import { AppError } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { hashPassword, newToken, sha256, verifyAgainstDummy, verifyPassword } from '../../lib/security.js'

const GENERIC_LOGIN_ERROR = 'E-mail ou senha incorretos.'

export function toPublicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email ?? null,
    loginCode: row.login_code ?? null,
    role: row.role,
    isDemo: Boolean(row.is_demo),
    createdAt: row.created_at,
  }
}

/** Regras de negócio de autenticação. Não conhece HTTP. */
export function createAuthService({ db, config, mailer }) {
  const revokeAll = (userId, exceptSessionId = null) =>
    db
      .prepare(
        "UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL AND (? IS NULL OR id <> ?)",
      )
      .run(userId, exceptSessionId, exceptSessionId)

  function createSession(userId, userAgent) {
    const token = newToken()
    db.prepare("INSERT INTO sessions (id, user_id, expires_at, user_agent) VALUES (?, ?, datetime('now', ?), ?)").run(
      sha256(token),
      userId,
      `+${config.sessionTtlHours} hours`,
      String(userAgent ?? '').slice(0, 200) || null,
    )
    return { token, maxAgeSeconds: config.sessionTtlHours * 3600 }
  }

  function isLocked(identifierHash) {
    const row = db
      .prepare("SELECT COUNT(*) AS total FROM login_attempts WHERE identifier_hash = ? AND created_at > datetime('now', ?)")
      .get(identifierHash, `-${config.loginLockMinutes} minutes`)
    return row.total >= config.loginMaxAttempts
  }

  return {
    async register({ name, email, password, role }, { userAgent, requestId }) {
      if (!config.allowPublicRegistration) {
        throw new AppError(403, 'REGISTRATION_CLOSED', 'O cadastro público está desativado. Peça acesso à administração.')
      }
      const passwordHash = await hashPassword(password)
      const id = randomUUID()
      try {
        db.prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)').run(
          id,
          email,
          passwordHash,
          name,
          role,
        )
      } catch (err) {
        if (/UNIQUE/i.test(String(err.message))) {
          throw new AppError(409, 'EMAIL_IN_USE', 'Já existe uma conta com este e-mail.')
        }
        throw err
      }
      writeAudit(db, { actorId: id, action: 'auth.register', entity: 'user', entityId: id, metadata: { role }, requestId })
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
      return { user: toPublicUser(user), session: createSession(id, userAgent) }
    },

    async login({ identifier, password }, { userAgent, requestId }) {
      const normalized = identifier.trim().toLowerCase()
      const identifierHash = sha256(normalized)

      if (isLocked(identifierHash)) {
        throw new AppError(
          429,
          'ACCOUNT_LOCKED',
          'Muitas tentativas de entrada. Aguarde alguns minutos e tente novamente.',
          undefined,
          { 'Retry-After': String(config.loginLockMinutes * 60) },
        )
      }

      const column = normalized.includes('@') ? 'email' : 'login_code'
      const user = db.prepare(`SELECT * FROM users WHERE ${column} = ?`).get(normalized)
      const valid = user ? await verifyPassword(password, user.password_hash) : await verifyAgainstDummy(password)

      if (!user || !valid || user.status !== 'active') {
        db.prepare('INSERT INTO login_attempts (identifier_hash) VALUES (?)').run(identifierHash)
        throw new AppError(401, 'INVALID_CREDENTIALS', GENERIC_LOGIN_ERROR)
      }

      db.prepare('DELETE FROM login_attempts WHERE identifier_hash = ?').run(identifierHash)
      writeAudit(db, { actorId: user.id, action: 'auth.login', entity: 'user', entityId: user.id, requestId })
      return { user: toPublicUser(user), session: createSession(user.id, userAgent) }
    },

    logout(sessionId, actorId, requestId) {
      db.prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL").run(sessionId)
      writeAudit(db, { actorId, action: 'auth.logout', entity: 'user', entityId: actorId, requestId })
    },

    async changePassword({ userId, sessionId, currentPassword, newPassword, requestId }) {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
      if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'A senha atual está incorreta.')
      }
      if (currentPassword === newPassword) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Verifique os campos informados.', [
          { field: 'newPassword', message: 'A nova senha deve ser diferente da atual.' },
        ])
      }
      const hash = await hashPassword(newPassword)
      transaction(db, () => {
        db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hash, userId)
        revokeAll(userId, sessionId)
      })
      writeAudit(db, { actorId: userId, action: 'auth.password_changed', entity: 'user', entityId: userId, requestId })
    },

    /** Sempre "funciona" para quem chama, exista o e-mail ou não (não revela contas). */
    async forgotPassword({ email }, { requestId }) {
      const user = db.prepare("SELECT * FROM users WHERE email = ? AND status = 'active'").get(email)
      if (!user) return
      const token = newToken()
      transaction(db, () => {
        db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").run(user.id)
        db.prepare("INSERT INTO password_resets (id, user_id, expires_at) VALUES (?, ?, datetime('now', ?))").run(
          sha256(token),
          user.id,
          `+${config.passwordResetTtlMinutes} minutes`,
        )
      })
      writeAudit(db, { actorId: user.id, action: 'auth.password_reset_requested', entity: 'user', entityId: user.id, requestId })
      const link = `${config.appUrl}/redefinir-senha?token=${token}`
      await mailer.send({
        to: user.email,
        subject: 'Linguagem em Jogo: redefinição de senha',
        text: `Olá, ${user.name}.\n\nPara criar uma nova senha, acesse o link abaixo (válido por ${config.passwordResetTtlMinutes} minutos):\n${link}\n\nSe você não pediu esta alteração, ignore esta mensagem.`,
      })
    },

    async resetPassword({ token, password }, { requestId }) {
      const row = db
        .prepare("SELECT * FROM password_resets WHERE id = ? AND used_at IS NULL AND expires_at > datetime('now')")
        .get(sha256(token))
      if (!row) throw new AppError(400, 'INVALID_RESET_TOKEN', 'Este link de redefinição é inválido ou expirou. Peça um novo.')
      const hash = await hashPassword(password)
      transaction(db, () => {
        db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hash, row.user_id)
        db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE id = ?").run(row.id)
        revokeAll(row.user_id)
      })
      const user = db.prepare('SELECT email FROM users WHERE id = ?').get(row.user_id)
      if (user?.email) db.prepare('DELETE FROM login_attempts WHERE identifier_hash = ?').run(sha256(user.email.toLowerCase()))
      writeAudit(db, { actorId: row.user_id, action: 'auth.password_reset_completed', entity: 'user', entityId: row.user_id, requestId })
    },

    /** Resolve o usuário de um token de cookie. Retorna null se inválido, expirado ou revogado. */
    authenticate(token) {
      if (!token) return null
      const id = sha256(token)
      const row = db
        .prepare(
          `SELECT s.id AS session_id, u.*
             FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > datetime('now')
              AND s.last_seen_at > datetime('now', ?) AND u.status = 'active'`,
        )
        .get(id, `-${config.sessionIdleMinutes} minutes`)
      if (!row) return null
      db.prepare("UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ? AND last_seen_at < datetime('now', '-1 minute')").run(id)
      return { sessionId: row.session_id, user: toPublicUser(row) }
    },

    /** Limpeza periódica de dados vencidos. */
    pruneExpired() {
      db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now', '-1 day') OR revoked_at < datetime('now', '-1 day')").run()
      db.prepare("DELETE FROM password_resets WHERE expires_at < datetime('now', '-1 day')").run()
      db.prepare("DELETE FROM login_attempts WHERE created_at < datetime('now', '-1 day')").run()
    },
  }
}
