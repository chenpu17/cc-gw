import { describe, it, expect } from 'vitest'
import { resolveProviderFeatures } from '../../src/server/protocol/conversionMap.ts'

describe('conversionMap', () => {
  it('returns default features for unknown provider', () => {
    const features = resolveProviderFeatures('unknown-provider')
    expect(features).toEqual({ allowMetadata: false, allowCacheControl: false })
  })

  it('allows metadata for openai/kimi/deepseek', () => {
    for (const provider of ['openai', 'kimi', 'deepseek']) {
      expect(resolveProviderFeatures(provider).allowMetadata).toBe(true)
      expect(resolveProviderFeatures(provider).allowCacheControl).toBe(false)
    }
  })

  it('allows metadata and cache control for anthropic', () => {
    const features = resolveProviderFeatures('anthropic')
    expect(features.allowMetadata).toBe(true)
    expect(features.allowCacheControl).toBe(true)
  })
})
