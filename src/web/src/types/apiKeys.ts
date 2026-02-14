export interface ApiKeySummary {
  id: number
  name: string
  description: string | null
  maskedKey: string | null
  isWildcard: boolean
  enabled: boolean
  createdAt: string | null
  lastUsedAt: string | null
  requestCount: number
  totalInputTokens: number
  totalOutputTokens: number
  allowedEndpoints: string[] | null
}

export interface NewApiKeyResponse {
  id: number
  key: string
  name: string
  description: string | null
  createdAt: string
}

export interface ApiKeyOverviewStats {
  totalKeys: number
  enabledKeys: number
  activeKeys: number
  rangeDays: number
}

export interface ApiKeyUsageMetric {
  apiKeyId: number | null
  apiKeyName: string | null
  requests: number
  inputTokens: number
  outputTokens: number
  lastUsedAt: string | null
}
