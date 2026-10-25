import { configWarnings, loadConfig } from './config.js'
import { createApp } from './app.js'

const config = loadConfig()
const app = createApp({ config })

for (const warning of configWarnings(config)) app.logger.warn(warning)

const address = await app.listen()
app.logger.info('Servidor iniciado', { url: `http://${address.address}:${address.port}`, env: config.env })

app.services.auth.pruneExpired()
const pruneTimer = setInterval(() => app.services.auth.pruneExpired(), 60 * 60 * 1000)
pruneTimer.unref()

async function shutdown(signal) {
  app.logger.info('Encerrando servidor', { signal })
  clearInterval(pruneTimer)
  await app.close()
  process.exit(0)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
