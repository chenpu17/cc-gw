export interface ProviderModelConfig {
  id: string
  label?: string
  capabilities?: {
    thinking?: boolean
    tools?: boolean
  }
  maxTokens?: number
}

export interface ProviderConfig {
  id: string
  label: string
  baseUrl: string
  apiKey?: string
  defaultModel?: string
  models?: ProviderModelConfig[]
  extraHeaders?: Record<string, string>
  type?: 'openai' | 'deepseek' | 'kimi' | 'anthropic' | 'huawei' | 'custom'
}

export interface DefaultsConfig {
  completion: string | null
  reasoning: string | null
  background: string | null
  longContextThreshold: number
}

export type ModelRouteMap = Record<string, string>

export interface GatewayConfig {
  port: number
  host?: string
  providers: ProviderConfig[]
  defaults: DefaultsConfig
  logRetentionDays?: number
  modelRoutes?: ModelRouteMap
  storePayloads?: boolean
  logLevel?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'
  requestLogging?: boolean
}
