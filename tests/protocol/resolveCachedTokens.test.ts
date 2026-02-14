import { describe, expect, it } from 'vitest'
import { resolveCachedTokens } from '../../src/server/routes/custom-endpoint.ts'

describe('resolveCachedTokens', () => {
  it('parses Anthropic format: cache_read_input_tokens + cache_creation_input_tokens', () => {
    const result = resolveCachedTokens({
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 50
    })
    expect(result).toEqual({ read: 100, creation: 50 })
  })

  it('parses OpenAI format: cached_tokens', () => {
    const result = resolveCachedTokens({ cached_tokens: 200 })
    expect(result).toEqual({ read: 200, creation: 0 })
  })

  it('parses OpenAI detailed format: prompt_tokens_details.cached_tokens', () => {
    const result = resolveCachedTokens({
      prompt_tokens_details: { cached_tokens: 300 }
    })
    expect(result).toEqual({ read: 300, creation: 0 })
  })

  it('parses OpenAI responses detailed format: input_tokens_details.cached_tokens', () => {
    const result = resolveCachedTokens({
      input_tokens_details: { cached_tokens: 260 }
    })
    expect(result).toEqual({ read: 260, creation: 0 })
  })

  it('prefers OpenAI detailed format over flat cached_tokens', () => {
    const result = resolveCachedTokens({
      cached_tokens: 100,
      prompt_tokens_details: { cached_tokens: 300 }
    })
    expect(result).toEqual({ read: 300, creation: 0 })
  })

  it('Anthropic fields take priority over OpenAI fields', () => {
    const result = resolveCachedTokens({
      cache_read_input_tokens: 150,
      cache_creation_input_tokens: 25,
      cached_tokens: 999,
      prompt_tokens_details: { cached_tokens: 888 }
    })
    expect(result).toEqual({ read: 150, creation: 25 })
  })

  it('does not fallback to OpenAI cached fields when Anthropic read tokens is zero', () => {
    const result = resolveCachedTokens({
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 25,
      cached_tokens: 999,
      prompt_tokens_details: { cached_tokens: 888 }
    })
    expect(result).toEqual({ read: 0, creation: 25 })
  })

  it('returns { read: 0, creation: 0 } for null usage', () => {
    expect(resolveCachedTokens(null)).toEqual({ read: 0, creation: 0 })
  })

  it('returns { read: 0, creation: 0 } for undefined usage', () => {
    expect(resolveCachedTokens(undefined)).toEqual({ read: 0, creation: 0 })
  })

  it('returns { read: 0, creation: 0 } for empty object', () => {
    expect(resolveCachedTokens({})).toEqual({ read: 0, creation: 0 })
  })

  it('returns { read: 0, creation: 0 } for non-object usage', () => {
    expect(resolveCachedTokens('string')).toEqual({ read: 0, creation: 0 })
    expect(resolveCachedTokens(42)).toEqual({ read: 0, creation: 0 })
  })
})
