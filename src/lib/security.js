import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb)
const PARAMS = { N: 16384, r: 8, p: 1 }
const KEY_LENGTH = 64
const MAXMEM = 64 * 1024 * 1024

/** Hash de senha com scrypt (salt aleatório). Formato: scrypt$N$r$p$salt$hash */
export async function hashPassword(password) {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, KEY_LENGTH, { ...PARAMS, maxmem: MAXMEM })
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(password, stored) {
  const parts = String(stored).split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, saltB64, keyB64] = parts
  const salt = Buffer.from(saltB64, 'base64')
  const expected = Buffer.from(keyB64, 'base64')
  const key = await scrypt(password, salt, expected.length, { N: +n, r: +r, p: +p, maxmem: MAXMEM })
  return key.length === expected.length && timingSafeEqual(key, expected)
}

let dummyHash
/** Hash falso usado para gastar o mesmo tempo quando o usuário não existe (evita enumeração por tempo). */
export async function verifyAgainstDummy(password) {
  dummyHash ??= await hashPassword(randomBytes(12).toString('hex'))
  await verifyPassword(password, dummyHash)
  return false
}

/** Token aleatório para cookie/recuperação (o banco guarda apenas o hash). */
export const newToken = () => randomBytes(32).toString('base64url')
export const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex')

const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', '11111111', '00000000', 'password', 'password1', 'senha123', 'senha1234',
  'qwertyui', 'qwerty123', 'abc12345', 'iloveyou', 'brasil123', 'mudar123', 'admin123', 'professor',
])

/** Retorna uma mensagem de erro (string) ou null se a senha for aceitável. */
export function passwordProblem(password, { email, name } = {}) {
  if (typeof password !== 'string') return 'A senha deve ser um texto.'
  if (password.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.'
  if (password.length > 128) return 'A senha pode ter no máximo 128 caracteres.'
  const lower = password.toLowerCase()
  if (COMMON_PASSWORDS.has(lower)) return 'Essa senha é muito comum. Escolha outra.'
  if (email && lower === String(email).toLowerCase()) return 'A senha não pode ser igual ao e-mail.'
  if (name && lower === String(name).toLowerCase()) return 'A senha não pode ser igual ao nome.'
  if (/^(.)\1+$/.test(password)) return 'A senha não pode repetir o mesmo caractere.'
  return null
}

export function serializeCookie(name, value, { maxAgeSeconds, secure = false, httpOnly = true, sameSite = 'Lax', path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`]
  if (maxAgeSeconds !== undefined) parts.push(`Max-Age=${maxAgeSeconds}`)
  if (httpOnly) parts.push('HttpOnly')
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function parseCookies(header = '') {
  const out = {}
  for (const piece of String(header).split(';')) {
    const i = piece.indexOf('=')
    if (i < 0) continue
    const key = piece.slice(0, i).trim()
    if (!key) continue
    try {
      out[key] = decodeURIComponent(piece.slice(i + 1).trim())
    } catch {
      /* cookie malformado: ignora */
    }
  }
  return out
}
