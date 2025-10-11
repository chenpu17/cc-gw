export interface ProviderModelConfig {
  id: string
  label?: string
}

export interface ProviderConfig {
  id: string
  label: string
  baseUrl: string
  apiKey?: string
  authMode?: 'apiKey' | 'authToken'
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

export type GatewayEndpoint = 'anthropic' | 'openai'

export interface EndpointRoutingConfig {
  defaults: DefaultsConfig
  modelRoutes: ModelRouteMap
}

export interface RoutingPreset {
  name: string
  modelRoutes: ModelRouteMap
  createdAt: number
}

export interface GatewayConfig {
  port: number
  host?: string
  providers: ProviderConfig[]
  defaults: DefaultsConfig
  logRetentionDays?: number
  modelRoutes?: ModelRouteMap
  endpointRouting?: Partial<Record<GatewayEndpoint, EndpointRoutingConfig>>
  routingPresets?: Partial<Record<GatewayEndpoint, RoutingPreset[]>>
  storePayloads?: boolean
  logLevel?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'
  requestLogging?: boolean
  responseLogging?: boolean
}
