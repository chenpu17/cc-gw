import type { NormalizedPayload } from './types.js'
import { mergeText, stringifyToolContent } from './contentHelpers.js'

export function stripTooling(payload: NormalizedPayload): NormalizedPayload {
  const messages = payload.messages.map((message) => {
    if (message.role === 'user') {
      const extras = (message.toolResults ?? []).map((result) => {
        const label = result.name || result.id
        const content = stringifyToolContent(result.content)
        return label ? `${label}${content ? `\n${content}` : ''}` : content
      })
      return {
        role: message.role,
        text: mergeText(message.text, extras)
      }
    }

    if (message.role === 'assistant') {
      const extras = (message.toolCalls ?? []).map((call) => {
        const label = call.name || call.id
        const args = stringifyToolContent(call.arguments)
        return label ? `Requested tool ${label}${args ? `\n${args}` : ''}` : args
      })
      return {
        role: message.role,
        text: mergeText(message.text, extras)
      }
    }

    return {
      role: message.role,
      text: message.text
    }
  })

  return {
    ...payload,
    messages,
    tools: []
  }
}

export function stripMetadata(payload: NormalizedPayload): NormalizedPayload {
  const original = payload.original
  if (!original || typeof original !== 'object') {
    return payload
  }
  const { metadata, ...rest } = original as Record<string, unknown>
  return {
    ...payload,
    original: rest
  }
}

