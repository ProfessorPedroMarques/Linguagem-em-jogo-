-- Migração 001: usuários, sessões, segurança e auditoria.
-- Datas usam o formato do SQLite (UTC): YYYY-MM-DD HH:MM:SS.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT COLLATE NOCASE UNIQUE,
  login_code TEXT COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'guardian', 'student')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  email_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (email IS NOT NULL OR login_code IS NOT NULL)
);
CREATE INDEX idx_users_role ON users (role);

-- O identificador da sessão é o SHA-256 do token que vai no cookie.
-- Assim, um vazamento do banco não revela tokens utilizáveis.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

-- Apenas tentativas FALHAS, com o identificador em hash (sem e-mail em texto).
CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_login_attempts_lookup ON login_attempts (identifier_hash, created_at);

CREATE TABLE password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX idx_password_resets_user ON password_resets (user_id);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  metadata TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_created ON audit_logs (created_at);
CREATE INDEX idx_audit_action ON audit_logs (action);
