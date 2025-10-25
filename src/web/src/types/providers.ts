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

// Import CustomEndpoint from endpoints (to avoid circular dependency, we'll define it here if needed)
export interface CustomEndpointConfig {
  id: string
  label: string
  paths?: Array<{ path: string; protocol: string }>
  path?: string
  protocol?: string
  enabled?: boolean
  routing?: EndpointRoutingConfig
  routingPresets?: RoutingPreset[]
}

export interface GatewayConfig {
  port: number
  host?: string
  providers: ProviderConfig[]
  defaults: DefaultsConfig
  enableRoutingFallback?: boolean
  logRetentionDays?: number
  modelRoutes?: Record<string, string>
  endpointRouting?: Partial<Record<GatewayEndpoint, EndpointRoutingConfig>>
  customEndpoints?: CustomEndpointConfig[]
  routingPresets?: Partial<Record<GatewayEndpoint, RoutingPreset[]>>
  storeRequestPayloads?: boolean
  storeResponsePayloads?: boolean
  storePayloads?: boolean
  logLevel?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'
  requestLogging?: boolean
  responseLogging?: boolean
  bodyLimit?: number
  webAuth?: WebAuthConfig
}

export interface ConfigInfoResponse {
  config: GatewayConfig
  path: string
}

export interface WebAuthConfig {
  enabled: boolean
  username?: string
}

export interface WebAuthStatusResponse {
  enabled: boolean
  username: string
  hasPassword: boolean
}
