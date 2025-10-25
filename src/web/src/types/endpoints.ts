export type EndpointProtocol = 'anthropic' | 'openai-chat' | 'openai-responses' | 'openai-auto'

export interface DefaultsConfig {
  completion: string | null
  reasoning: string | null
  background: string | null
  longContextThreshold: number
}

export interface EndpointRoutingConfig {
  defaults: DefaultsConfig
  modelRoutes: Record<string, string>
}

export interface RoutingPreset {
  name: string
  modelRoutes: Record<string, string>
  createdAt: number
}

export interface EndpointPathConfig {
  path: string
  protocol: EndpointProtocol
}

export interface CustomEndpoint {
  id: string
  label: string
  // 新格式：支持多个路径
  paths?: EndpointPathConfig[]
  // 旧格式：向后兼容
  path?: string
  protocol?: EndpointProtocol
  enabled?: boolean
  routing?: EndpointRoutingConfig
  routingPresets?: RoutingPreset[]
}

export interface CustomEndpointsResponse {
  endpoints: CustomEndpoint[]
}

export interface CreateEndpointRequest {
  id: string
  label: string
  // 支持新旧两种格式
  paths?: EndpointPathConfig[]
  path?: string
  protocol?: EndpointProtocol
  enabled?: boolean
  routing?: EndpointRoutingConfig
}

export interface UpdateEndpointRequest {
  label?: string
  paths?: EndpointPathConfig[]
  path?: string
  protocol?: EndpointProtocol
  enabled?: boolean
  routing?: EndpointRoutingConfig
}

export interface EndpointResponse {
  success: boolean
  endpoint?: CustomEndpoint
  error?: string
}
