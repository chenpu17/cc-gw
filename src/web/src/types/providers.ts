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

export type GatewayEndpoint = 'anthropic' | 'openai'

export interface EndpointRoutingConfig {
  defaults: DefaultsConfig
  modelRoutes: Record<string, string>
}

export interface RoutingPreset {
  name: string
  modelRoutes: Record<string, string>
  createdAt: number
}

export interface GatewayConfig {
  port: number
  host?: string
  providers: ProviderConfig[]
  defaults: DefaultsConfig
  logRetentionDays?: number
  modelRoutes?: Record<string, string>
  endpointRouting?: Partial<Record<GatewayEndpoint, EndpointRoutingConfig>>
  routingPresets?: Partial<Record<GatewayEndpoint, RoutingPreset[]>>
  storePayloads?: boolean
  logLevel?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'
  requestLogging?: boolean
  responseLogging?: boolean
}

export interface ConfigInfoResponse {
  config: GatewayConfig
  path: string
}
