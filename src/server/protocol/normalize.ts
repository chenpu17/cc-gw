import type { ClaudeMessage, NormalizedPayload } from './types.js'

function extractText(content: any): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object') {
          if ((item.type === 'text' || item.type === 'input_text' || item.type === 'output_text') && item.text) return item.text
          if (item.content) return extractText(item.content)
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (typeof content === 'object') {
    if (content.text) return content.text
    if (content.content) return extractText(content.content)
  }
  return ''
}

function normalizeSystem(messages: ClaudeMessage[], systemField: any): { system: string | null; remaining: ClaudeMessage[] } {
  const systemParts: string[] = []
  if (Array.isArray(systemField)) {
    systemParts.push(...systemField.map((item) => extractText(item)))
  } else if (typeof systemField === 'string') {
    systemParts.push(systemField)
  } else if (systemField) {
    systemParts.push(extractText(systemField))
  }

  const remaining: ClaudeMessage[] = []
  for (const msg of messages) {
    if (msg.role === 'system' || msg.role === 'developer') {
      const text = extractText(msg.content)
      if (text) systemParts.push(text)
      continue
    }
    remaining.push(msg)
  }

  const system = systemParts.filter((part) => part && part.trim().length > 0).join('\n\n') || null
  return { system, remaining }
}

export function normalizeClaudePayload(payload: any): NormalizedPayload {
  const stream = Boolean(payload.stream)
  const thinking = Boolean(payload.thinking)
  const messages: ClaudeMessage[] = Array.isArray(payload.messages)
    ? payload.messages
    : payload.messages
    ? [payload.messages]
    : []

  const { system, remaining } = normalizeSystem(messages, payload.system)

  const normalizedMessages = remaining.map((msg) => {
    if (msg.role === 'user') {
      if (Array.isArray(msg.content)) {
        const textParts: string[] = []
        const toolResults: NormalizedPayload['messages'][number]['toolResults'] = []
        for (const block of msg.content) {
          if ((block.type === 'text' || block.type === 'input_text') && block.text) {
            textParts.push(block.text)
          } else if (block.type === 'tool_result') {
            toolResults.push({
              id: block.tool_use_id || block.id || 'tool_result',
              name: block.name,
              content: block.content ?? block.text ?? null,
              cacheControl: block.cache_control
            })
          }
        }
        return {
          role: 'user' as const,
          text: textParts.join('\n'),
          toolResults
        }
      }
      return {
        role: 'user' as const,
        text: extractText(msg.content)
      }
    }

    if (msg.role === 'assistant') {
      const toolCalls: NormalizedPayload['messages'][number]['toolCalls'] = []
      let text = ''
      if (Array.isArray(msg.content)) {
        const textParts: string[] = []
        for (const block of msg.content) {
          if ((block.type === 'text' || block.type === 'output_text') && block.text) {
            textParts.push(block.text)
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id || `call_${Math.random().toString(36).slice(2)}`,
              name: block.name ?? 'tool',
              arguments: block.input,
              cacheControl: block.cache_control
            })
          }
        }
        text = textParts.join('\n')
      } else if (typeof msg.content === 'string') {
        text = msg.content
      }
      return {
        role: 'assistant' as const,
        text,
        toolCalls
      }
    }

    return {
      role: 'user' as const,
      text: extractText(msg.content)
    }
  })

  return {
    original: payload,
    system,
    messages: normalizedMessages,
    tools: Array.isArray(payload.tools) ? payload.tools : [],
    stream,
    thinking
  }
}
