import { describe, expect, it } from 'vitest'
import { convertAnthropicToolChoiceToOpenAI } from '../../src/server/protocol/tool-choice.ts'

describe('convertAnthropicToolChoiceToOpenAI', () => {
  it('maps common string variants', () => {
    expect(convertAnthropicToolChoiceToOpenAI('auto')).toBe('auto')
    expect(convertAnthropicToolChoiceToOpenAI('none')).toBe('none')
    expect(convertAnthropicToolChoiceToOpenAI('required')).toBe('auto')
    expect(convertAnthropicToolChoiceToOpenAI('any')).toBe('auto')
  })

  it('maps anthropic tool selection objects', () => {
    expect(convertAnthropicToolChoiceToOpenAI({ type: 'auto' })).toBe('auto')
    expect(convertAnthropicToolChoiceToOpenAI({ type: 'none' })).toBe('none')
    expect(convertAnthropicToolChoiceToOpenAI({ type: 'any' })).toBe('auto')
    expect(convertAnthropicToolChoiceToOpenAI({ type: 'required' })).toBe('auto')
    expect(convertAnthropicToolChoiceToOpenAI({ type: 'tool', name: 'getWeather' })).toEqual({
      type: 'function',
      function: { name: 'getWeather' }
    })
  })

  it('returns undefined for unsupported payloads', () => {
    expect(convertAnthropicToolChoiceToOpenAI(undefined)).toBe(undefined)
    expect(convertAnthropicToolChoiceToOpenAI(null)).toBe(undefined)
    expect(convertAnthropicToolChoiceToOpenAI(123)).toBe(undefined)
    expect(convertAnthropicToolChoiceToOpenAI({ type: 'tool' })).toBe(undefined)
    expect(convertAnthropicToolChoiceToOpenAI({ type: 'unknown' })).toBe(undefined)
  })
})

