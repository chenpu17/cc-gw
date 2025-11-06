import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { EventEmitter } from 'node:events'
import type {
  DefaultsConfig,
  EndpointRoutingConfig,
  EndpointValidationConfig,
  GatewayConfig,
  GatewayEndpoint,
  HttpConfig,
  HttpsConfig,
  ModelRouteMap,
  RoutingPreset,
  WebAuthConfig
} from './types.js'

const LOG_LEVELS = new Set<NonNullable<GatewayConfig['logLevel']>>([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace'
])

const HOME_OVERRIDE = process.env.CC_GW_HOME
export const HOME_DIR = path.resolve(HOME_OVERRIDE ?? path.join(os.homedir(), '.cc-gw'))
export const CONFIG_PATH = path.join(HOME_DIR, 'config.json')
export const CERTS_DIR = path.join(HOME_DIR, 'certs')

type ConfigEvents = {
  change: (config: GatewayConfig) => void
}

class TypedEmitter<T> extends EventEmitter {
  override on<K extends keyof T>(event: K, listener: T[K]): this {
    return super.on(event as string, listener as any)
  }
  override off<K extends keyof T>(event: K, listener: T[K]): this {
    return super.off(event as string, listener as any)
  }
  emitTyped<K extends keyof T>(event: K, ...args: Parameters<T[K]>): boolean {
    return super.emit(event as string, ...args)
  }
}

const emitter = new TypedEmitter<ConfigEvents>()
const KNOWN_ENDPOINTS: GatewayEndpoint[] = ['anthropic', 'openai']

let cachedConfig: GatewayConfig | null = null

function sanitizeDefaults(input: Partial<DefaultsConfig> | undefined): DefaultsConfig {
  const defaults: DefaultsConfig = {
    completion: null,
    reasoning: null,
    background: null,
    longContextThreshold: 60000
  }
  if (input) {
    if (typeof input.completion === 'string' || input.completion === null) {
      defaults.completion = input.completion ?? null
    }
    if (typeof input.reasoning === 'string' || input.reasoning === null) {
      defaults.reasoning = input.reasoning ?? null
    }
    if (typeof input.background === 'string' || input.background === null) {
      defaults.background = input.background ?? null
    }
    if (typeof input.longContextThreshold === 'number' && Number.isFinite(input.longContextThreshold)) {
      defaults.longContextThreshold = input.longContextThreshold
    }
  }
  return defaults
}

function sanitizeModelRoutes(input: Record<string, unknown> | undefined): ModelRouteMap {
  if (!input) return {}
  const sanitized: ModelRouteMap = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string') continue
    const trimmedKey = key.trim()
    const trimmedValue = value.trim()
    if (!trimmedKey || !trimmedValue) continue
    sanitized[trimmedKey] = trimmedValue
  }
  return sanitized
}

/**
 * 迁移旧配置格式到新格式 (支持 HTTP/HTTPS 独立配置)
 */
function migrateProtocolConfig(data: any): void {
  // 如果已经有新格式配置,不迁移
  if (data.http || data.https) {
    return
  }

  // 从旧格式迁移
  const port = typeof data.port === 'number' ? data.port : 4100
  const host = typeof data.host === 'string' ? data.host : '127.0.0.1'

  data.http = {
    enabled: true,
    port,
    host
  }

  // HTTPS 默认禁用，除非用户明确配置了证书路径
  // 检查是否存在旧的 HTTPS 配置
  const hasLegacyHttpsConfig =
    (typeof data.httpsPort === 'number') ||
    (typeof data.keyPath === 'string' && data.keyPath) ||
    (typeof data.certPath === 'string' && data.certPath)

  data.https = {
    enabled: hasLegacyHttpsConfig ? true : false,
    port: typeof data.httpsPort === 'number' ? data.httpsPort : 4443,
    host: typeof data.httpsHost === 'string' ? data.httpsHost : host,
    keyPath: typeof data.keyPath === 'string' ? data.keyPath : path.join(CERTS_DIR, 'key.pem'),
    certPath: typeof data.certPath === 'string' ? data.certPath : path.join(CERTS_DIR, 'cert.pem'),
    caPath: typeof data.caPath === 'string' ? data.caPath : ''
  }

  // 保留旧字段以兼容性
  data.port = port
  data.host = host
}

/**
 * 验证协议配置 (至少启用一个协议)
 */
function validateProtocolConfig(data: any): void {
  const httpEnabled = data.http?.enabled === true
  const httpsEnabled = data.https?.enabled === true

  if (!httpEnabled && !httpsEnabled) {
    throw new Error('至少需要启用 HTTP 或 HTTPS 协议')
  }

  // 验证 HTTPS 证书路径
  if (httpsEnabled) {
    const https = data.https as HttpsConfig
    if (!https.keyPath || !https.certPath) {
      throw new Error('HTTPS 已启用但缺少证书路径配置')
    }
  }
}

function sanitizeWebAuth(input: unknown): WebAuthConfig | undefined {
  if (!input || typeof input !== 'object') {
    return {
      enabled: false
    }
  }
  const source = input as Record<string, unknown>
  const config: WebAuthConfig = {
    enabled: Boolean(source.enabled)
  }

  const usernameRaw = source.username
  if (typeof usernameRaw === 'string') {
    const trimmed = usernameRaw.trim()
    if (trimmed) {
      config.username = trimmed
    }
  }

  const hashRaw = source.passwordHash
  if (typeof hashRaw === 'string' && hashRaw.trim().length > 0) {
    config.passwordHash = hashRaw.trim()
  }

  const saltRaw = source.passwordSalt
  if (typeof saltRaw === 'string' && saltRaw.trim().length > 0) {
    config.passwordSalt = saltRaw.trim()
  }

  if (config.enabled) {
    const hasUsername = typeof config.username === 'string' && config.username.length > 0
    const hasPassword =
      typeof config.passwordHash === 'string' &&
      config.passwordHash.length > 0 &&
      typeof config.passwordSalt === 'string' &&
      config.passwordSalt.length > 0
    if (!hasUsername || !hasPassword) {
      config.enabled = false
      if (!hasUsername) {
        delete config.username
      }
    }
  }

  return config
}

function sanitizeEndpointValidation(
  value: unknown,
  fallback?: EndpointValidationConfig
): EndpointValidationConfig | undefined {
  // 从 fallback 或默认值开始
  let mode: EndpointValidationConfig['mode'] = fallback?.mode ?? 'off'
  let allowExperimental = fallback?.allowExperimentalBlocks

  if (!value || typeof value !== 'object') {
    // 如果没有输入且有 fallback,返回 fallback
    return fallback
  }

  const source = value as Record<string, unknown>

  // 解析 mode
  const modeRaw = source.mode
  if (typeof modeRaw === 'string') {
    const normalized = modeRaw.trim().toLowerCase()
    if (normalized === 'off' || normalized === 'claude-code' || normalized === 'anthropic-strict') {
      mode = normalized as EndpointValidationConfig['mode']
    }
  }

  // 解析 allowExperimentalBlocks
  if ('allowExperimentalBlocks' in source) {
    allowExperimental = Boolean(source.allowExperimentalBlocks)
  }

  return { mode, allowExperimentalBlocks: allowExperimental }
}

function resolveEndpointRouting(
  source: unknown,
  fallback: EndpointRoutingConfig
): EndpointRoutingConfig {
  const sourceObject = (typeof source === 'object' && source !== null) ? (source as Record<string, unknown>) : undefined
  const defaultsRaw = sourceObject?.defaults
  const routesRaw = sourceObject?.modelRoutes
  const validationRaw = sourceObject?.validation
  const validation = sanitizeEndpointValidation(validationRaw, fallback.validation)
  return {
    defaults: sanitizeDefaults(defaultsRaw ?? fallback.defaults),
    modelRoutes: sanitizeModelRoutes(routesRaw ?? fallback.modelRoutes),
    ...(validation !== undefined ? { validation } : {})
  }
}

function parseConfig(raw: string): GatewayConfig {
  const data = JSON.parse(raw)

  // 迁移旧配置格式
  migrateProtocolConfig(data)

  // 验证协议配置
  validateProtocolConfig(data)

  if (typeof data.port !== 'number') {
    // 如果没有旧的 port 字段,尝试从 http 配置获取
    data.port = data.http?.port ?? 4100
  }
  if (!Array.isArray(data.providers)) {
    data.providers = []
  }
  data.providers = data.providers.map((provider: any) => {
    if (!provider || typeof provider !== 'object') return provider
    if (provider.type === 'anthropic') {
      provider.authMode = provider.authMode === 'authToken' ? 'authToken' : 'apiKey'
    } else if ('authMode' in provider) {
      delete provider.authMode
    }
    return provider
  })
  const legacyDefaults = sanitizeDefaults(data.defaults)
  if (typeof data.logRetentionDays !== 'number') {
    data.logRetentionDays = 30
  }
  const legacyStorePayloads = typeof data.storePayloads === 'boolean' ? data.storePayloads : undefined
  const hasRequestFlag = typeof data.storeRequestPayloads === 'boolean'
  const hasResponseFlag = typeof data.storeResponsePayloads === 'boolean'

  const resolvedStoreRequest = hasRequestFlag
    ? data.storeRequestPayloads!
    : legacyStorePayloads ?? true
  const resolvedStoreResponse = hasResponseFlag
    ? data.storeResponsePayloads!
    : legacyStorePayloads ?? true

  data.storeRequestPayloads = resolvedStoreRequest
  data.storeResponsePayloads = resolvedStoreResponse
  if ('storePayloads' in data) {
    delete (data as any).storePayloads
  }
  const legacyRoutes = sanitizeModelRoutes(data.modelRoutes as Record<string, unknown> | undefined)
  if (typeof data.logLevel !== 'string' || !LOG_LEVELS.has(data.logLevel as any)) {
    data.logLevel = 'info'
  }
  if (typeof data.requestLogging !== 'boolean') {
    data.requestLogging = true
  }
  if (typeof data.responseLogging !== 'boolean') {
    data.responseLogging = data.requestLogging !== false
  }
  if (typeof data.bodyLimit !== 'number' || !Number.isFinite(data.bodyLimit) || data.bodyLimit <= 0) {
    data.bodyLimit = 10 * 1024 * 1024
  }

  const endpointRouting: Partial<Record<GatewayEndpoint, EndpointRoutingConfig>> = {}
  const sourceRouting = (data.endpointRouting && typeof data.endpointRouting === 'object')
    ? data.endpointRouting
    : {}

  const fallbackAnthropic: EndpointRoutingConfig = {
    defaults: legacyDefaults,
    modelRoutes: legacyRoutes
  }
  const fallbackOpenAI: EndpointRoutingConfig = {
    defaults: sanitizeDefaults(undefined),
    modelRoutes: {}
  }

  for (const endpoint of KNOWN_ENDPOINTS) {
    const fallback = endpoint === 'anthropic' ? fallbackAnthropic : fallbackOpenAI
    endpointRouting[endpoint] = resolveEndpointRouting(
      (sourceRouting as Record<string, unknown>)[endpoint],
      fallback
    )
  }

  data.endpointRouting = endpointRouting
  data.defaults = { ...endpointRouting.anthropic!.defaults }
  data.modelRoutes = { ...endpointRouting.anthropic!.modelRoutes }

  const rawPresets = data.routingPresets
  const routingPresets: Partial<Record<GatewayEndpoint, RoutingPreset[]>> = {}
  if (rawPresets && typeof rawPresets === 'object') {
    for (const endpoint of KNOWN_ENDPOINTS) {
      const source = (rawPresets as Record<string, unknown>)[endpoint]
      if (!Array.isArray(source)) continue

      const seen = new Set<string>()
      const presets: RoutingPreset[] = []
      for (const item of source) {
        if (!item || typeof item !== 'object') continue
        const rawName = (item as Record<string, unknown>).name
        if (typeof rawName !== 'string') continue
        const name = rawName.trim()
        if (!name) continue

        const modelRoutes: Record<string, string> = {}
        const rawRoutes = (item as Record<string, any>).modelRoutes
        if (rawRoutes && typeof rawRoutes === 'object') {
          for (const [sourceModel, target] of Object.entries(rawRoutes as Record<string, unknown>)) {
            if (typeof target === 'string' && target.trim()) {
              modelRoutes[sourceModel] = target
            }
          }
        }

        const createdAtValue = Number((item as Record<string, unknown>).createdAt)
        const createdAt = Number.isFinite(createdAtValue) ? createdAtValue : Date.now()
        const key = name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        presets.push({ name, modelRoutes, createdAt })
      }
      if (presets.length > 0) {
        presets.sort((a, b) => a.name.localeCompare(b.name))
        routingPresets[endpoint] = presets
      }
    }
  }

  data.routingPresets = routingPresets

  const webAuth = sanitizeWebAuth((data as any).webAuth)
  if (webAuth) {
    data.webAuth = webAuth
  }

  data.enableRoutingFallback = data.enableRoutingFallback === true

  return data as GatewayConfig
}

export function loadConfig(): GatewayConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`配置文件不存在: ${CONFIG_PATH}`)
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
  cachedConfig = parseConfig(raw)
  return cachedConfig
}

export function getConfig(): GatewayConfig {
  if (cachedConfig) return cachedConfig
  return loadConfig()
}

export function updateConfig(next: GatewayConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  const normalized = parseConfig(JSON.stringify(next))
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(normalized, null, 2), 'utf-8')
  cachedConfig = normalized
  emitter.emitTyped('change', cachedConfig)
}

export function watchConfig(): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  if (!fs.existsSync(CONFIG_PATH)) return
  fs.watch(CONFIG_PATH, { persistent: false }, () => {
    try {
      const updated = loadConfig()
      emitter.emitTyped('change', updated)
    } catch (err) {
      console.error('重新加载配置失败:', err)
    }
  })
}

export function onConfigChange(listener: (config: GatewayConfig) => void): () => void {
  emitter.on('change', listener)
  if (cachedConfig) listener(cachedConfig)
  return () => emitter.off('change', listener)
}
