import type { NormalizedMessage, NormalizedPayload } from './types.js'

function coerceArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function extractTextFromContent(content: any): {
  text: string
  toolResults: NormalizedMessage['toolResults']
  toolCalls: NormalizedMessage['toolCalls']
} {
  const textParts: string[] = []
  const toolResults: NonNullable<NormalizedMessage['toolResults']> = []
  const toolCalls: NonNullable<NormalizedMessage['toolCalls']> = []

  const blocks = coerceArray<any>(content)
  for (const block of blocks) {
    if (!block || typeof block !== 'object') {
      if (typeof block === 'string') {
        textParts.push(block)
      }
      continue
    }

    const type = block.type ?? block.kind ?? block.role
    const textValue = typeof block.text === 'string'
      ? block.text
      : typeof block.value === 'string'
      ? block.value
      : typeof block.content === 'string'
      ? block.content
      : ''

    if (type === 'text' || type === 'input_text' || type === 'output_text') {
      if (textValue) {
        textParts.push(textValue)
      }
      continue
    }

    if (type === 'tool_result' || type === 'function_result') {
      toolResults.push({
        id: typeof block.tool_call_id === 'string'
          ? block.tool_call_id
          : typeof block.id === 'string'
          ? block.id
          : `tool_result_${Math.random().toString(36).slice(2)}`,
        name: typeof block.name === 'string' ? block.name : undefined,
        content: block.result ?? block.output ?? block.content ?? textValue ?? null,
        cacheControl: block.cache_control
      })
      continue
    }

    if (type === 'tool_use' || type === 'function_call') {
      toolCalls.push({
        id: typeof block.id === 'string' ? block.id : `tool_call_${Math.random().toString(36).slice(2)}`,
        name: typeof block.name === 'string'
          ? block.name
          : block.function?.name
          ? block.function.name
          : 'tool',
        arguments: block.arguments ?? block.input ?? block.function?.arguments ?? {},
        cacheControl: block.cache_control
      })
      continue
    }
  }

  return {
    text: textParts.join('\n'),
    toolResults: toolResults.length > 0 ? toolResults : undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined
  }
}

function mapInputToMessages(payload: any): {
  messages: NormalizedMessage[]
  system: string | null
} {
  const messages: NormalizedMessage[] = []
  const systemParts: string[] = []

  const inputItems = coerceArray<any>(payload?.input ?? payload?.messages)
  for (const item of inputItems) {
    if (item == null) continue

    if (typeof item === 'string') {
      messages.push({
        role: 'user',
        text: item
      })
      continue
    }

    if (typeof item !== 'object') continue

    const role =
      item.role === 'assistant' || item.role === 'system'
        ? item.role
        : item.role === 'developer'
        ? 'system'
        : 'user'

    if (role === 'system') {
      const parts = extractTextFromContent(item.content)
      if (parts.text) {
        systemParts.push(parts.text)
      }
      continue
    }

    const { text, toolResults, toolCalls } = extractTextFromContent(item.content)

    const normalized: NormalizedMessage = {
      role: role === 'assistant' ? 'assistant' : 'user',
      text
    }

    if (role === 'user' && toolResults) {
      normalized.toolResults = toolResults
    }

    if (role === 'assistant') {
      const inlineToolCalls = coerceArray<any>(item.tool_calls)
      if (inlineToolCalls.length > 0) {
        normalized.toolCalls = inlineToolCalls.map((call: any) => ({
          id: typeof call.id === 'string' ? call.id : `tool_call_${Math.random().toString(36).slice(2)}`,
          name: call.function?.name ?? call.name ?? 'tool',
          arguments: (() => {
            if (typeof call.function?.arguments === 'string') {
              try {
                return JSON.parse(call.function.arguments)
              } catch {
                return call.function.arguments
              }
            }
            return call.arguments ?? call.input ?? {}
          })(),
          cacheControl: call.cache_control
        }))
      } else if (toolCalls) {
        normalized.toolCalls = toolCalls
      }
    }

    messages.push(normalized)
  }

  const extraInstructions = coerceArray<any>(payload?.instructions)
  for (const instruction of extraInstructions) {
    if (typeof instruction === 'string') {
      if (instruction.trim().length > 0) {
        systemParts.push(instruction.trim())
      }
      continue
    }
    if (instruction && typeof instruction === 'object') {
      const parts = extractTextFromContent(instruction)
      if (parts.text) {
        systemParts.push(parts.text)
      }
    }
  }

  const system = systemParts.length > 0 ? systemParts.join('\n\n') : null
  return { messages, system }
}

export function normalizeOpenAIResponsesPayload(payload: any): NormalizedPayload {
  const stream = Boolean(payload?.stream)
  const thinking = Boolean(payload?.reasoning ?? payload?.thinking)

  const { messages, system } = mapInputToMessages(payload)

  const toolsArray = coerceArray<any>(payload?.tools)

  return {
    original: payload,
    system,
    messages,
    tools: toolsArray,
    stream,
    thinking
  }
}
