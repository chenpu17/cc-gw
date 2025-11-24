import type { GatewayConfig } from '../../config/types.js'

/**
 * 构建 OpenAI /v1/models 响应数据
 *
 * 此函数从配置中提取所有 provider 的 models，并去重合并
 * 用于 /openai/v1/models 和自定义端点的 /v1/models
 */
export function buildModelsResponse(configSnapshot: GatewayConfig) {
  const now = Math.floor(Date.now() / 1000)
  const models = new Map<
    string,
    {
      entry: {
        id: string
        object: 'model'
        created: number
        owned_by: string
        metadata?: Record<string, unknown>
        permission?: unknown[]
      }
      providers: Array<{
        id: string
        label: string
        type: string
        isDefault: boolean
      }>
    }
  >()

  const addModel = (
    modelId: string | null | undefined,
    provider: typeof configSnapshot.providers[number],
    isDefault: boolean
  ) => {
    if (!modelId || typeof modelId !== 'string') return
    const trimmed = modelId.trim()
    if (!trimmed) return

    const existing = models.get(trimmed)
    if (existing) {
      // 检查该 provider 是否已存在，避免重复添加
      const providerExists = existing.providers.some((p) => p.id === provider.id)
      if (!providerExists) {
        existing.providers.push({
          id: provider.id,
          label: provider.label,
          type: provider.type ?? 'custom',
          isDefault
        })
      } else if (isDefault) {
        // 如果已存在但当前是 defaultModel，更新 isDefault 标记
        const existingProvider = existing.providers.find((p) => p.id === provider.id)
        if (existingProvider) {
          existingProvider.isDefault = true
        }
      }
      return
    }

    models.set(trimmed, {
      entry: {
        id: trimmed,
        object: 'model',
        created: now,
        owned_by: provider.id,
        permission: []
      },
      providers: [
        {
          id: provider.id,
          label: provider.label,
          type: provider.type ?? 'custom',
          isDefault
        }
      ]
    })
  }

  // 遍历所有 providers，收集 models
  for (const provider of configSnapshot.providers) {
    if (provider.defaultModel) {
      addModel(provider.defaultModel, provider, true)
    }
    if (Array.isArray(provider.models)) {
      for (const model of provider.models) {
        addModel(model.id, provider, provider.defaultModel === model.id)
      }
    }
  }

  // 构建最终响应
  const data = Array.from(models.values())
    .map(({ entry, providers }) => {
      const metadata: Record<string, unknown> = {
        providers
      }
      const defaultProvider = providers.find((item) => item.isDefault)
      if (defaultProvider) {
        metadata.default_provider = defaultProvider.id
      }
      entry.metadata = metadata
      return entry
    })
    .sort((a, b) => a.id.localeCompare(b.id))

  return data
}
