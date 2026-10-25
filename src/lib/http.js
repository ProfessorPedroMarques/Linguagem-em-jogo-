import { AppError } from './errors.js'

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH'])
export const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function baseHeaders(config) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Cache-Control': 'no-store',
  }
  if (config.production) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
  return headers
}

/** IP do cliente. Só confia em X-Forwarded-For se TRUST_PROXY=true. */
export function clientIp(req, config) {
  if (config.trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
    if (forwarded) return forwarded
  }
  return req.socket.remoteAddress ?? 'desconhecido'
}

export function allowedOrigin(req, config) {
  const origin = req.headers.origin
  if (!origin) return null
  return config.corsOrigins.includes(origin) ? origin : null
}

/** Origem permitida = lista do CORS ou a própria origem do servidor (mesma origem). */
export function isOriginAllowed(req, config) {
  const origin = req.headers.origin
  if (!origin) return true
  if (config.corsOrigins.includes(origin)) return true
  const host = req.headers.host
  return Boolean(host) && (origin === `http://${host}` || origin === `https://${host}`)
}

export async function readJsonBody(req, limit) {
  if (!METHODS_WITH_BODY.has(req.method)) return {}

  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) {
    throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'O conteúdo enviado é grande demais.', undefined, { Connection: 'close' })
  }

  const chunks = []
  let size = 0
  let tooLarge = false
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) {
      tooLarge = true
      continue // descarta o excesso, mas termina de ler a requisição
    }
    chunks.push(chunk)
  }
  if (tooLarge) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'O conteúdo enviado é grande demais.', undefined, { Connection: 'close' })
  if (size === 0) return {}

  const type = String(req.headers['content-type'] ?? '').toLowerCase()
  if (!type.startsWith('application/json')) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Envie o conteúdo como application/json.')
  }
  let parsed
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new AppError(400, 'INVALID_JSON', 'O JSON enviado é inválido.')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AppError(400, 'INVALID_JSON', 'Envie um objeto JSON.')
  }
  return parsed
}

export function sendJson(res, status, payload, headers = {}) {
  const body = payload === undefined ? '' : JSON.stringify(payload)
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value)
  if (status === 204) {
    res.statusCode = 204
    res.end()
    return
  }
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(body))
  res.end(body)
}
