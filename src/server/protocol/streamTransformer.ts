/**
 * Stream Format Transformer
 *
 * Converts Server-Sent Events (SSE) between different API formats while
 * preserving usage statistics and TTFT measurements from the original stream.
 *
 * Key principles:
 * 1. Extract usage/ttft from ORIGINAL events before conversion
 * 2. Maintain state for incremental updates (e.g., tool calls)
 * 3. Support bidirectional conversion (Anthropic ↔ OpenAI)
 */

export type StreamFormat = 'anthropic' | 'openai-chat' | 'openai-responses'

export interface StreamMetadata {
  usage?: {
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
  }
  ttft?: boolean // true when first content token is detected
  stopReason?: string
}

export interface TransformResult {
  transformedChunk: string
  metadata: StreamMetadata
}

interface AccumulatedUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

interface ToolCallState {
  id: string
  name: string
  arguments: string
}

interface OpenAIToolCallState {
  index: number
  id: string
  name: string
  blockIndex: number
}

interface ResponsesState {
  responseId: string
  outputId: string
  createdSent: boolean
  accumulatedText: string
  contentBlocks: any[]
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
  }
}

/**
 * StreamTransformer handles format conversion for SSE streams
 *
 * @example
 * const transformer = new StreamTransformer('anthropic', 'openai-chat', 'claude-3')
 * const result = transformer.transform(chunk)
 * // Use result.transformedChunk for output
 * // Use result.metadata for statistics tracking
 */
export class StreamTransformer {
  private sourceFormat: StreamFormat
  private targetFormat: StreamFormat
  private model: string
  private usage: AccumulatedUsage
  private buffer: string
  private firstContentSeen: boolean
  private finalized: boolean
  private stopReason: string | null
  private currentToolCall: ToolCallState | null
  private messageStartSent: boolean
  private contentBlockStartSent: boolean
  private contentBlockIndex: number
  private responsesState: ResponsesState | null
  private openaiToolCalls: Map<number, OpenAIToolCallState>
  private latestUsage: StreamMetadata['usage'] | null
  private responsesToolNames: Map<string, string>

  constructor(sourceFormat: StreamFormat, targetFormat: StreamFormat, model: string) {
    this.sourceFormat = sourceFormat
    this.targetFormat = targetFormat
    this.model = model
    this.usage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0
    }
    this.buffer = ''
    this.firstContentSeen = false
    this.finalized = false
    this.stopReason = null
    this.currentToolCall = null
    this.messageStartSent = false
    this.contentBlockStartSent = false
    this.contentBlockIndex = 0
    this.responsesState = null
    this.openaiToolCalls = new Map()
    this.latestUsage = null
    this.responsesToolNames = new Map()
  }

  /**
   * Transform a chunk of SSE data
   *
   * @param chunk - Raw SSE chunk string
   * @returns Transformed chunk and extracted metadata
   */
  transform(chunk: string): TransformResult {
    this.buffer += chunk
    let transformedChunk = ''
    const metadata: StreamMetadata = {}

    // Parse SSE lines
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || '' // Keep incomplete line in buffer

    let skipNextEmptyLines = false

    for (const line of lines) {
      const trimmed = line.trim()

      // Handle empty lines
      if (!trimmed) {
        // If we just skipped [DONE] for Anthropic, also skip trailing empty lines
        if (skipNextEmptyLines) {
          continue
        }
        transformedChunk += line + '\n'
        continue
      }

      // Reset flag when we see non-empty content
      skipNextEmptyLines = false

      if (trimmed === 'data: [DONE]') {
        if (this.targetFormat === 'anthropic') {
          const synthesized = this.synthesizeAnthropicStopOnDone()
          if (synthesized) {
            for (const evt of synthesized) {
              if (evt.type) {
                transformedChunk += `event: ${evt.type}\n`
              }
              transformedChunk += `data: ${JSON.stringify(evt)}\n\n`
            }
          }
          skipNextEmptyLines = true
        } else {
          transformedChunk += line + '\n'
        }
        continue
      }

      if (trimmed.startsWith('data:')) {
        const dataStr = trimmed.slice(5).trim()
        if (dataStr === '[DONE]') {
          if (this.targetFormat === 'anthropic') {
            const synthesized = this.synthesizeAnthropicStopOnDone()
            if (synthesized) {
              for (const evt of synthesized) {
                if (evt.type) {
                  transformedChunk += `event: ${evt.type}\n`
                }
                transformedChunk += `data: ${JSON.stringify(evt)}\n\n`
              }
            }
            skipNextEmptyLines = true
          } else {
            transformedChunk += line + '\n'
          }
          continue
        }

        try {
          const event = JSON.parse(dataStr)

          if (this.sourceFormat === 'openai-chat' && typeof event?.type === 'string' && event.type.startsWith('response.')) {
            this.sourceFormat = 'openai-responses'
          }

          // Extract metadata from ORIGINAL event
          this.extractMetadata(event, metadata)

          // Transform event to target format (may return single event or array of events)
          const transformed = this.transformEvent(event)
          if (transformed) {
            const events = Array.isArray(transformed) ? transformed : [transformed]
            for (const evt of events) {
              // For Anthropic format, add event: line based on type field
              if (this.targetFormat === 'anthropic' && evt.type) {
                transformedChunk += `event: ${evt.type}\n`
              }
              transformedChunk += `data: ${JSON.stringify(evt)}\n\n`
            }
          }
        } catch (err) {
          // Pass through unparseable lines
          transformedChunk += line + '\n'
        }
      } else {
        // ALWAYS filter out source event: lines - they will be regenerated if needed
        // Rationale:
        // - For Anthropic target: transformEvent() generates correct event: headers (lines 122-124)
        // - For OpenAI targets: no event: headers should exist at all
        // - Some OpenAI providers emit event: ping, which would break Anthropic clients if leaked
        if (line.trim().startsWith('event:')) {
          // Skip all source event: lines regardless of source format
          continue
        }
        // Pass through other non-data lines (id:, retry:, etc.)
        transformedChunk += line + '\n'
      }
    }

    return { transformedChunk, metadata }
  }

  /**
   * Extract metadata (usage, ttft) from original event before conversion
   */
  private extractMetadata(event: any, metadata: StreamMetadata): void {
    // Detect first content token for TTFT
    if (!this.firstContentSeen) {
      const hasContent = this.detectContent(event)
      if (hasContent) {
        this.firstContentSeen = true
        metadata.ttft = true
      }
    }

    // Extract usage from various event types
    const usage = this.extractUsage(event)
    if (usage) {
      metadata.usage = usage
      // Accumulate for getFinalUsage()
      if (usage.inputTokens !== undefined) this.usage.inputTokens = usage.inputTokens
      if (usage.outputTokens !== undefined) this.usage.outputTokens = usage.outputTokens
      if (usage.cacheReadTokens !== undefined) this.usage.cacheReadTokens = usage.cacheReadTokens
      if (usage.cacheCreationTokens !== undefined) this.usage.cacheCreationTokens = usage.cacheCreationTokens
    }

    // Extract stop reason
    const stopReason = this.extractStopReason(event)
    if (stopReason) {
      metadata.stopReason = stopReason
      this.stopReason = stopReason
    }
  }

  private synthesizeAnthropicStopOnDone(): any[] | null {
    if (this.finalized) return null
    if (this.targetFormat !== 'anthropic') return null
    if (this.sourceFormat !== 'openai-chat' && this.sourceFormat !== 'openai-responses') return null

    const events: any[] = []

    if (!this.messageStartSent) {
      this.messageStartSent = true
      events.push({
        type: 'message_start',
        message: {
          id: `msg_${Math.random().toString(36).slice(2)}`,
          type: 'message',
          role: 'assistant',
          model: this.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 }
        }
      })
    }

    if (this.contentBlockStartSent) {
      events.push({
        type: 'content_block_stop',
        index: 0
      })
    }

    for (const [_, state] of this.openaiToolCalls) {
      events.push({
        type: 'content_block_stop',
        index: state.blockIndex
      })
    }

    const deltaPayload: Record<string, unknown> = {
      stop_reason: this.mapOpenAIStopReason(this.stopReason) || 'end_turn',
      stop_sequence: null
    }

    if (this.latestUsage) {
      deltaPayload.usage = {
        cache_creation_input_tokens: this.latestUsage.cacheCreationTokens || 0,
        cache_read_input_tokens: this.latestUsage.cacheReadTokens || 0,
        input_tokens: this.latestUsage.inputTokens || 0,
        output_tokens: this.latestUsage.outputTokens || 0
      }
    }

    events.push({
      type: 'message_delta',
      delta: deltaPayload
    })

    events.push({
      type: 'message_stop'
    })

    this.finalized = true
    return events
  }

  /**
   * Detect if event contains content (for TTFT calculation)
   */
  private detectContent(event: any): boolean {
    if (this.sourceFormat === 'anthropic') {
      // Anthropic: content_block_delta with text
      return event.type === 'content_block_delta' && event.delta?.type === 'text_delta'
    } else if (this.sourceFormat === 'openai-chat') {
      // OpenAI Chat: choices[0].delta.content
      const delta = event.choices?.[0]?.delta
      return delta?.content !== undefined || delta?.reasoning_content !== undefined
    } else if (this.sourceFormat === 'openai-responses') {
      const type = typeof event?.type === 'string' ? event.type : ''
      if (type === 'response.output_text.delta') return true
      if (type === 'response.content_part.delta') return true
      if (type === 'response.output_item.content_part.delta') return true
      return false
    }
    return false
  }

  /**
   * Extract usage statistics from event
   */
  private extractUsage(event: any): StreamMetadata['usage'] | null {
    if (this.sourceFormat === 'anthropic') {
      // Anthropic: message_delta or message_stop
      if (event.type === 'message_delta' || event.type === 'message_stop') {
        const u = event.usage
        if (u) {
          const result = {
            inputTokens: u.input_tokens,
            outputTokens: u.output_tokens,
            cacheReadTokens: u.cache_read_input_tokens || 0,
            cacheCreationTokens: u.cache_creation_input_tokens || 0
          }
          this.latestUsage = result
          return result
        }
      }
    } else {
      // OpenAI: usage field in various events
      const u = event.usage || event.choices?.[0]?.delta?.usage
      if (u) {
        const result = {
          inputTokens: u.prompt_tokens || u.input_tokens,
          outputTokens: u.completion_tokens || u.output_tokens,
          cacheReadTokens: u.cache_read_tokens || u.cached_tokens || 0,
          cacheCreationTokens: u.cache_creation_tokens || 0
        }
        this.latestUsage = result
        return result
      }
    }
    return null
  }

  /**
   * Extract stop reason from event
   */
  private extractStopReason(event: any): string | null {
    if (this.sourceFormat === 'anthropic') {
      if (event.type === 'message_delta' && event.delta?.stop_reason) {
        return event.delta.stop_reason
      }
    } else if (this.sourceFormat === 'openai-chat') {
      if (event.choices?.[0]?.finish_reason) {
        return event.choices[0].finish_reason
      }
    }
    return null
  }

  /**
   * Transform event from source format to target format
   * @returns Single event, array of events, or null
   */
  private transformEvent(event: any): any | any[] | null {
    if (this.sourceFormat === 'anthropic' && this.targetFormat === 'openai-chat') {
      return this.anthropicToOpenAIChat(event)
    } else if (this.sourceFormat === 'openai-chat' && this.targetFormat === 'anthropic') {
      return this.openAIChatToAnthropic(event)
    } else if (this.sourceFormat === 'anthropic' && this.targetFormat === 'openai-responses') {
      return this.anthropicToOpenAIResponses(event)
    } else if (this.sourceFormat === 'openai-responses' && this.targetFormat === 'anthropic') {
      return this.openAIResponsesToAnthropic(event)
    }
    // Pass through if no conversion needed
    return event
  }

  /**
   * Convert Anthropic SSE event to OpenAI Chat format
   */
  private anthropicToOpenAIChat(event: any): any | null {
    const type = event.type

    switch (type) {
      case 'message_start':
        // OpenAI doesn't have explicit message_start, skip
        return null

      case 'content_block_start':
        // Start of content block - may need to track for tool calls
        if (event.content_block?.type === 'tool_use') {
          this.currentToolCall = {
            id: event.content_block.id || `call_${this.contentBlockIndex}`,
            name: event.content_block.name || 'tool',
            arguments: ''
          }
          this.contentBlockIndex++
        }
        return null

      case 'content_block_delta':
        if (event.delta?.type === 'text_delta') {
          // Text content
          return {
            id: `chatcmpl_${Math.random().toString(36).slice(2)}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: this.model,
            choices: [{
              index: 0,
              delta: { content: event.delta.text },
              finish_reason: null
            }]
          }
        } else if (event.delta?.type === 'input_json_delta' && this.currentToolCall) {
          // Tool call arguments
          this.currentToolCall.arguments += event.delta.partial_json || ''
          return {
            id: `chatcmpl_${Math.random().toString(36).slice(2)}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: this.model,
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: 0,
                  id: this.currentToolCall.id,
                  type: 'function',
                  function: {
                    name: this.currentToolCall.name,
                    arguments: event.delta.partial_json || ''
                  }
                }]
              },
              finish_reason: null
            }]
          }
        }
        return null

      case 'content_block_stop':
        this.currentToolCall = null
        return null

      case 'message_delta':
        // Usage update, no output needed
        return null

      case 'message_stop':
        // Final chunk with finish_reason
        return {
          id: `chatcmpl_${Math.random().toString(36).slice(2)}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: this.model,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: this.mapAnthropicStopReason(event.delta?.stop_reason) || 'stop'
          }]
        }

      default:
        return null
    }
  }

  /**
   * Convert OpenAI Chat SSE event to Anthropic format
   * @returns Single event, array of events, or null
   */
  private openAIChatToAnthropic(event: any): any | any[] | null {
    const events: any[] = []

    // Send message_start if not yet sent
    if (!this.messageStartSent) {
      this.messageStartSent = true
      events.push({
        type: 'message_start',
        message: {
          id: event.id?.replace('chatcmpl_', 'msg_') || `msg_${Math.random().toString(36).slice(2)}`,
          type: 'message',
          role: 'assistant',
          model: this.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 }
        }
      })
    }

    const choice = event.choices?.[0]
    if (!choice) return events.length > 0 ? events : null

    const delta = choice.delta

    // Text content
    const resolveDeltaText = (value: unknown): string | null => {
      if (typeof value === 'string') return value
      if (!value) return null
      if (Array.isArray(value)) {
        const parts = value
          .map((item) => resolveDeltaText(item))
          .filter((part): part is string => typeof part === 'string' && part.length > 0)
        return parts.length ? parts.join('') : null
      }
      if (typeof value === 'object') {
        const record = value as Record<string, unknown>
        if (typeof record.text === 'string') return record.text
        if (record.content) return resolveDeltaText(record.content)
      }
      return null
    }

    const deltaText = resolveDeltaText(
      delta?.content ??
        delta?.reasoning_content ??
        choice?.message?.content ??
        choice?.message?.reasoning_content
    )
    if (deltaText) {
      if (!this.contentBlockStartSent) {
        // First content - send content_block_start
        this.contentBlockStartSent = true
        events.push({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' }
        })
      }
      events.push({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: deltaText }
      })
      return events.length > 0 ? events : null
    }

    // Tool calls
    if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
      for (const toolCall of delta.tool_calls) {
        const callIndex = toolCall.index ?? 0
        let state = this.openaiToolCalls.get(callIndex)

        // First time seeing this tool call - need to send content_block_start
        if (!state && toolCall.id) {
          const blockIndex = this.contentBlockIndex++
          state = {
            index: callIndex,
            id: toolCall.id,
            name: toolCall.function?.name || 'tool',
            blockIndex
          }
          this.openaiToolCalls.set(callIndex, state)

          events.push({
            type: 'content_block_start',
            index: blockIndex,
            content_block: {
              type: 'tool_use',
              id: toolCall.id,
              name: state.name
            }
          })
        }

        // Tool arguments delta
        if (state && toolCall.function?.arguments) {
          events.push({
            type: 'content_block_delta',
            index: state.blockIndex,
            delta: {
              type: 'input_json_delta',
              partial_json: toolCall.function.arguments
            }
          })
        }
      }

      if (events.length > 0) return events
    }

    // Legacy function_call (older OpenAI-compatible providers)
    const legacyCall = delta?.function_call ?? choice?.message?.function_call
    if (legacyCall && typeof legacyCall === 'object') {
      const callIndex = 0
      let state = this.openaiToolCalls.get(callIndex)
      if (!state) {
        const blockIndex = this.contentBlockIndex++
        state = {
          index: callIndex,
          id: `call_${blockIndex}`,
          name: legacyCall.name || 'tool',
          blockIndex
        }
        this.openaiToolCalls.set(callIndex, state)
        events.push({
          type: 'content_block_start',
          index: blockIndex,
          content_block: {
            type: 'tool_use',
            id: state.id,
            name: state.name
          }
        })
      }

      const args = legacyCall.arguments
      if (state && typeof args === 'string' && args.length > 0) {
        events.push({
          type: 'content_block_delta',
          index: state.blockIndex,
          delta: {
            type: 'input_json_delta',
            partial_json: args
          }
        })
      }

      if (events.length > 0) return events
    }

    // Finish reason
    if (choice.finish_reason) {
      this.finalized = true
      // Send content_block_stop for all active content blocks
      // 1. For text content blocks
      if (this.contentBlockStartSent) {
        events.push({
          type: 'content_block_stop',
          index: 0
        })
      }
      // 2. For tool_use content blocks
      for (const [_, state] of this.openaiToolCalls) {
        events.push({
          type: 'content_block_stop',
          index: state.blockIndex
        })
      }

      const deltaPayload: Record<string, unknown> = {
        stop_reason: this.mapOpenAIStopReason(choice.finish_reason) || 'end_turn',
        stop_sequence: null
      }
      if (this.latestUsage) {
        deltaPayload.usage = {
          cache_creation_input_tokens: this.latestUsage.cacheCreationTokens || 0,
          cache_read_input_tokens: this.latestUsage.cacheReadTokens || 0,
          input_tokens: this.latestUsage.inputTokens || 0,
          output_tokens: this.latestUsage.outputTokens || 0
        }
      }

      events.push({
        type: 'message_delta',
        delta: deltaPayload
      })

      events.push({
        type: 'message_stop'
      })
      return events.length > 0 ? events : null
    }

    return events.length > 0 ? events : null
  }

  private openAIResponsesToAnthropic(event: any): any[] | null {
    const events: any[] = []
    const type = typeof event?.type === 'string' ? event.type : ''

    if (!this.messageStartSent) {
      this.messageStartSent = true
      const idHint =
        typeof event?.response?.id === 'string'
          ? event.response.id
          : typeof event?.id === 'string'
          ? event.id
          : typeof event?.response_id === 'string'
          ? event.response_id
          : `resp_${Math.random().toString(36).slice(2)}`
      events.push({
        type: 'message_start',
        message: {
          id: idHint.replace(/^resp_/, 'msg_'),
          type: 'message',
          role: 'assistant',
          model: this.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 }
        }
      })
    }

    const ensureTextBlock = () => {
      if (!this.contentBlockStartSent) {
        this.contentBlockStartSent = true
        events.push({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' }
        })
      }
    }

    const pushTextDelta = (text: string) => {
      if (!text) return
      ensureTextBlock()
      events.push({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text }
      })
    }

    if (type === 'response.output_text.delta' && typeof event?.delta === 'string') {
      pushTextDelta(event.delta)
      return events.length ? events : null
    }

    if (type === 'response.content_part.delta') {
      const text = typeof event?.delta?.text === 'string' ? event.delta.text : null
      if (text) {
        pushTextDelta(text)
        return events.length ? events : null
      }
    }

    if (type === 'response.output_item.content_part.delta') {
      const text = typeof event?.delta?.text === 'string' ? event.delta.text : null
      if (text) {
        pushTextDelta(text)
        return events.length ? events : null
      }
    }

    if (type === 'response.output_item.added') {
      const item = event?.item
      const itemId = typeof item?.id === 'string' ? item.id : null
      const name = typeof item?.name === 'string' ? item.name : null
      if (itemId && name) {
        this.responsesToolNames.set(itemId, name)
      }
      return events.length ? events : null
    }

    if (type === 'response.function_call_arguments.delta') {
      const itemId = typeof event?.item_id === 'string' ? event.item_id : null
      const delta = typeof event?.delta === 'string' ? event.delta : null
      if (!itemId || !delta) return events.length ? events : null

      let state = this.openaiToolCalls.get(0)
      if (!state) {
        const blockIndex = this.contentBlockIndex++
        state = {
          index: 0,
          id: itemId,
          name: this.responsesToolNames.get(itemId) ?? 'tool',
          blockIndex
        }
        this.openaiToolCalls.set(0, state)
        events.push({
          type: 'content_block_start',
          index: blockIndex,
          content_block: {
            type: 'tool_use',
            id: state.id,
            name: state.name
          }
        })
      }

      events.push({
        type: 'content_block_delta',
        index: state.blockIndex,
        delta: {
          type: 'input_json_delta',
          partial_json: delta
        }
      })

      return events.length ? events : null
    }

    if (type === 'response.completed' || type === 'response.done') {
      this.finalized = true
      if (this.contentBlockStartSent) {
        events.push({
          type: 'content_block_stop',
          index: 0
        })
      }
      for (const [_, state] of this.openaiToolCalls) {
        events.push({
          type: 'content_block_stop',
          index: state.blockIndex
        })
      }

      const deltaPayload: Record<string, unknown> = {
        stop_reason: 'end_turn',
        stop_sequence: null
      }
      if (this.latestUsage) {
        deltaPayload.usage = {
          cache_creation_input_tokens: this.latestUsage.cacheCreationTokens || 0,
          cache_read_input_tokens: this.latestUsage.cacheReadTokens || 0,
          input_tokens: this.latestUsage.inputTokens || 0,
          output_tokens: this.latestUsage.outputTokens || 0
        }
      }

      events.push({
        type: 'message_delta',
        delta: deltaPayload
      })

      events.push({
        type: 'message_stop'
      })
      return events.length ? events : null
    }

    return events.length ? events : null
  }

  /**
   * Convert Anthropic SSE event to OpenAI Responses format
   */
  private anthropicToOpenAIResponses(event: any): any | null {
    const type = event.type

    // Initialize state on first event
    if (!this.responsesState) {
      this.responsesState = {
        responseId: `resp_${Math.random().toString(36).slice(2)}`,
        outputId: `out_${Math.random().toString(36).slice(2)}`,
        createdSent: false,
        accumulatedText: '',
        contentBlocks: [],
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0
        }
      }
    }

    const nowSeconds = () => Math.floor(Date.now() / 1000)

    switch (type) {
      case 'message_start': {
        // Extract message ID if available
        const messageId = event.message?.id
        if (messageId && typeof messageId === 'string') {
          this.responsesState.responseId = messageId.replace(/^msg_/, 'resp_')
          this.responsesState.outputId = `out_${this.responsesState.responseId.slice(5)}`
        }

        // Send response.created event
        if (!this.responsesState.createdSent) {
          this.responsesState.createdSent = true
          return {
            id: this.responsesState.responseId,
            object: 'response',
            created: nowSeconds(),
            model: this.model,
            type: 'response.created'
          }
        }
        return null
      }

      case 'content_block_start': {
        const block = event.content_block
        if (!block || typeof block !== 'object') return null

        // Ensure created event was sent
        if (!this.responsesState.createdSent) {
          this.responsesState.createdSent = true
          // Should send created first, but for simplicity we'll skip if not sent
        }

        // Track content block
        const blockData: any = {
          id: block.id || `block_${event.index}`,
          type: block.type === 'text' ? 'output_text' : block.type,
          index: event.index ?? this.contentBlockIndex
        }
        if (block.type === 'text') {
          blockData.text = ''
        } else if (block.type === 'tool_use') {
          blockData.name = block.name
          blockData.input = {}
          blockData._inputJson = '' // Accumulate JSON string for parsing later
        }
        this.responsesState.contentBlocks.push(blockData)

        // Send output_item.added event
        return {
          id: this.responsesState.responseId,
          object: 'response',
          type: 'response.output_item.added',
          output_item: {
            id: this.responsesState.outputId,
            type: blockData.type,
            index: blockData.index
          }
        }
      }

      case 'content_block_delta': {
        if (event.delta?.type === 'text_delta') {
          // Accumulate text
          const text = event.delta.text || ''
          this.responsesState.accumulatedText += text

          // Update corresponding content block
          const blockIndex = event.index ?? 0
          if (this.responsesState.contentBlocks[blockIndex]) {
            this.responsesState.contentBlocks[blockIndex].text =
              (this.responsesState.contentBlocks[blockIndex].text || '') + text
          }

          // Text content delta
          return {
            id: this.responsesState.responseId,
            object: 'response',
            type: 'response.output_item.content_part.delta',
            output_item_id: this.responsesState.outputId,
            index: event.index ?? 0,
            delta: {
              type: 'text_delta',
              text
            }
          }
        } else if (event.delta?.type === 'input_json_delta') {
          // Tool use delta - accumulate JSON string
          const blockIndex = event.index ?? 0
          const partialJson = event.delta.partial_json || ''

          // Accumulate to content block
          if (this.responsesState.contentBlocks[blockIndex]) {
            this.responsesState.contentBlocks[blockIndex]._inputJson =
              (this.responsesState.contentBlocks[blockIndex]._inputJson || '') + partialJson
          }

          return {
            id: this.responsesState.responseId,
            object: 'response',
            type: 'response.output_item.content_part.delta',
            output_item_id: this.responsesState.outputId,
            index: event.index ?? 0,
            delta: {
              type: 'input_json_delta',
              partial_json: partialJson
            }
          }
        }
        return null
      }

      case 'content_block_stop':
        // Output item completed
        return null

      case 'message_delta': {
        // Accumulate usage if available
        if (event.usage) {
          if (event.usage.input_tokens !== undefined) {
            this.responsesState.usage.inputTokens = event.usage.input_tokens
          }
          if (event.usage.output_tokens !== undefined) {
            this.responsesState.usage.outputTokens = event.usage.output_tokens
          }
          if (event.usage.cache_read_input_tokens !== undefined) {
            this.responsesState.usage.cacheReadTokens = event.usage.cache_read_input_tokens
          }
          if (event.usage.cache_creation_input_tokens !== undefined) {
            this.responsesState.usage.cacheCreationTokens = event.usage.cache_creation_input_tokens
          }
        }
        // No output for message_delta (usage is tracked internally)
        return null
      }

      case 'message_stop': {
        // Send response.completed event with full structure
        const stopReason = event.delta?.stop_reason
        const status = this.mapAnthropicStopReasonToStatus(stopReason)

        const usage = this.responsesState.usage
        const usagePayload: any = {
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
          total_tokens: usage.inputTokens + usage.outputTokens,
          prompt_tokens: usage.inputTokens,
          completion_tokens: usage.outputTokens
        }
        const cachedTotal = usage.cacheReadTokens + usage.cacheCreationTokens
        if (cachedTotal > 0) {
          usagePayload.cached_tokens = cachedTotal
        }

        // Parse accumulated tool_use input JSON strings
        const finalContentBlocks = this.responsesState.contentBlocks.map(block => {
          if (block.type === 'tool_use' && block._inputJson) {
            try {
              block.input = JSON.parse(block._inputJson)
            } catch {
              // If parse fails, keep empty object
              block.input = {}
            }
            // Remove internal field
            delete block._inputJson
          }
          return block
        })

        const responsePayload: any = {
          id: this.responsesState.responseId,
          object: 'response',
          type: 'response.completed',
          status,
          status_code: 200,
          stop_reason: stopReason,
          usage: usagePayload,
          response: {
            id: this.responsesState.responseId,
            type: 'message',
            role: 'assistant',
            content: finalContentBlocks
          },
          output: [{
            id: this.responsesState.outputId,
            type: 'output_message',
            role: 'assistant',
            content: finalContentBlocks
          }]
        }

        if (this.responsesState.accumulatedText) {
          responsePayload.output_text = this.responsesState.accumulatedText
        }

        return responsePayload
      }

      default:
        return null
    }
  }

  /**
   * Map Anthropic stop_reason to OpenAI Response status
   */
  private mapAnthropicStopReasonToStatus(reason: string | null | undefined): string {
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
   * Map Anthropic stop_reason to OpenAI finish_reason
   */
  private mapAnthropicStopReason(reason: string | null | undefined): string | null {
    switch (reason) {
      case 'tool_use': return 'tool_calls'
      case 'max_tokens': return 'length'
      case 'stop_sequence': return 'stop'
      case 'end_turn': return 'stop'
      default: return reason ?? null
    }
  }

  /**
   * Map OpenAI finish_reason to Anthropic stop_reason
   */
  private mapOpenAIStopReason(reason: string | null | undefined): string | null {
    switch (reason) {
      case 'tool_calls': return 'tool_use'
      case 'length': return 'max_tokens'
      case 'stop': return 'end_turn'
      default: return reason ?? null
    }
  }

  /**
   * Get final accumulated usage statistics
   */
  getFinalUsage(): AccumulatedUsage {
    return { ...this.usage }
  }
}
