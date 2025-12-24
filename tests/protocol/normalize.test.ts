import { describe, expect, it } from 'vitest'
import { normalizeClaudePayload } from '../../src/server/protocol/normalize.ts'

describe('normalizeClaudePayload', () => {
  it('merges system prompts and flattens message content', () => {
    const payload = {
      system: 'global instructions',
      stream: true,
      thinking: true,
      messages: [
        { role: 'system', content: 'module instructions' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is the weather?' },
            { type: 'tool_result', tool_use_id: 'tool-1', content: 'sunny' }
          ]
        },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'It is sunny today.' },
            { type: 'tool_use', id: 'call-1', name: 'getWeather', input: { city: 'Shanghai' } }
          ]
        }
      ],
      tools: [{ name: 'getWeather', input_schema: {} }]
    }

    const result = normalizeClaudePayload(payload)

    expect(result.system).toBe('global instructions\n\nmodule instructions')
    expect(result.stream).toBe(true)
    expect(result.thinking).toBe(true)
    expect(result.tools).toEqual([{ name: 'getWeather', input_schema: {} }])
    expect(result.messages).toHaveLength(2)

    const [userMessage, assistantMessage] = result.messages
    expect(userMessage).toMatchObject({
      role: 'user',
      text: 'What is the weather?',
      toolResults: [
        {
          id: 'tool-1',
          content: 'sunny'
        }
      ]
    })

    expect(assistantMessage).toMatchObject({
      role: 'assistant',
      text: 'It is sunny today.',
      toolCalls: [
        {
          id: 'call-1',
          name: 'getWeather',
          arguments: { city: 'Shanghai' }
        }
      ]
    })
  })

  it('supports input_text/output_text blocks used by Claude Code', () => {
    const payload = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'hello' }
          ]
        },
        {
          role: 'assistant',
          content: [
            { type: 'output_text', text: 'hi there' }
          ]
        }
      ]
    }

    const normalized = normalizeClaudePayload(payload)
    expect(normalized.messages).toEqual([
      { role: 'user', text: 'hello', toolResults: [] },
      { role: 'assistant', text: 'hi there', toolCalls: [] }
    ])
  })

  it('defaults unknown roles to user and handles scalar content', () => {
    const payload = {
      messages: [
        { role: 'developer', content: 'add safety checks' },
        { role: 'tool', content: { text: 'tool output' } },
        { role: 'user', content: 'plain question' }
      ]
    }

    const normalized = normalizeClaudePayload(payload)
    expect(normalized.system).toBe('add safety checks')
    expect(normalized.messages).toEqual([
      { role: 'user', text: 'tool output' },
      { role: 'user', text: 'plain question' }
    ])
  })
})
