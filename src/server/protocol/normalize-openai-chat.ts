import type { NormalizedMessage, NormalizedPayload } from './types.js'

function coerceArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function stringifyContent(content: any): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (item == null) return ''
        if (typeof item === 'string') return item
        if (typeof item === 'object') {
          if (typeof item.text === 'string') return item.text
          if (typeof item.content === 'string') return item.content
        }
        return ''
      })
      .filter(Boolean)
      .join('')
  }
  if (typeof content === 'object') {
    if (typeof content.text === 'string') return content.text
    if (typeof content.content === 'string') return content.content
  }
  return ''
}

function parseJsonSafely(value: string): any {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function normalizeToolResult(message: any): NormalizedMessage['toolResults'] {
  const results: NonNullable<NormalizedMessage['toolResults']> = []
  const id =
    typeof message.tool_call_id === 'string'
      ? message.tool_call_id
      : typeof message.id === 'string'
      ? message.id
      : `tool_result_${Math.random().toString(36).slice(2)}`
  const contentValue =
    typeof message.content === 'string'
      ? parseJsonSafely(message.content)
      : Array.isArray(message.content)
      ? message.content
          .map((item: any) => (typeof item === 'string' ? item : item?.text ?? ''))
          .filter((item: string) => item.length > 0)
          .join('')
      : message.content ?? null
  results.push({
    id,
    name: typeof message.name === 'string' ? message.name : undefined,
    content: contentValue,
    cacheControl: message.cache_control
  })
  return results
}

function normalizeToolCalls(message: any): NormalizedMessage['toolCalls'] {
  const calls: NonNullable<NormalizedMessage['toolCalls']> = []
  const array = coerceArray<any>(message.tool_calls)
  if (array.length > 0) {
    for (const item of array) {
      if (!item || typeof item !== 'object') continue
      const functionPayload = item.function ?? item
      const args = functionPayload?.arguments
      calls.push({
        id:
          typeof item.id === 'string'
            ? item.id
            : `tool_call_${Math.random().toString(36).slice(2)}`,
        name:
          typeof functionPayload?.name === 'string'
            ? functionPayload.name
            : typeof item.name === 'string'
            ? item.name
            : 'tool',
        arguments:
          typeof args === 'string'
            ? (() => {
                try {
                  return JSON.parse(args)
                } catch {
                  return args
                }
              })()
            : args ?? {},
        cacheControl: item.cache_control
      })
    }
  } else if (message.function_call && typeof message.function_call === 'object') {
    const fn = message.function_call
    calls.push({
      id: `tool_call_${Math.random().toString(36).slice(2)}`,
      name: typeof fn.name === 'string' ? fn.name : 'tool',
      arguments:
        typeof fn.arguments === 'string'
          ? (() => {
              try {
                return JSON.parse(fn.arguments)
              } catch {
                return fn.arguments
              }
            })()
          : fn.arguments ?? {}
    })
  }
  return calls.length > 0 ? calls : undefined
}

function normalizeMessages(payload: any): { system: string | null; messages: NormalizedMessage[] } {
  const sourceMessages = coerceArray<any>(payload?.messages)
  const systemParts: string[] = []
  const normalized: NormalizedMessage[] = []

  const pushMessage = (message: NormalizedMessage) => {
    normalized.push(message)
  }

  for (const item of sourceMessages) {
    if (!item || typeof item !== 'object') continue
    const role = typeof item.role === 'string' ? item.role : 'user'

    if (role === 'system') {
      const text = stringifyContent(item.content)
      if (text) systemParts.push(text)
      continue
    }

    if (role === 'tool') {
      const toolResults = normalizeToolResult(item)
      pushMessage({
        role: 'user',
        text: '',
        toolResults
      })
      continue
    }

    if (role === 'assistant') {
      const text = stringifyContent(item.content)
      const toolCalls = normalizeToolCalls(item)
      pushMessage({
        role: 'assistant',
        text,
        toolCalls
      })
      continue
    }

    const text = stringifyContent(item.content ?? item.message ?? item.text)
    pushMessage({
      role: 'user',
      text
    })
  }

  const system =
    systemParts
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join('\n\n') || null

  return { system, messages: normalized }
}

export function normalizeOpenAIChatPayload(payload: any): NormalizedPayload {
  const { system, messages } = normalizeMessages(payload)
  const stream = Boolean(payload?.stream)
  const thinking = Boolean(payload?.reasoning ?? payload?.thinking)

  const tools = (() => {
    if (Array.isArray(payload?.tools)) {
      return payload.tools
    }
    if (Array.isArray(payload?.functions)) {
      return payload.functions.map((fn: any) => ({
        name: fn?.name,
        description: fn?.description,
        parameters: fn?.parameters ?? {}
      }))
    }
    return []
  })()

  return {
    original: payload,
    system,
    messages,
    tools,
    stream,
    thinking
  }
}
