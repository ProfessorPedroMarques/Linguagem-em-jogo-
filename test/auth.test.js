import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { insertUser, login, registerTeacher, startTestApp, STRONG_PASSWORD } from '../test-support/app.js'

describe('saúde, cabeçalhos e erros padronizados', () => {
  let t
  before(async () => { t = await startTestApp() })
  after(() => t.close())

  test('GET /api/health responde ok e verifica o banco', async () => {
    const res = await t.request('GET', '/api/health')
    assert.equal(res.status, 200)
    assert.equal(res.json.data.status, 'ok')
    assert.equal(res.json.data.database, 'ok')
  })

  test('respostas trazem cabeçalhos de segurança e X-Request-Id', async () => {
    const res = await t.request('GET', '/api/health')
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(res.headers.get('x-frame-options'), 'DENY')
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.match(res.headers.get('x-request-id'), /^[\w-]{8,64}$/)
  })

  test('X-Request-Id válido enviado pelo cliente é mantido', async () => {
    const res = await t.request('GET', '/api/health', { headers: { 'X-Request-Id': 'abc-12345678' } })
    assert.equal(res.headers.get('x-request-id'), 'abc-12345678')
  })

  test('rota inexistente devolve 404 padronizado', async () => {
    const res = await t.request('GET', '/api/nao-existe')
    assert.equal(res.status, 404)
    assert.equal(res.json.error.code, 'NOT_FOUND')
    assert.ok(res.json.requestId)
  })

  test('método errado devolve 405', async () => {
    const res = await t.request('GET', '/api/auth/login')
    assert.equal(res.status, 405)
    assert.equal(res.json.error.code, 'METHOD_NOT_ALLOWED')
  })

  test('JSON inválido devolve 400', async () => {
    const res = await t.request('POST', '/api/auth/login', { raw: '{oops', headers: { 'Content-Type': 'application/json' } })
    assert.equal(res.status, 400)
    assert.equal(res.json.error.code, 'INVALID_JSON')
  })

  test('corpo que não é JSON devolve 415', async () => {
    const res = await t.request('POST', '/api/auth/login', { raw: 'a=1', headers: { 'Content-Type': 'text/plain' } })
    assert.equal(res.status, 415)
  })

  test('corpo acima do limite devolve 413', async () => {
    const big = JSON.stringify({ identifier: 'x'.repeat(200_000), password: 'y' })
    const res = await t.request('POST', '/api/auth/login', { raw: big, headers: { 'Content-Type': 'application/json' } })
    assert.equal(res.status, 413)
    assert.equal(res.json.error.code, 'PAYLOAD_TOO_LARGE')
  })

  test('documentação OpenAPI é servida', async () => {
    const res = await t.request('GET', '/api/docs.json')
    assert.equal(res.status, 200)
    assert.equal(res.json.openapi, '3.0.3')
    assert.ok(res.json.paths['/api/auth/login'])
  })

  test('migrações são idempotentes', async () => {
    const { runMigrations } = await import('../src/db/migrate.js')
    assert.deepEqual(runMigrations(t.db), [])
  })
})

describe('CORS e origem', () => {
  let t
  before(async () => { t = await startTestApp() })
  after(() => t.close())

  test('preflight de origem autorizada recebe cabeçalhos CORS com credenciais', async () => {
    const res = await t.request('OPTIONS', '/api/auth/login', { headers: { Origin: 'http://localhost:5173' } })
    assert.equal(res.status, 204)
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173')
    assert.equal(res.headers.get('access-control-allow-credentials'), 'true')
  })

  test('origem não autorizada não recebe cabeçalhos CORS', async () => {
    const res = await t.request('OPTIONS', '/api/auth/login', { headers: { Origin: 'http://site-malicioso.test' } })
    assert.equal(res.headers.get('access-control-allow-origin'), null)
  })

  test('POST com Origin não autorizada é bloqueado (proteção CSRF)', async () => {
    const res = await t.request('POST', '/api/auth/login', {
      body: { identifier: 'a@b.co', password: 'x' },
      headers: { Origin: 'http://site-malicioso.test' },
    })
    assert.equal(res.status, 403)
    assert.equal(res.json.error.code, 'ORIGIN_NOT_ALLOWED')
  })

  test('POST sem Origin (cliente não-navegador) é aceito', async () => {
    const res = await t.request('POST', '/api/auth/login', { body: { identifier: 'a@b.co', password: 'x' } })
    assert.equal(res.status, 401)
  })
})

describe('cadastro', () => {
  let t
  before(async () => { t = await startTestApp() })
  after(() => t.close())

  test('cria professor, abre sessão com cookie HttpOnly e não devolve a senha', async () => {
    const { res, email } = await registerTeacher(t)
    assert.equal(res.status, 201)
    assert.equal(res.json.data.user.role, 'teacher')
    assert.equal(res.json.data.user.email, email)
    assert.ok(!JSON.stringify(res.json).includes(STRONG_PASSWORD))
    assert.match(res.rawCookie, /HttpOnly/i)
    assert.match(res.rawCookie, /SameSite=Lax/i)
  })

  test('senha é guardada como hash scrypt e o token da sessão como SHA-256', async () => {
    const { email, cookie } = await registerTeacher(t)
    const row = t.db.prepare('SELECT password_hash FROM users WHERE email = ?').get(email)
    assert.match(row.password_hash, /^scrypt\$/)
    assert.ok(!row.password_hash.includes(STRONG_PASSWORD))
    const token = decodeURIComponent(cookie.split('=')[1])
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE id = ?').get(token).n, 0)
  })

  test('e-mail repetido (qualquer caixa) devolve 409', async () => {
    const { email } = await registerTeacher(t, { email: 'duplicado@exemplo.test' })
    const res = await t.request('POST', '/api/auth/register', {
      body: { name: 'Outra Pessoa', email: email.toUpperCase(), password: STRONG_PASSWORD, role: 'teacher' },
    })
    assert.equal(res.status, 409)
    assert.equal(res.json.error.code, 'EMAIL_IN_USE')
  })

  test('valida campos e aponta cada erro', async () => {
    const res = await t.request('POST', '/api/auth/register', {
      body: { name: 'A', email: 'sem-arroba', password: '123', role: 'teacher' },
    })
    assert.equal(res.status, 422)
    const fields = res.json.error.details.map((d) => d.field).sort()
    assert.deepEqual(fields, ['email', 'name', 'password'])
  })

  test('não permite se cadastrar como administrador nem como estudante', async () => {
    for (const role of ['admin', 'student']) {
      const res = await t.request('POST', '/api/auth/register', {
        body: { name: 'Intruso Teste', email: `${role}@exemplo.test`, password: STRONG_PASSWORD, role },
      })
      assert.equal(res.status, 422, role)
    }
  })

  test('rejeita senhas comuns', async () => {
    const res = await t.request('POST', '/api/auth/register', {
      body: { name: 'Pessoa Teste', email: 'comum@exemplo.test', password: 'senha123', role: 'teacher' },
    })
    assert.equal(res.status, 422)
  })

  test('cadastro público desativado devolve 403', async () => {
    const closed = await startTestApp({ allowPublicRegistration: false })
    try {
      const res = await closed.request('POST', '/api/auth/register', {
        body: { name: 'Pessoa Teste', email: 'x@exemplo.test', password: STRONG_PASSWORD, role: 'teacher' },
      })
      assert.equal(res.status, 403)
      assert.equal(res.json.error.code, 'REGISTRATION_CLOSED')
    } finally {
      await closed.close()
    }
  })
})

describe('login, sessão e logout', () => {
  let t, email
  before(async () => {
    t = await startTestApp({ loginMaxAttempts: 5 })
    ;({ email } = await registerTeacher(t))
  })
  after(() => t.close())

  test('login correto devolve usuário e cookie', async () => {
    const res = await login(t, email)
    assert.equal(res.status, 200)
    assert.equal(res.json.data.user.email, email)
    assert.ok(res.cookie)
  })

  test('login aceita o e-mail em outra caixa', async () => {
    const res = await login(t, email.toUpperCase())
    assert.equal(res.status, 200)
  })

  test('senha errada e e-mail inexistente dão a MESMA resposta (sem revelar contas)', async () => {
    const wrong = await login(t, email, 'Senha-Errada-9')
    const unknown = await login(t, 'ninguem@exemplo.test', 'Senha-Errada-9')
    assert.equal(wrong.status, 401)
    assert.equal(unknown.status, 401)
    assert.deepEqual(wrong.json.error, unknown.json.error)
  })

  test('/me exige sessão e devolve o usuário com sessão válida', async () => {
    const anon = await t.request('GET', '/api/auth/me')
    assert.equal(anon.status, 401)
    const { cookie } = await login(t, email)
    const me = await t.request('GET', '/api/auth/me', { cookie })
    assert.equal(me.status, 200)
    assert.equal(me.json.data.user.email, email)
    assert.equal(me.json.data.user.passwordHash, undefined)
  })

  test('logout revoga a sessão: o mesmo cookie deixa de funcionar', async () => {
    const { cookie } = await login(t, email)
    const out = await t.request('POST', '/api/auth/logout', { cookie })
    assert.equal(out.status, 204)
    const me = await t.request('GET', '/api/auth/me', { cookie })
    assert.equal(me.status, 401)
  })

  test('cookie falso ou adulterado é ignorado', async () => {
    const me = await t.request('GET', '/api/auth/me', { cookie: 'lj_session=invalido' })
    assert.equal(me.status, 401)
  })

  test('sessão expirada deixa de valer', async () => {
    const { cookie } = await login(t, email)
    t.db.prepare("UPDATE sessions SET expires_at = datetime('now', '-1 minute')").run()
    const me = await t.request('GET', '/api/auth/me', { cookie })
    assert.equal(me.status, 401)
  })

  test('sessão ociosa por muito tempo deixa de valer', async () => {
    const { cookie } = await login(t, email)
    t.db.prepare("UPDATE sessions SET last_seen_at = datetime('now', '-1 day')").run()
    const me = await t.request('GET', '/api/auth/me', { cookie })
    assert.equal(me.status, 401)
  })

  test('usuário desativado perde a sessão e não consegue entrar', async () => {
    const { cookie } = await login(t, email)
    t.db.prepare("UPDATE users SET status = 'disabled' WHERE email = ?").run(email)
    assert.equal((await t.request('GET', '/api/auth/me', { cookie })).status, 401)
    assert.equal((await login(t, email)).status, 401)
    t.db.prepare("UPDATE users SET status = 'active' WHERE email = ?").run(email)
  })
})

describe('bloqueio por tentativas e limite de requisições', () => {
  test('após 5 falhas a conta fica bloqueada, mesmo com a senha certa', async () => {
    const t = await startTestApp({ loginMaxAttempts: 5 })
    try {
      const { email } = await registerTeacher(t)
      for (let i = 0; i < 5; i += 1) assert.equal((await login(t, email, 'Errada-123x')).status, 401)
      const blocked = await login(t, email, STRONG_PASSWORD)
      assert.equal(blocked.status, 429)
      assert.equal(blocked.json.error.code, 'ACCOUNT_LOCKED')
      assert.ok(blocked.headers.get('retry-after'))
      assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM login_attempts').get().n, 5)
      const stored = t.db.prepare('SELECT identifier_hash FROM login_attempts').get().identifier_hash
      assert.ok(!stored.includes('@'), 'o e-mail não deve ser gravado em texto')
    } finally {
      await t.close()
    }
  })

  test('o bloqueio termina depois da janela', async () => {
    const t = await startTestApp({ loginMaxAttempts: 3, loginLockMinutes: 15 })
    try {
      const { email } = await registerTeacher(t)
      for (let i = 0; i < 3; i += 1) await login(t, email, 'Errada-123x')
      assert.equal((await login(t, email)).status, 429)
      t.db.prepare("UPDATE login_attempts SET created_at = datetime('now', '-16 minutes')").run()
      assert.equal((await login(t, email)).status, 200)
    } finally {
      await t.close()
    }
  })

  test('login com sucesso zera as falhas anteriores', async () => {
    const t = await startTestApp({ loginMaxAttempts: 5 })
    try {
      const { email } = await registerTeacher(t)
      for (let i = 0; i < 3; i += 1) await login(t, email, 'Errada-123x')
      assert.equal((await login(t, email)).status, 200)
      assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM login_attempts').get().n, 0)
    } finally {
      await t.close()
    }
  })

  test('limite por IP nas rotas de autenticação devolve 429 com Retry-After', async () => {
    const t = await startTestApp({ authRateLimitMax: 3, loginMaxAttempts: 100 })
    try {
      const statuses = []
      for (let i = 0; i < 5; i += 1) statuses.push((await login(t, 'x@exemplo.test', 'qualquer')).status)
      assert.deepEqual(statuses, [401, 401, 401, 429, 429])
      const limited = await login(t, 'x@exemplo.test', 'qualquer')
      assert.equal(limited.json.error.code, 'RATE_LIMITED')
      assert.ok(limited.headers.get('retry-after'))
    } finally {
      await t.close()
    }
  })

  test('limite global por IP também funciona', async () => {
    const t = await startTestApp({ rateLimitMax: 4 })
    try {
      const statuses = []
      for (let i = 0; i < 6; i += 1) statuses.push((await t.request('GET', '/api/health')).status)
      assert.deepEqual(statuses, [200, 200, 200, 200, 429, 429])
    } finally {
      await t.close()
    }
  })
})

describe('alteração de senha', () => {
  let t, email
  before(async () => {
    t = await startTestApp()
    ;({ email } = await registerTeacher(t))
  })
  after(() => t.close())

  test('exige sessão', async () => {
    const res = await t.request('POST', '/api/auth/change-password', { body: { currentPassword: STRONG_PASSWORD, newPassword: 'Outra-Senha-77' } })
    assert.equal(res.status, 401)
  })

  test('senha atual errada é recusada', async () => {
    const { cookie } = await login(t, email)
    const res = await t.request('POST', '/api/auth/change-password', { cookie, body: { currentPassword: 'Errada-123x', newPassword: 'Outra-Senha-77' } })
    assert.equal(res.status, 401)
  })

  test('nova senha fraca ou igual à atual é recusada', async () => {
    const { cookie } = await login(t, email)
    const weak = await t.request('POST', '/api/auth/change-password', { cookie, body: { currentPassword: STRONG_PASSWORD, newPassword: '123' } })
    assert.equal(weak.status, 422)
    const same = await t.request('POST', '/api/auth/change-password', { cookie, body: { currentPassword: STRONG_PASSWORD, newPassword: STRONG_PASSWORD } })
    assert.equal(same.status, 422)
  })

  test('troca a senha, mantém a sessão atual e encerra as outras', async () => {
    const a = await login(t, email)
    const b = await login(t, email)
    const res = await t.request('POST', '/api/auth/change-password', { cookie: a.cookie, body: { currentPassword: STRONG_PASSWORD, newPassword: 'Outra-Senha-77' } })
    assert.equal(res.status, 200)
    assert.equal((await t.request('GET', '/api/auth/me', { cookie: a.cookie })).status, 200)
    assert.equal((await t.request('GET', '/api/auth/me', { cookie: b.cookie })).status, 401)
    assert.equal((await login(t, email, STRONG_PASSWORD)).status, 401)
    assert.equal((await login(t, email, 'Outra-Senha-77')).status, 200)
  })
})

describe('recuperação de senha', () => {
  let t, email
  before(async () => {
    t = await startTestApp()
    ;({ email } = await registerTeacher(t))
  })
  after(() => t.close())

  const tokenFromMail = (mail) => /token=([\w-]+)/.exec(mail.text)[1]

  test('e-mail desconhecido e conhecido recebem a mesma resposta; só o conhecido gera e-mail', async () => {
    const known = await t.request('POST', '/api/auth/forgot-password', { body: { email } })
    const unknown = await t.request('POST', '/api/auth/forgot-password', { body: { email: 'ninguem@exemplo.test' } })
    assert.equal(known.status, 202)
    assert.equal(unknown.status, 202)
    assert.deepEqual(known.json, unknown.json)
    assert.equal(t.outbox.filter((m) => m.to === email).length, 1)
    assert.equal(t.outbox.filter((m) => m.to === 'ninguem@exemplo.test').length, 0)
  })

  test('o token nunca aparece na resposta da API nem fica em texto no banco', async () => {
    t.outbox.length = 0
    const res = await t.request('POST', '/api/auth/forgot-password', { body: { email } })
    const token = tokenFromMail(t.outbox[0])
    assert.ok(!JSON.stringify(res.json).includes(token))
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM password_resets WHERE id = ?').get(token).n, 0)
  })

  test('token funciona uma única vez, troca a senha e derruba as sessões', async () => {
    const { cookie } = await login(t, email)
    t.outbox.length = 0
    await t.request('POST', '/api/auth/forgot-password', { body: { email } })
    const token = tokenFromMail(t.outbox[0])

    const ok = await t.request('POST', '/api/auth/reset-password', { body: { token, password: 'Nova-Senha-2026' } })
    assert.equal(ok.status, 200)
    assert.equal((await t.request('GET', '/api/auth/me', { cookie })).status, 401)
    assert.equal((await login(t, email, 'Nova-Senha-2026')).status, 200)

    const again = await t.request('POST', '/api/auth/reset-password', { body: { token, password: 'Outra-Senha-2027' } })
    assert.equal(again.status, 400)
    assert.equal(again.json.error.code, 'INVALID_RESET_TOKEN')
  })

  test('um novo pedido invalida o link anterior', async () => {
    t.outbox.length = 0
    await t.request('POST', '/api/auth/forgot-password', { body: { email } })
    await t.request('POST', '/api/auth/forgot-password', { body: { email } })
    const [first, second] = t.outbox.map(tokenFromMail)
    assert.equal((await t.request('POST', '/api/auth/reset-password', { body: { token: first, password: 'Senha-Do-Primeiro-1' } })).status, 400)
    assert.equal((await t.request('POST', '/api/auth/reset-password', { body: { token: second, password: 'Senha-Do-Segundo-1' } })).status, 200)
  })

  test('token expirado é recusado', async () => {
    t.outbox.length = 0
    await t.request('POST', '/api/auth/forgot-password', { body: { email } })
    const token = tokenFromMail(t.outbox[0])
    t.db.prepare("UPDATE password_resets SET expires_at = datetime('now', '-1 minute')").run()
    const res = await t.request('POST', '/api/auth/reset-password', { body: { token, password: 'Mais-Uma-Senha-1' } })
    assert.equal(res.status, 400)
  })

  test('token inventado e senha fraca são recusados', async () => {
    assert.equal((await t.request('POST', '/api/auth/reset-password', { body: { token: 'x'.repeat(43), password: 'Senha-Forte-123' } })).status, 400)
    assert.equal((await t.request('POST', '/api/auth/reset-password', { body: { token: 'x'.repeat(43), password: '123' } })).status, 422)
  })

  test('redefinir a senha também desbloqueia a conta', async () => {
    const u = await startTestApp({ loginMaxAttempts: 3 })
    try {
      const { email: mail } = await registerTeacher(u)
      for (let i = 0; i < 3; i += 1) await login(u, mail, 'Errada-123x')
      assert.equal((await login(u, mail)).status, 429)
      await u.request('POST', '/api/auth/forgot-password', { body: { email: mail } })
      const token = tokenFromMail(u.outbox.at(-1))
      await u.request('POST', '/api/auth/reset-password', { body: { token, password: 'Senha-Nova-2026' } })
      assert.equal((await login(u, mail, 'Senha-Nova-2026')).status, 200)
    } finally {
      await u.close()
    }
  })
})

describe('permissões por função e auditoria', () => {
  let t, admin, teacherCookie
  before(async () => {
    t = await startTestApp()
    admin = await insertUser(t.db, { email: 'admin@exemplo.test', role: 'admin' })
    ;({ cookie: teacherCookie } = await registerTeacher(t))
  })
  after(() => t.close())

  test('rota de administrador: anônimo 401, professor 403, administrador 200', async () => {
    assert.equal((await t.request('GET', '/api/admin/audit-logs')).status, 401)
    assert.equal((await t.request('GET', '/api/admin/audit-logs', { cookie: teacherCookie })).status, 403)
    const { cookie } = await login(t, admin.email)
    const res = await t.request('GET', '/api/admin/audit-logs', { cookie })
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.json.data))
    assert.ok(res.json.meta.total >= 1)
  })

  test('auditoria registra cadastro, login e logout sem senhas, tokens ou e-mails', async () => {
    const { cookie } = await login(t, admin.email)
    await t.request('POST', '/api/auth/logout', { cookie })
    const { cookie: adminCookie } = await login(t, admin.email)
    const res = await t.request('GET', '/api/admin/audit-logs?pageSize=100', { cookie: adminCookie })
    const actions = res.json.data.map((r) => r.action)
    for (const expected of ['auth.register', 'auth.login', 'auth.logout']) assert.ok(actions.includes(expected), expected)
    const dump = JSON.stringify(res.json)
    assert.ok(!dump.includes(STRONG_PASSWORD))
    assert.ok(!dump.includes('@exemplo.test'))
    assert.ok(!/scrypt\$/.test(dump))
  })

  test('paginação valida os parâmetros', async () => {
    const { cookie } = await login(t, admin.email)
    assert.equal((await t.request('GET', '/api/admin/audit-logs?page=0', { cookie })).status, 422)
    assert.equal((await t.request('GET', '/api/admin/audit-logs?pageSize=1000', { cookie })).status, 422)
    const one = await t.request('GET', '/api/admin/audit-logs?pageSize=1', { cookie })
    assert.equal(one.json.data.length, 1)
  })
})

describe('seed', () => {
  test('cria administrador e professor de demonstração, marcados e sem senha fixa; é idempotente', async () => {
    const { seed } = await import('../src/db/seed.js')
    const { loadConfig } = await import('../src/config.js')
    const { openDatabase } = await import('../src/db/connection.js')
    const { runMigrations } = await import('../src/db/migrate.js')
    const db = openDatabase(':memory:')
    runMigrations(db)
    const config = loadConfig({ env: 'test' }, { readEnvFile: false })
    const first = await seed(db, config, { ADMIN_EMAIL: 'adm@exemplo.test' })
    assert.equal(first.length, 2)
    assert.ok(first.every((r) => r.created && r.password.length >= 10))
    assert.notEqual(first[0].password, first[1].password)
    assert.equal(db.prepare("SELECT is_demo FROM users WHERE email = 'professor.demo@linguagem.local'").get().is_demo, 1)
    assert.equal(db.prepare("SELECT is_demo FROM users WHERE email = 'adm@exemplo.test'").get().is_demo, 0)
    const second = await seed(db, config, { ADMIN_EMAIL: 'adm@exemplo.test' })
    assert.ok(second.every((r) => !r.created))
    db.close()
  })

  test('em produção não cria usuário de demonstração', async () => {
    const { seed } = await import('../src/db/seed.js')
    const { loadConfig } = await import('../src/config.js')
    const { openDatabase } = await import('../src/db/connection.js')
    const { runMigrations } = await import('../src/db/migrate.js')
    const db = openDatabase(':memory:')
    runMigrations(db)
    const results = await seed(db, loadConfig({ env: 'production' }, { readEnvFile: false }), {})
    assert.equal(results.length, 1)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_demo = 1').get().n, 0)
    db.close()
  })
})
