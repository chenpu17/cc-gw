import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { EventEmitter } from 'node:events'
import type {
  DefaultsConfig,
  EndpointRoutingConfig,
  GatewayConfig,
  GatewayEndpoint,
  ModelRouteMap
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

function resolveEndpointRouting(
  source: unknown,
  fallback: EndpointRoutingConfig
): EndpointRoutingConfig {
  const defaultsRaw = (typeof source === 'object' && source !== null)
    ? (source as any).defaults
    : undefined
  const routesRaw = (typeof source === 'object' && source !== null)
    ? (source as any).modelRoutes
    : undefined

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
  if (typeof data.storePayloads !== 'boolean') {
    data.storePayloads = true
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
