export interface ProviderFeatures {
  allowMetadata: boolean
  allowCacheControl: boolean
}

const DEFAULT_FEATURES: ProviderFeatures = {
  allowMetadata: false,
  allowCacheControl: false
}

const FEATURE_MAP: Record<string, ProviderFeatures> = {
  anthropic: { allowMetadata: true, allowCacheControl: true },
  openai: { allowMetadata: true, allowCacheControl: false },
  kimi: { allowMetadata: true, allowCacheControl: false },
  deepseek: { allowMetadata: true, allowCacheControl: false }
}

export function resolveProviderFeatures(providerType?: string): ProviderFeatures {
  if (!providerType) return DEFAULT_FEATURES
  const normalized = providerType.toLowerCase()
  return FEATURE_MAP[normalized] ?? DEFAULT_FEATURES
}
