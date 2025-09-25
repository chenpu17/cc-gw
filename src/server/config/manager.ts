import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { EventEmitter } from 'node:events'
import type { GatewayConfig, ModelRouteMap } from './types.js'

export const HOME_DIR = path.join(os.homedir(), '.cc-gw')
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
let cachedConfig: GatewayConfig | null = null

function parseConfig(raw: string): GatewayConfig {
  const data = JSON.parse(raw)
  if (typeof data.port !== 'number') {
    throw new Error('配置文件缺少或错误的 port 字段')
  }
  if (!Array.isArray(data.providers)) {
    data.providers = []
  }
  if (!data.defaults) {
    data.defaults = {
      completion: null,
      reasoning: null,
      background: null,
      longContextThreshold: 60000
    }
  } else {
    data.defaults.longContextThreshold ??= 60000
  }
  if (typeof data.logRetentionDays !== 'number') {
    data.logRetentionDays = 30
  }
  if (typeof data.storePayloads !== 'boolean') {
    data.storePayloads = true
  }
  if (!data.modelRoutes || typeof data.modelRoutes !== 'object') {
    data.modelRoutes = {}
  } else {
    const sanitized: ModelRouteMap = {}
    for (const [key, value] of Object.entries(data.modelRoutes as Record<string, unknown>)) {
      if (typeof value !== 'string') continue
      const trimmedKey = key.trim()
      const trimmedValue = value.trim()
      if (!trimmedKey || !trimmedValue) continue
      sanitized[trimmedKey] = trimmedValue
    }
    data.modelRoutes = sanitized
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
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf-8')
  cachedConfig = next
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
