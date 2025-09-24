import { NormalizedPayload, ProviderChatMessage, ProviderChatRequestBody } from './types'

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
            content: serialized ?? '',
            cache_control: tool.cacheControl
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
          },
          cache_control: call.cacheControl
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
}

export function buildProviderBody(payload: NormalizedPayload, options: ProviderBuildOptions = {}): ProviderChatRequestBody {
  const body: ProviderChatRequestBody = {
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

  const passthroughKeys = [
    'cache_control',
    'metadata',
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
        ;(body as Record<string, unknown>)[key] = value
      }
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
  const messages: AnthropicMessage[] = []

  for (const message of payload.messages) {
    const blocks: AnthropicContentBlock[] = []

    if (message.text) {
      blocks.push(...buildAnthropicContentFromText(message.text))
    }

    if (message.role === 'user' && message.toolResults?.length) {
      for (const result of message.toolResults) {
        const content = typeof result.content === 'string'
          ? [{ type: 'text' as const, text: result.content }]
          : [{ type: 'text' as const, text: JSON.stringify(result.content ?? '') }]
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

    if (message.role === 'assistant' || message.role === 'user') {
      if (blocks.length === 0) {
        blocks.push({ type: 'text', text: '' })
      }
      messages.push({
        role: message.role,
        content: blocks
      })
    }
  }

  const body: AnthropicRequestBody = {
    system: payload.system ?? undefined,
    messages
  }

  if (options.maxTokens) {
    body.max_tokens = options.maxTokens
  }
  if (typeof options.temperature === 'number') {
    body.temperature = options.temperature
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
