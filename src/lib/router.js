import { AppError } from './errors.js'

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Roteador mínimo. Cada rota tem uma lista de "guards" (funções que podem lançar erro)
 * e um handler final que devolve { status?, data?, meta? }.
 */
export class Router {
  constructor() {
    this.routes = []
  }

  add(method, path, ...handlers) {
    const keys = []
    const source = escapeRegex(path).replace(/:([A-Za-z]+)/g, (_, key) => {
      keys.push(key)
      return '([^/]+)'
    })
    this.routes.push({ method, path, keys, pattern: new RegExp(`^${source}/?$`), handlers })
    return this
  }

  get(path, ...h) { return this.add('GET', path, ...h) }
  post(path, ...h) { return this.add('POST', path, ...h) }
  patch(path, ...h) { return this.add('PATCH', path, ...h) }
  put(path, ...h) { return this.add('PUT', path, ...h) }
  delete(path, ...h) { return this.add('DELETE', path, ...h) }

  match(method, pathname) {
    let pathMatched = false
    for (const route of this.routes) {
      const m = route.pattern.exec(pathname)
      if (!m) continue
      pathMatched = true
      if (route.method !== method) continue
      const params = {}
      route.keys.forEach((key, i) => {
        try {
          params[key] = decodeURIComponent(m[i + 1])
        } catch {
          throw new AppError(400, 'BAD_REQUEST', 'Endereço inválido.')
        }
      })
      return { route, params, pathMatched }
    }
    return { route: null, params: {}, pathMatched }
  }
}
