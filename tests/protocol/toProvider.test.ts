import { describe, expect, it } from 'vitest'
import { buildProviderBody } from '../../src/server/protocol/toProvider.ts'
import type { NormalizedPayload } from '../../src/server/protocol/types.ts'

function makePayload(overrides: Partial<NormalizedPayload> = {}): NormalizedPayload {
  return {
    original: overrides.original ?? {},
    system: overrides.system ?? null,
    messages: overrides.messages ?? [{ role: 'user', text: 'hello' }],
    tools: overrides.tools ?? [],
    stream: overrides.stream ?? false,
    thinking: overrides.thinking ?? false
  }
}

describe('buildProviderBody', () => {
  it('passes max_tokens normally', () => {
    const body = buildProviderBody(makePayload(), { maxTokens: 1024 })
    expect(body.max_tokens).toBe(1024)
    expect(body).not.toHaveProperty('max_completion_tokens')
  })

  it('does not skip maxTokens: 0 (uses != null check)', () => {
    const body = buildProviderBody(makePayload(), { maxTokens: 0 })
    expect(body.max_tokens).toBe(0)
  })

  it('uses max_completion_tokens when thinking is true', () => {
    const body = buildProviderBody(makePayload({ thinking: true }), { maxTokens: 2048 })
    expect(body.max_completion_tokens).toBe(2048)
    expect(body).not.toHaveProperty('max_tokens')
  })

  it('passes temperature', () => {
    const body = buildProviderBody(makePayload(), { temperature: 0.7 })
    expect(body.temperature).toBe(0.7)
  })

  it('converts tools from input_schema to parameters format', () => {
    const payload = makePayload({
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather',
          input_schema: { type: 'object', properties: { city: { type: 'string' } } }
        }
      ]
    })
    const body = buildProviderBody(payload)
    expect(body.tools).toHaveLength(1)
    expect(body.tools![0]).toEqual({
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get weather',
        parameters: { type: 'object', properties: { city: { type: 'string' } } }
      }
    })
  })

  it('prefers overrideTools over payload.tools', () => {
    const payload = makePayload({
      tools: [{ name: 'a', description: 'a', input_schema: {} }]
    })
    const overrideTools = [{ name: 'b', description: 'b', parameters: { type: 'object' } }]
    const body = buildProviderBody(payload, { overrideTools })
    expect(body.tools).toHaveLength(1)
    expect(body.tools![0].function.name).toBe('b')
  })

  it('passes toolChoice', () => {
    const body = buildProviderBody(makePayload(), { toolChoice: 'auto' })
    expect(body.tool_choice).toBe('auto')
  })

  it('passes through response_format, top_p, stop, seed from original', () => {
    const payload = makePayload({
      original: {
        response_format: { type: 'json_object' },
        top_p: 0.9,
        stop: ['\n'],
        seed: 42
      }
    })
    const body = buildProviderBody(payload) as any
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.top_p).toBe(0.9)
    expect(body.stop).toEqual(['\n'])
    expect(body.seed).toBe(42)
  })

  it('passes metadata for openai provider type', () => {
    const payload = makePayload({
      original: { metadata: { user_id: 'u1' } }
    })
    const body = buildProviderBody(payload, { providerType: 'openai' }) as any
    expect(body.metadata).toEqual({ user_id: 'u1' })
  })

  it('does not pass metadata for custom provider type', () => {
    const payload = makePayload({
      original: { metadata: { user_id: 'u1' } }
    })
    const body = buildProviderBody(payload, { providerType: 'custom' }) as any
    expect(body).not.toHaveProperty('metadata')
  })

  it('does not generate extra fields when no options provided', () => {
    const body = buildProviderBody(makePayload())
    expect(body).not.toHaveProperty('max_tokens')
    expect(body).not.toHaveProperty('max_completion_tokens')
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('tool_choice')
    expect(body).not.toHaveProperty('tools')
    expect(body).not.toHaveProperty('metadata')
  })
})
