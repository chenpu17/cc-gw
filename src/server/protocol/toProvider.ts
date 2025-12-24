import type { NormalizedPayload, ProviderChatMessage, ProviderChatRequestBody } from './types.js'
import { resolveProviderFeatures } from './conversionMap.js'

function buildMessages(payload: NormalizedPayload): ProviderChatMessage[] {
  const messages: ProviderChatMessage[] = []
  if (payload.system) {
    messages.push({ role: 'system', content: payload.system })
  }

  for (const message of payload.messages) {
    if (message.role === 'user') {
      if (message.toolResults?.length) {
        for (const tool of message.toolResults) {
          const serialized = typeof tool.content === 'string'
            ? tool.content
            : JSON.stringify(tool.content ?? '')
          messages.push({
            role: 'tool',
            tool_call_id: tool.id,
            name: tool.name ?? tool.id,
            content: serialized ?? ''
            // 移除 cache_control: Anthropic 专有字段，不应传给 OpenAI/Kimi/DeepSeek
          })
        }
      }

      const userContent = message.text ?? ''
      const hasUserText = userContent.trim().length > 0
      if (hasUserText || !message.toolResults?.length) {
        messages.push({ role: 'user', content: hasUserText ? userContent : '' })
      }
    } else if (message.role === 'assistant') {
      const openAiMsg: ProviderChatMessage = {
        role: 'assistant',
        content: message.text ?? ''
      }
      if (message.toolCalls?.length) {
        openAiMsg.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: {
            name: call.name,
            arguments: typeof call.arguments === 'string'
              ? call.arguments
              : JSON.stringify(call.arguments ?? {})
          }
          // 移除 cache_control: Anthropic 专有字段，不应传给 OpenAI/Kimi/DeepSeek
        }))
        if (!openAiMsg.content) {
          openAiMsg.content = null
        }
      }
      messages.push(openAiMsg)
    }
  }
  return messages
}

export interface ProviderBuildOptions {
  maxTokens?: number
  temperature?: number
  toolChoice?: any
  overrideTools?: any[]
  providerType?: string
}

export function buildProviderBody(payload: NormalizedPayload, options: ProviderBuildOptions = {}): ProviderChatRequestBody {
  const body: ProviderChatRequestBody & Record<string, unknown> = {
    messages: buildMessages(payload)
  }
  if (options.maxTokens) {
    if (payload.thinking) {
      body.max_completion_tokens = options.maxTokens
    } else {
      body.max_tokens = options.maxTokens
    }
  }
  if (typeof options.temperature === 'number') {
    body.temperature = options.temperature
  }
  const tools = options.overrideTools ?? payload.tools
  if (tools && tools.length > 0) {
    body.tools = tools.map((tool: any) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema ?? tool.parameters ?? {}
      }
    }))
  }
  if (options.toolChoice) {
    body.tool_choice = options.toolChoice
  }

  // 只透传通用的 OpenAI 参数，移除 Anthropic 专有字段
  const passthroughKeys = [
    // 'cache_control',  // 移除：Anthropic 专有，Kimi/DeepSeek 不支持
    // 'metadata',       // 移除：不是所有提供商都支持 (现在条件性添加，见下方)
    'response_format',
    'parallel_tool_calls',
    'frequency_penalty',
    'presence_penalty',
    'logit_bias',
    'top_p',
    'top_k',
    'stop',
    'stop_sequences',
    'user',
    'seed',
    'n',
    'options'
  ] as const

  const original = payload.original ?? {}
  for (const key of passthroughKeys) {
    if (Object.prototype.hasOwnProperty.call(original, key)) {
      const value = (original as Record<string, unknown>)[key]
      if (value !== undefined) {
        body[key] = value
      }
    }
  }

  // OpenAI 兼容提供商支持 metadata
  const features = resolveProviderFeatures(options.providerType)
  if (features.allowMetadata) {
    if (original.metadata && typeof original.metadata === 'object') {
      body.metadata = original.metadata
    }
  }

  return body
}

export interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: any
  tool_use_id?: string
  content?: Array<{ type: 'text'; text: string }>
  cache_control?: unknown
}

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: AnthropicContentBlock[]
}

export interface AnthropicRequestBody {
  system?: string
  messages: AnthropicMessage[]
  max_tokens?: number
  temperature?: number
  tools?: Array<{
    type: 'tool'
    name: string
    description?: string
    input_schema: Record<string, unknown>
  }>
  tool_choice?: any
  metadata?: Record<string, unknown>
  stream?: boolean
}

function buildAnthropicContentFromText(text: string | undefined): AnthropicContentBlock[] {
  if (!text || text.length === 0) {
    return []
  }
  return [
    {
      type: 'text',
      text
    }
  ]
}

export function buildAnthropicBody(payload: NormalizedPayload, options: ProviderBuildOptions = {}): AnthropicRequestBody {
  const features = resolveProviderFeatures(options.providerType ?? 'anthropic')
  const messages: AnthropicMessage[] = []

  for (const message of payload.messages) {
    const blocks: AnthropicContentBlock[] = []

    if (message.text) {
      blocks.push(...buildAnthropicContentFromText(message.text))
    }

    if (message.role === 'user' && message.toolResults?.length) {
      for (const result of message.toolResults) {
        // 构建 tool_result 的 content，确保至少包含一个 text block
        let content: Array<{ type: 'text'; text: string }>
        if (typeof result.content === 'string') {
          content = [{ type: 'text' as const, text: result.content }]
        } else {
          const serialized = JSON.stringify(result.content ?? '')
          content = [{ type: 'text' as const, text: serialized }]
        }
        blocks.push({
          type: 'tool_result',
          tool_use_id: result.id,
          content,
          cache_control: result.cacheControl
        })
      }
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      for (const call of message.toolCalls) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: call.arguments ?? {},
          cache_control: call.cacheControl
        })
      }
    }

    // 只有当消息有实际内容时才添加到 messages 列表
    // 完全空的消息会被跳过，避免发送空 text block
    if (message.role === 'assistant' || message.role === 'user') {
      if (blocks.length > 0) {
        messages.push({
          role: message.role,
          content: blocks
        })
      }
    }
  }

  const body: AnthropicRequestBody = {
    system: payload.system ?? undefined,
    messages,
    stream: payload.stream
  }

  if (options.maxTokens) {
    body.max_tokens = options.maxTokens
  }
  if (typeof options.temperature === 'number') {
    body.temperature = options.temperature
  }

  if (features.allowMetadata && payload.original && typeof payload.original === 'object') {
    const original = payload.original as Record<string, unknown>
    if (original.metadata && typeof original.metadata === 'object') {
      body.metadata = original.metadata as Record<string, unknown>
    }
  }

  const tools = options.overrideTools ?? payload.tools
  if (tools && tools.length > 0) {
    body.tools = tools.map((tool: any) => ({
      type: 'tool' as const,
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema ?? tool.parameters ?? {}
    }))
  }

  if (options.toolChoice) {
    body.tool_choice = options.toolChoice
  }

  return body
}
