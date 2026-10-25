import { randomBytes, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { loadConfig } from '../config.js'
import { hashPassword } from '../lib/security.js'
import { openDatabase } from './connection.js'
import { runMigrations } from './migrate.js'

const randomPassword = () => randomBytes(9).toString('base64url')

async function ensureUser(db, { email, name, role, password, isDemo }) {
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return { created: false }
  const finalPassword = password || randomPassword()
  db.prepare('INSERT INTO users (id, email, password_hash, name, role, is_demo) VALUES (?, ?, ?, ?, ?, ?)').run(
    randomUUID(),
    email,
    await hashPassword(finalPassword),
    name,
    role,
    isDemo ? 1 : 0,
  )
  return { created: true, password: password ? '(a que você definiu em ADMIN_PASSWORD)' : finalPassword }
}

/**
 * Cria o administrador e, fora de produção, um professor de demonstração.
 * As senhas são geradas na hora e mostradas UMA vez; nunca ficam gravadas no repositório.
 */
export async function seed(db, config, env = process.env) {
  const results = []
  const adminEmail = (env.ADMIN_EMAIL || 'admin@linguagem.local').toLowerCase()
  results.push({
    label: 'Administrador',
    email: adminEmail,
    ...(await ensureUser(db, { email: adminEmail, name: 'Administração', role: 'admin', password: env.ADMIN_PASSWORD, isDemo: false })),
  })
  if (!config.production) {
    results.push({
      label: 'Professor de demonstração',
      email: 'professor.demo@linguagem.local',
      ...(await ensureUser(db, { email: 'professor.demo@linguagem.local', name: 'Professor Demonstração', role: 'teacher', isDemo: true })),
    })
  }
  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig()
  const db = openDatabase(config.databasePath)
  runMigrations(db)
  const results = await seed(db, config)
  for (const r of results) {
    if (r.created) console.log(`${r.label}: ${r.email}  senha: ${r.password}  (anote agora, não será mostrada de novo)`)
    else console.log(`${r.label}: ${r.email} já existe (nada foi alterado).`)
  }
  db.close()
}
