/**
 * Response Format Conversion Module
 *
 * Provides bidirectional conversion between OpenAI and Anthropic API response formats.
 * Extracted from messages.ts and openai.ts to eliminate code duplication.
 *
 * Key conversion functions:
 * - convertOpenAIToAnthropic: OpenAI Chat Completions → Anthropic Messages
 * - convertAnthropicToOpenAIChat: Anthropic Messages → OpenAI Chat Completions
 * - convertAnthropicToOpenAIResponse: Anthropic Messages → OpenAI Responses
 */

// ============================================================================
// Type Definitions
// ============================================================================

export interface ConvertedAnthropicContent {
  content: any[]
  aggregatedText: string
}

export interface BuildOpenAIResponseOptions {
  inputTokens: number
  outputTokens: number
  cachedTokens: number | null
}

export interface BuildChatCompletionOptions {
  inputTokens: number
  outputTokens: number
  cachedTokens?: number | null
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate unique ID with given prefix
 */
function generateId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Map OpenAI finish_reason to Anthropic stop_reason
 * Used in: OpenAI → Anthropic conversion
 */
function mapOpenAIStopReason(reason: string | null | undefined): string | null {
  switch (reason) {
    case 'stop':
      return 'end_turn'
    case 'tool_calls':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    default:
      return reason ?? null
  }
}

/**
 * Map Anthropic stop_reason to OpenAI Response status
 * Used in: Anthropic → OpenAI Responses conversion
 */
function mapAnthropicStopReasonToStatus(reason: string | null | undefined): string {
  switch (reason) {
    case 'tool_use':
      return 'requires_action'
    case 'max_tokens':
    case 'stop_sequence':
      return 'incomplete'
    default:
      return 'completed'
  }
}

/**
 * Map Anthropic stop_reason to OpenAI Chat finish_reason
 * Used in: Anthropic → OpenAI Chat conversion
 *
 * Exported for use in streaming response handlers
 */
export function mapAnthropicStopReasonToChatFinish(reason: string | null | undefined): string | null {
  switch (reason) {
    case 'tool_use':
      return 'tool_calls'
    case 'max_tokens':
      return 'length'
    case 'stop_sequence':
      return 'stop'
    case 'end_turn':
    case 'stop':
      return 'stop'
    default:
      return reason ?? null
  }
}

/**
 * Convert Anthropic content blocks for OpenAI Responses format
 * Handles text, tool_use, and tool_result blocks
 *
 * Exported for use in token estimation before format conversion
 */
export function convertAnthropicContent(blocks: any): ConvertedAnthropicContent {
  const result: ConvertedAnthropicContent = {
    content: [],
    aggregatedText: ''
  }
  if (!Array.isArray(blocks)) {
    return result
  }

  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const type = block.type ?? ''

    if (type === 'text') {
      const text = typeof block.text === 'string'
        ? block.text
        : Array.isArray(block.content)
        ? block.content
            .filter((item: any) => item && typeof item === 'object' && typeof item.text === 'string')
            .map((item: any) => item.text)
            .join('')
        : ''
      const id = typeof block.id === 'string' ? block.id : generateId('text')
      result.content.push({
        id,
        type: 'output_text',
        text
      })
      if (text) {
        result.aggregatedText += text
      }
      continue
    }

    if (type === 'tool_use') {
      result.content.push({
        id: typeof block.id === 'string' ? block.id : generateId('tool'),
        type: 'tool_use',
        name: typeof block.name === 'string' ? block.name : 'tool',
        input: block.input ?? {},
        cache_control: block.cache_control
      })
      continue
    }

    if (type === 'tool_result') {
      const id =
        typeof block.id === 'string'
          ? block.id
          : block.tool_use_id
          ? `result_${block.tool_use_id}`
          : generateId('tool_result')
      result.content.push({
        id,
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content: block.content ?? null,
        cache_control: block.cache_control
      })
      continue
    }
  }

  return result
}

// ============================================================================
// Main Conversion Functions
// ============================================================================

/**
 * Convert OpenAI Chat Completions format to Anthropic Messages format
 *
 * Extracts from messages.ts buildClaudeResponse (line 169-205)
 *
 * @param openAI - OpenAI Chat Completions response object
 * @param model - Model identifier
 * @returns Anthropic Messages response object
 *
 * @example
 * const anthropic = convertOpenAIToAnthropic({
 *   id: 'chatcmpl-123',
 *   choices: [{
 *     message: { content: 'Hello', role: 'assistant' },
 *     finish_reason: 'stop'
 *   }],
 *   usage: { prompt_tokens: 10, completion_tokens: 20 }
 * }, 'claude-3')
 */
export function convertOpenAIToAnthropic(openAI: any, model: string): any {
  const choice = openAI.choices?.[0]
  const message = choice?.message ?? {}
  const contentBlocks: any[] = []

  // Convert text content
  if (typeof message.content === 'string' && message.content.length > 0) {
    contentBlocks.push({ type: 'text', text: message.content })
  }

  // Convert tool_calls to tool_use blocks
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      contentBlocks.push({
        type: 'tool_use',
        id: call.id || generateId('tool'),
        name: call.function?.name,
        input: (() => {
          try {
            return call.function?.arguments ? JSON.parse(call.function.arguments) : {}
          } catch {
            return {}
          }
        })()
      })
    }
  }

  const usage: any = {
    input_tokens: openAI.usage?.prompt_tokens ?? 0,
    output_tokens: openAI.usage?.completion_tokens ?? 0
  }

  // Map cached_tokens to cache_read_input_tokens if available
  if (openAI.usage?.cached_tokens !== undefined && openAI.usage.cached_tokens > 0) {
    usage.cache_read_input_tokens = openAI.usage.cached_tokens
  }

  return {
    id: openAI.id ? openAI.id.replace('chatcmpl', 'msg') : `msg_${Math.random().toString(36).slice(2)}`,
    type: 'message',
    role: 'assistant',
    model,
    content: contentBlocks,
    stop_reason: mapOpenAIStopReason(choice?.finish_reason),
    stop_sequence: null,
    usage
  }
}

/**
 * Convert Anthropic Messages format to OpenAI Chat Completions format
 *
 * Extracted from openai.ts buildChatCompletionFromClaude (line 505-560)
 * Enhanced to support cachedTokens parameter
 *
 * @param claude - Anthropic Messages response object
 * @param model - Model identifier
 * @param usage - Token usage information
 * @returns OpenAI Chat Completions response object
 *
 * @example
 * const openai = convertAnthropicToOpenAIChat({
 *   id: 'msg_123',
 *   content: [{ type: 'text', text: 'Hello' }],
 *   stop_reason: 'end_turn'
 * }, 'claude-3', { inputTokens: 10, outputTokens: 20 })
 */
export function convertAnthropicToOpenAIChat(
  claude: any,
  model: string,
  usage: BuildChatCompletionOptions
): any {
  const created = Math.floor(Date.now() / 1000)
  const chatId =
    typeof claude?.id === 'string' ? claude.id.replace(/^msg_/, 'chatcmpl_') : generateId('chatcmpl')

  // Convert content blocks
  const converted = convertAnthropicContent(claude?.content ?? [])

  const message: Record<string, unknown> = {
    role: typeof claude?.role === 'string' ? claude.role : 'assistant',
    content: converted?.aggregatedText ?? ''
  }

  // Defensive check: ensure converted.content is array
  const contentArray = Array.isArray(converted?.content) ? converted.content : []
  const toolCalls = contentArray
    .filter((item) => item?.type === 'tool_use')
    .map((item, index) => ({
      id: item.id ?? `call_${index}`,
      type: 'function',
      function: {
        name: item.name ?? 'tool',
        arguments: JSON.stringify(item.input ?? {})
      }
    }))

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls
    if (!converted?.aggregatedText) {
      message.content = ''
    }
  }

  const usagePayload: Record<string, number> = {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.inputTokens + usage.outputTokens
  }

  // Add cached_tokens if provided (OpenAI Chat Completions supports this)
  if (usage.cachedTokens != null && usage.cachedTokens > 0) {
    usagePayload.cached_tokens = usage.cachedTokens
  }

  return {
    id: chatId,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        finish_reason: mapAnthropicStopReasonToChatFinish(claude?.stop_reason),
        message
      }
    ],
    usage: usagePayload
  }
}

/**
 * Convert Anthropic Messages format to OpenAI Responses format
 *
 * Extracted from openai.ts buildOpenAIResponseFromClaude (line 438-498)
 *
 * @param claude - Anthropic Messages response object
 * @param model - Model identifier
 * @param usage - Token usage information (including cachedTokens)
 * @returns OpenAI Responses response object
 *
 * @example
 * const openaiResponse = convertAnthropicToOpenAIResponse({
 *   id: 'msg_123',
 *   content: [{ type: 'text', text: 'Hello' }],
 *   stop_reason: 'end_turn'
 * }, 'claude-3', { inputTokens: 10, outputTokens: 20, cachedTokens: 5 })
 */
export function convertAnthropicToOpenAIResponse(
  claude: any,
  model: string,
  usage: BuildOpenAIResponseOptions
): any {
  const created = Math.floor(Date.now() / 1000)
  const responseId =
    typeof claude?.id === 'string' ? claude.id.replace(/^msg_/, 'resp_') : generateId('resp')
  const outputId = `out_${responseId.slice(responseId.indexOf('_') + 1)}`
  const role = typeof claude?.role === 'string' ? claude.role : 'assistant'

  // Convert content blocks
  const converted = convertAnthropicContent(claude?.content ?? [])

  const usagePayload: Record<string, number | null> = {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.inputTokens + usage.outputTokens,
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens
  }
  if (usage.cachedTokens != null) {
    usagePayload.cached_tokens = usage.cachedTokens
  }

  // Defensive check: ensure converted.content is array
  const contentArray = Array.isArray(converted?.content) ? converted.content : []
  const messageContent = contentArray.map((item) => ({ ...item }))
  const outputContent = contentArray.map((item) => ({ ...item }))

  const response = {
    id: responseId,
    object: 'response',
    created,
    model,
    status: mapAnthropicStopReasonToStatus(claude?.stop_reason),
    status_code: 200,
    response: {
      id: responseId,
      type: 'message',
      role,
      content: messageContent
    },
    output: [
      {
        id: outputId,
        type: 'output_message',
        role,
        content: outputContent
      }
    ],
    usage: usagePayload,
    metadata: claude?.metadata ?? {},
    stop_reason: claude?.stop_reason ?? null,
    stop_sequence: claude?.stop_sequence ?? null
  }

  if (converted.aggregatedText) {
    ;(response as Record<string, unknown>).output_text = converted.aggregatedText
  }

  return response
}
