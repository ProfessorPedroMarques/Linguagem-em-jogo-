import fs from 'node:fs'
import path from 'node:path'

let DatabaseSync
try {
  ;({ DatabaseSync } = await import('node:sqlite'))
} catch {
  throw new Error('Este projeto usa o SQLite embutido do Node.js, disponível a partir da versão 22.13. Atualize o Node (node -v) e tente novamente.')
}

/** Abre o banco SQLite com chaves estrangeiras ativas. Use ":memory:" nos testes. */
export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON;')
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;')
  return db
}

/** Executa `fn` dentro de uma transação (COMMIT se der certo, ROLLBACK se lançar erro). */
export function transaction(db, fn) {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
