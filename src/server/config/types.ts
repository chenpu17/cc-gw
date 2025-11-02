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

export type EndpointProtocol = 'anthropic' | 'openai-chat' | 'openai-responses' | 'openai-auto'

export interface EndpointRoutingConfig {
  defaults: DefaultsConfig
  modelRoutes: ModelRouteMap
}

export interface EndpointPathConfig {
  path: string
  protocol: EndpointProtocol
}

export interface CustomEndpointConfig {
  id: string
  label: string
  // 新格式：支持多个路径
  paths?: EndpointPathConfig[]
  // 旧格式：向后兼容（已弃用）
  path?: string
  protocol?: EndpointProtocol
  enabled?: boolean
  routing?: EndpointRoutingConfig
  routingPresets?: RoutingPreset[]
}

export interface RoutingPreset {
  name: string
  modelRoutes: ModelRouteMap
  createdAt: number
}

export interface HttpConfig {
  enabled: boolean
  port: number
  host?: string
}

export interface HttpsConfig {
  enabled: boolean
  port: number
  host?: string
  keyPath: string
  certPath: string
  caPath?: string
}

export interface GatewayConfig {
  // 新格式: HTTP/HTTPS 独立配置
  http?: HttpConfig
  https?: HttpsConfig
  // 旧格式: 向后兼容
  port?: number
  host?: string

  providers: ProviderConfig[]
  defaults: DefaultsConfig
  enableRoutingFallback?: boolean
  logRetentionDays?: number
  modelRoutes?: ModelRouteMap
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

export interface WebAuthConfig {
  enabled: boolean
  username?: string
  passwordHash?: string
  passwordSalt?: string
}
