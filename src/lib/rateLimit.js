/** Limitador de requisições por janela fixa, em memória (suficiente para uma instância única). */
export function createRateLimiter({ windowMs, max }) {
  const hits = new Map()
  const cleaner = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key)
  }, Math.max(windowMs, 1000))
  cleaner.unref?.()

  return {
    check(key) {
      const now = Date.now()
      let entry = hits.get(key)
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs }
        hits.set(key, entry)
      }
      entry.count += 1
      return {
        allowed: entry.count <= max,
        retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
      }
    },
    close() {
      clearInterval(cleaner)
    },
  }
}
