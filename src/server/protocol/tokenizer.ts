import { encoding_for_model } from 'tiktoken'
import type { NormalizedPayload } from './types'

function getEncoder(model: string) {
  try {
    return encoding_for_model(model)
  } catch {
    return encoding_for_model('gpt-3.5-turbo')
  }
}

export function estimateTextTokens(text: string | null | undefined, model: string): number {
  if (!text) return 0
  try {
    const encoder = getEncoder(model)
    return encoder.encode(text).length
  } catch {
    return Math.ceil(text.length / 4)
  }
}

export function estimateTokens(payload: NormalizedPayload, model: string): number {
  try {
    const encoder = getEncoder(model)
    let total = 0
    if (payload.system) {
      total += encoder.encode(payload.system).length
    }
    for (const message of payload.messages) {
      if (message.text) {
        total += encoder.encode(message.text).length
      }
      if (message.toolCalls) {
        for (const call of message.toolCalls) {
          total += encoder.encode(JSON.stringify(call.arguments ?? {})).length
        }
      }
      if (message.toolResults) {
        for (const result of message.toolResults) {
          total += encoder.encode(JSON.stringify(result.content ?? '')).length
        }
      }
    }
    return total
  } catch {
    // fallback rough estimate
    const text = [payload.system ?? '', ...payload.messages.map((m) => m.text ?? '')].join('\n')
    return Math.ceil(text.length / 4)
  }
}
