import Fastify, { type FastifyInstance } from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { loadConfig, onConfigChange, getConfig } from './config/manager.js'
import { registerMessagesRoute } from './routes/messages.js'
import { registerOpenAiRoutes } from './routes/openai.js'
import { registerAdminRoutes } from './routes/admin.js'
import { startMaintenanceTimers } from './tasks/maintenance.js'

const DEFAULT_PORT = 3456
const DEFAULT_HOST = '127.0.0.1'

let cachedConfig = loadConfig()
onConfigChange((config) => {
  cachedConfig = config
})

function resolveWebDist(): string | null {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)

  const candidates = [
    process.env.CC_GW_UI_ROOT,
    path.resolve(__dirname, '../web/public'),
    path.resolve(__dirname, '../web/dist'),
    path.resolve(__dirname, '../../web/dist'),
    path.resolve(__dirname, '../../../src/web/dist'),
    path.resolve(process.cwd(), 'src/web/dist')
  ].filter((item): item is string => Boolean(item))

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

export async function createServer(): Promise<FastifyInstance> {
  const config = cachedConfig ?? loadConfig()
  const requestLogEnabled = config.requestLogging !== false
  const responseLogEnabled = config.responseLogging !== false

  const app = Fastify({
    logger: {
      level: config.logLevel ?? 'info'
    },
    disableRequestLogging: true
  })

  if (requestLogEnabled) {
    app.addHook('onRequest', (request, _reply, done) => {
      const socket = request.socket
      const hostname =
        typeof request.hostname === 'string' && request.hostname.length > 0
          ? request.hostname
          : typeof request.headers.host === 'string'
          ? request.headers.host
          : undefined
      app.log.info(
        {
          reqId: request.id,
          req: {
            method: request.method,
            url: request.url,
            hostname,
            remoteAddress: request.ip,
            remotePort: socket && typeof socket.remotePort === 'number' ? socket.remotePort : undefined
          }
        },
        'incoming request'
      )
      done()
    })
  }

  if (responseLogEnabled) {
    app.addHook('onResponse', (request, reply, done) => {
      let elapsedTime: number | undefined
      if (typeof (reply as any).elapsedTime === 'number') {
        elapsedTime = (reply as any).elapsedTime
      } else if (typeof reply.getResponseTime === 'function') {
        elapsedTime = reply.getResponseTime()
      }
      app.log.info(
        {
          reqId: request.id,
          res: {
            statusCode: reply.statusCode
          },
          responseTime: elapsedTime
        },
        'request completed'
      )
      done()
    })
  }

  await app.register(fastifyCors, {
    origin: true,
    credentials: true
  })

  const webRoot = resolveWebDist()
  if (webRoot) {
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: '/ui/'
    })

    app.get('/', async (_, reply) => reply.redirect('/ui/'))
    app.get('/ui', async (_, reply) => reply.redirect('/ui/'))

    const assetHandler = async (request: any, reply: any) => {
      const params = request.params as { '*': string }
      const target = params['*'] ?? ''
      if (target.includes('..')) {
        reply.code(400)
        return { error: 'Invalid asset path' }
      }
      return reply.sendFile(path.join('assets', target))
    }

    app.get('/assets/*', assetHandler)
    app.head('/assets/*', assetHandler)

    const faviconHandler = async (_: any, reply: any) => reply.sendFile('favicon.ico')
    app.get('/favicon.ico', faviconHandler)
    app.head('/favicon.ico', faviconHandler)

    app.setNotFoundHandler((request, reply) => {
      const url = request.raw.url ?? ''
      if (url.startsWith('/ui/')) {
        reply.type('text/html')
        return reply.sendFile('index.html')
      }
      reply.code(404).send({ error: 'Not Found' })
    })
  } else {
    app.log.warn('未找到 Web UI 构建产物，/ui 目录将不可用。')
  }

  await registerMessagesRoute(app)
  await registerOpenAiRoutes(app)
  await registerAdminRoutes(app)
  startMaintenanceTimers()

  app.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: Date.now(),
      providerCount: getConfig().providers.length
    }
  })

  return app
}

export interface StartOptions {
  port?: number
  host?: string
}

export async function startServer(options: StartOptions = {}): Promise<FastifyInstance> {
  const app = await createServer()
  const envPort = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : undefined
  const envHost = process.env.HOST
  const configPort = cachedConfig?.port
  const configHost = cachedConfig?.host
  const port = options.port ?? envPort ?? configPort ?? DEFAULT_PORT
  const host = options.host ?? envHost ?? configHost ?? DEFAULT_HOST

  await app.listen({ port, host })
  return app
}

async function main() {
  try {
    const app = await startServer()

    const shutdown = async () => {
      try {
        await app.close()
        process.exit(0)
      } catch (err) {
        app.log.error({ err }, '关闭服务失败')
        process.exit(1)
      }
    }

    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)
  } catch (err) {
    console.error('启动服务失败', err)
    process.exit(1)
  }
}

const __filename = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
}
