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
import { registerEventsRoutes } from './routes/events.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerCustomEndpoint, getRegisteredEndpointIds, getRegisteredPaths } from './routes/custom-endpoint.js'
import { startMaintenanceTimers } from './tasks/maintenance.js'
import { readSession } from './security/webAuth.js'
import type { GatewayConfig, CustomEndpointConfig, EndpointProtocol } from './config/types.js'

const DEFAULT_PORT = 4100
const DEFAULT_HOST = '127.0.0.1'

/**
 * 根据协议类型生成需要注册的路径列表
 */
function getPathsForProtocol(basePath: string, protocol: EndpointProtocol): string[] {
  switch (protocol) {
    case 'anthropic':
      return [
        `${basePath}/v1/messages`,
        `${basePath}/v1/v1/messages`
      ]
    case 'openai-auto':
      return [
        `${basePath}/v1/chat/completions`,
        `${basePath}/v1/responses`
      ]
    case 'openai-chat':
      return [
        `${basePath}/v1/chat/completions`
      ]
    case 'openai-responses':
      return [
        `${basePath}/v1/responses`
      ]
    default:
      return [basePath]
  }
}

/**
 * 获取endpoint的所有路径（支持新旧两种格式）
 * 返回编码后的路径，与 Fastify 路由注册保持一致
 */
function getEndpointPaths(endpoint: CustomEndpointConfig): string[] {
  const paths: string[] = []

  // 新格式：使用 paths 数组
  if (endpoint.paths && Array.isArray(endpoint.paths) && endpoint.paths.length > 0) {
    for (const p of endpoint.paths) {
      const basePath = p.path.startsWith('/') ? p.path : `/${p.path}`
      // 根据协议生成实际路径
      const actualPaths = getPathsForProtocol(basePath, p.protocol)
      // URL 编码
      paths.push(...actualPaths.map(path =>
        path.split('/').map(segment => encodeURIComponent(segment)).join('/')
      ))
    }
  }
  // 旧格式：使用 path
  else if (endpoint.path) {
    const basePath = endpoint.path.startsWith('/') ? endpoint.path : `/${endpoint.path}`
    const protocol = endpoint.protocol || 'anthropic'
    // 根据协议生成实际路径
    const actualPaths = getPathsForProtocol(basePath, protocol)
    // URL 编码
    paths.push(...actualPaths.map(path =>
      path.split('/').map(segment => encodeURIComponent(segment)).join('/')
    ))
  }

  return paths
}

let cachedConfig = loadConfig()
let appInstance: FastifyInstance | null = null

onConfigChange((config) => {
  cachedConfig = config

  // 动态注册/更新自定义端点
  if (appInstance) {
    syncCustomEndpoints(appInstance, config).catch((error) => {
      appInstance?.log.error({ error }, 'Failed to sync custom endpoints after config change')
    })
  }
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

/**
 * 同步自定义端点配置
 *
 * 工作原理：
 * - Handler内部实时读取配置，因此修改routing/enabled立即生效
 * - 检测path变化时，为新path注册路由（旧path继续存在但返回404）
 * - 新增endpoint时立即注册
 * - 删除endpoint时旧路由继续存在但返回404，需重启清理
 */
async function syncCustomEndpoints(app: FastifyInstance, config: GatewayConfig): Promise<void> {
  const configuredEndpoints = config.customEndpoints ?? []
  const registeredIds = new Set(getRegisteredEndpointIds())

  for (const endpoint of configuredEndpoints) {
    // 跳过禁用的
    if (endpoint.enabled === false) {
      continue
    }

    const endpointId = endpoint.id
    const newPaths = getEndpointPaths(endpoint)

    // 新增的endpoint
    if (!registeredIds.has(endpointId)) {
      try {
        await registerCustomEndpoint(app, endpoint)
        app.log.info(`Dynamically registered new custom endpoint: ${endpointId} at ${newPaths.join(', ')}`)
      } catch (error) {
        app.log.error(
          { error, endpointId },
          `Failed to register custom endpoint: ${endpointId}`
        )
      }
      continue
    }

    // 已存在的endpoint，检查path是否有变化
    const registeredPaths = getRegisteredPaths(endpointId)
    const hasNewPaths = newPaths.some(path => !registeredPaths.includes(path))

    if (hasNewPaths) {
      // Path变化了，为新path注册路由
      try {
        await registerCustomEndpoint(app, endpoint)
        app.log.info(
          `Detected path change for endpoint "${endpointId}". ` +
            `New paths: ${newPaths.join(', ')}. ` +
            `Old paths [${registeredPaths.join(', ')}] will return 404 but remain until restart.`
        )
      } catch (error) {
        app.log.error(
          { error, endpointId, newPaths },
          `Failed to register new paths for endpoint: ${endpointId}`
        )
      }
    }
    // 如果path没变，跳过（handler会实时读取最新配置，无需重新注册）
  }

  // 检测已删除的endpoint（提示用户重启以清理路由）
  const configuredIds = new Set(configuredEndpoints.map((ep) => ep.id))
  const deletedIds = Array.from(registeredIds).filter((id) => !configuredIds.has(id))

  if (deletedIds.length > 0) {
    app.log.warn(
      `Custom endpoints [${deletedIds.join(', ')}] have been deleted from config. ` +
        `Their routes will return 404 but remain registered until server restart.`
    )
  }
}


export async function createServer(protocol: 'http' | 'https' = 'http'): Promise<FastifyInstance> {
  const config = cachedConfig ?? loadConfig()
  const requestLogEnabled = config.requestLogging !== false
  const responseLogEnabled = config.responseLogging !== false
  const bodyLimit = typeof config.bodyLimit === 'number' && Number.isFinite(config.bodyLimit) && config.bodyLimit > 0
    ? config.bodyLimit
    : 10 * 1024 * 1024

  // HTTPS 配置
  let httpsOptions: { key: Buffer; cert: Buffer; ca?: Buffer } | undefined
  if (protocol === 'https' && config.https?.enabled) {
    const { keyPath, certPath, caPath } = config.https

    // 验证证书文件存在
    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
      throw new Error(`HTTPS 证书文件不存在: ${keyPath}, ${certPath}`)
    }

    httpsOptions = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
      ca: caPath ? fs.readFileSync(caPath) : undefined
    }
  }

  const app = Fastify({
    logger: {
      level: config.logLevel ?? 'info'
    },
    disableRequestLogging: true,
    bodyLimit,
    https: httpsOptions
  })

  app.addHook('onRequest', async (request, reply) => {
    const authConfig = (cachedConfig ?? getConfig()).webAuth
    if (!authConfig?.enabled) {
      return
    }

    const rawUrl = request.raw?.url ?? request.url ?? ''
    if (!rawUrl) return

    // 公开访问的路径
    const publicPaths = [
      '/auth/',
      '/anthropic',
      '/openai',
      '/assets/',
      '/favicon.ico',
      '/',
      '/ui',
      '/health'
    ]

    // 检查是否是公开路径
    if (publicPaths.some((path) => rawUrl === path || rawUrl.startsWith(path))) {
      return
    }

    // 检查是否是自定义端点路径（也应该公开访问）
    const customEndpoints = (cachedConfig ?? getConfig()).customEndpoints ?? []
    const isCustomEndpoint = customEndpoints.some((endpoint) => {
      if (endpoint.enabled === false) return false
      const paths = getEndpointPaths(endpoint)
      return paths.some(path => rawUrl === path || rawUrl.startsWith(path))
    })

    if (isCustomEndpoint) {
      return
    }

    if (request.method === 'OPTIONS') {
      return
    }

    if (rawUrl.startsWith('/api/')) {
      const session = readSession(request)
      if (session) {
        return
      }
      reply.code(401)
      reply.header('Cache-Control', 'no-store')
      await reply.send({ error: 'Authentication required' })
    }
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

  await registerAuthRoutes(app)
  await registerMessagesRoute(app)
  await registerOpenAiRoutes(app)
  await registerEventsRoutes(app)

  // 初始注册自定义端点
  await syncCustomEndpoints(app, config)

  await registerAdminRoutes(app)
  startMaintenanceTimers()

  // 存储 app 实例以便 onConfigChange 回调使用
  appInstance = app

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

export interface StartedServers {
  http?: FastifyInstance
  https?: FastifyInstance
}

export async function startServer(options: StartOptions = {}): Promise<StartedServers> {
  const config = cachedConfig ?? loadConfig()
  const result: StartedServers = {}

  // 启动 HTTP 服务器
  if (config.http?.enabled !== false) {
    const httpApp = await createServer('http')
    const httpPort = options.port ?? (process.env.PORT ? Number.parseInt(process.env.PORT, 10) : config.http?.port ?? config.port ?? DEFAULT_PORT)
    const httpHost = options.host ?? process.env.HOST ?? config.http?.host ?? config.host ?? DEFAULT_HOST

    await httpApp.listen({ port: httpPort, host: httpHost })
    httpApp.log.info(`HTTP server started at http://${httpHost}:${httpPort}`)
    result.http = httpApp
  }

  // 启动 HTTPS 服务器
  if (config.https?.enabled === true) {
    try {
      const httpsApp = await createServer('https')
      const httpsPort = config.https.port
      const httpsHost = config.https.host ?? config.host ?? DEFAULT_HOST

      await httpsApp.listen({ port: httpsPort, host: httpsHost })
      httpsApp.log.info(`HTTPS server started at https://${httpsHost}:${httpsPort}`)
      result.https = httpsApp
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`HTTPS server启动失败: ${errorMessage}`)

      // 如果 HTTP 也失败了,抛出错误
      if (!result.http) {
        throw error
      }

      console.warn('仅 HTTP 服务器启动成功,HTTPS 服务器启动失败')
    }
  }

  // 至少要有一个服务器启动成功
  if (!result.http && !result.https) {
    throw new Error('HTTP 和 HTTPS 服务器均未启动')
  }

  return result
}

async function main() {
  try {
    const servers = await startServer()

    const shutdown = async () => {
      try {
        const closePromises: Promise<void>[] = []

        if (servers.http) {
          closePromises.push(servers.http.close())
        }
        if (servers.https) {
          closePromises.push(servers.https.close())
        }

        await Promise.all(closePromises)
        process.exit(0)
      } catch (err) {
        console.error('关闭服务失败:', err)
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
