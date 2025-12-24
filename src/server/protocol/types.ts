export type ClaudeRole = 'system' | 'user' | 'assistant' | 'developer' | 'tool'

export interface ClaudeContentBlock {
  type: 'text' | 'input_text' | 'output_text' | 'tool_use' | 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: any
  tool_use_id?: string
  content?: string | any
  cache_control?: unknown
}

export interface ClaudeMessage {
  role: ClaudeRole
  content: string | ClaudeContentBlock[]
  [key: string]: any
}

export interface NormalizedMessage {
  role: 'user' | 'assistant' | 'system'
  text?: string
  toolCalls?: Array<{
    id: string
    name: string
    arguments: any
    cacheControl?: unknown
  }>
  toolResults?: Array<{
    id: string
    name?: string
    content: any
    cacheControl?: unknown
  }>
}

export interface NormalizedPayload {
  original: any
  system: string | null
  messages: NormalizedMessage[]
  tools: any[]
  stream: boolean
  thinking: boolean
}

export interface ProviderChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
    cache_control?: unknown
  }>
  tool_call_id?: string
  name?: string
  cache_control?: unknown
}

export interface ProviderChatRequestBody {
  messages: ProviderChatMessage[]
  temperature?: number
  max_tokens?: number
  max_completion_tokens?: number
  tool_choice?: any
  tools?: any[]
}
