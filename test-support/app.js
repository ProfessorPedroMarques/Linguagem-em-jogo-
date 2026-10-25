import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { hashPassword } from '../src/lib/security.js'
import { randomUUID } from 'node:crypto'

export const STRONG_PASSWORD = 'Girassol-2026!'

/** Sobe a API numa porta aleatória, com banco em memória, e devolve um cliente HTTP simples. */
export async function startTestApp(overrides = {}) {
  const config = loadConfig(
    {
      env: 'test',
      host: '127.0.0.1',
      port: 0,
      databasePath: ':memory:',
      logLevel: 'silent',
      cookieSecure: false,
      allowPublicRegistration: true,
      rateLimitMax: 100000,
      authRateLimitMax: 100000,
      ...overrides,
    },
    { readEnvFile: false },
  )
  const app = createApp({ config })
  const address = await app.listen()
  const base = `http://127.0.0.1:${address.port}`

  async function request(method, path, { body, cookie, headers = {}, raw } = {}) {
    const init = { method, headers: { ...headers } }
    if (cookie) init.headers.Cookie = cookie
    if (raw !== undefined) {
      init.body = raw
    } else if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    const res = await fetch(base + path, init)
    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      /* resposta sem JSON */
    }
    const setCookie = res.headers.getSetCookie?.() ?? []
    const session = setCookie.find((c) => c.startsWith(`${config.cookieName}=`))
    return {
      status: res.status,
      headers: res.headers,
      json,
      setCookie,
      /** "nome=valor" pronto para reenviar, ou null se a sessão foi limpa */
      cookie: session && !/Max-Age=0/i.test(session) ? session.split(';')[0] : null,
      rawCookie: session ?? null,
    }
  }

  return { app, config, request, db: app.db, outbox: app.mailer.outbox, close: () => app.close() }
}

export async function registerTeacher(t, overrides = {}) {
  const email = overrides.email ?? `prof-${randomUUID().slice(0, 8)}@exemplo.test`
  const res = await t.request('POST', '/api/auth/register', {
    body: { name: 'Professora Teste', email, password: STRONG_PASSWORD, role: 'teacher', ...overrides },
  })
  return { email, res, cookie: res.cookie }
}

/** Cria diretamente no banco (como o seed faria) um usuário com a função indicada. */
export async function insertUser(db, { email, role = 'admin', password = STRONG_PASSWORD, status = 'active', name = 'Usuário Teste' }) {
  const id = randomUUID()
  db.prepare('INSERT INTO users (id, email, password_hash, name, role, status) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    email,
    await hashPassword(password),
    name,
    role,
    status,
  )
  return { id, email, password }
}

export async function login(t, identifier, password = STRONG_PASSWORD) {
  return t.request('POST', '/api/auth/login', { body: { identifier, password } })
}
