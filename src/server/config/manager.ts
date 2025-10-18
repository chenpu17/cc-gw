import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { EventEmitter } from 'node:events'
import type {
  DefaultsConfig,
  EndpointRoutingConfig,
  GatewayConfig,
  GatewayEndpoint,
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

function resolveEndpointRouting(
  source: unknown,
  fallback: EndpointRoutingConfig
): EndpointRoutingConfig {
  const sourceObject = (typeof source === 'object' && source !== null) ? (source as Record<string, unknown>) : undefined
  const defaultsRaw = sourceObject?.defaults
  const routesRaw = sourceObject?.modelRoutes
  return {
    defaults: sanitizeDefaults(defaultsRaw ?? fallback.defaults),
    modelRoutes: sanitizeModelRoutes(routesRaw ?? fallback.modelRoutes)
  }
}

function parseConfig(raw: string): GatewayConfig {
  const data = JSON.parse(raw)
  if (typeof data.port !== 'number') {
    throw new Error('配置文件缺少或错误的 port 字段')
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
