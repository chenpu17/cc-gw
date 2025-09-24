import { describe, expect, it } from 'vitest'
import type { NormalizedPayload } from '../../src/server/protocol/types.ts'
import { buildAnthropicBody } from '../../src/server/protocol/toProvider.ts'

describe('buildAnthropicBody', () => {
  it('converts normalized payload into Anthropic message body', () => {
    const payload: NormalizedPayload = {
      original: {},
      system: 'system guidelines',
      stream: false,
      thinking: false,
      tools: [
        {
          name: 'fetchData',
          description: 'Fetch sample data',
          input_schema: {
            type: 'object',
            properties: {
              id: { type: 'string' }
            }
          }
        }
      ],
      messages: [
        {
          role: 'user',
          text: 'hello agent',
          toolResults: [
            {
              id: 'tool-1',
              content: { result: 'ok' }
            }
          ]
        },
        {
          role: 'assistant',
          text: '',
          toolCalls: [
            {
              id: 'call-1',
              name: 'fetchData',
              arguments: { id: '42' }
            }
          ]
        }
      ]
    }

    const body = buildAnthropicBody(payload, {
      maxTokens: 2048,
      temperature: 0.2,
      toolChoice: { type: 'auto' }
    })

    expect(body.system).toBe('system guidelines')
    expect(body.max_tokens).toBe(2048)
    expect(body.temperature).toBe(0.2)
    expect(body.tool_choice).toEqual({ type: 'auto' })
    expect(body.tools).toEqual([
      {
        type: 'tool',
        name: 'fetchData',
        description: 'Fetch sample data',
        input_schema: {
          type: 'object',
          properties: {
            id: { type: 'string' }
          }
        }
      }
    ])

    const [userMessage, assistantMessage] = body.messages
    expect(userMessage.role).toBe('user')
    expect(userMessage.content).toHaveLength(2)
    expect(userMessage.content[0]).toEqual({ type: 'text', text: 'hello agent' })
    expect(userMessage.content[1]).toEqual({
      type: 'tool_result',
      tool_use_id: 'tool-1',
      content: [{ type: 'text', text: '{"result":"ok"}' }]
    })

    expect(assistantMessage.role).toBe('assistant')
    expect(assistantMessage.content).toHaveLength(1)
    expect(assistantMessage.content[0]).toEqual({
      type: 'tool_use',
      id: 'call-1',
      name: 'fetchData',
      input: { id: '42' }
    })
  })
})
