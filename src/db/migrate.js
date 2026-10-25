import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadConfig } from '../config.js'
import { openDatabase, transaction } from './connection.js'

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

/** Aplica, em ordem, as migrações .sql que ainda não foram executadas. Retorna os nomes aplicados. */
export function runMigrations(db, dir = MIGRATIONS_DIR) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name))
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  const applied = []
  for (const file of files) {
    if (done.has(file)) continue
    const sql = fs.readFileSync(path.join(dir, file), 'utf8')
    transaction(db, () => {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file)
    })
    applied.push(file)
  }
  return applied
}

// Execução direta: npm run migrate
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig()
  const db = openDatabase(config.databasePath)
  const applied = runMigrations(db)
  console.log(applied.length ? `Migrações aplicadas: ${applied.join(', ')}` : 'Banco já está atualizado.')
  db.close()
}
