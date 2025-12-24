import type { GatewayConfig } from '../../config/types.js'

function isGatewayEndpoint(value: string): value is 'openai' | 'anthropic' {
  return value === 'openai' || value === 'anthropic'
}

/**
 * 构建 OpenAI /v1/models 响应数据
 *
 * 返回指定端点配置的路由规则中的所有来源模型（modelRoutes 的 key）
 *
 * @param configSnapshot - 全局配置快照
 * @param endpointId - 端点标识符，格式：
 *   - 'openai' - 系统 OpenAI 端点
 *   - 'anthropic' - 系统 Anthropic 端点
 *   - 'custom:xxx' - 自定义端点（xxx 为 customEndpoint.id）
 */
export function buildModelsResponse(configSnapshot: GatewayConfig, endpointId: string) {
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
      routedTo: Array<{
        targetProvider: string
        targetModel: string
      }>
    }
  >()

  const addModel = (modelId: string, targetProvider: string, targetModel: string) => {
    const trimmed = modelId.trim()
    if (!trimmed) return

    const existing = models.get(trimmed)
    if (existing) {
      // 添加路由目标信息
      const routeExists = existing.routedTo.some(
        (r) => r.targetProvider === targetProvider && r.targetModel === targetModel
      )
      if (!routeExists) {
        existing.routedTo.push({ targetProvider, targetModel })
      }
      return
    }

    models.set(trimmed, {
      entry: {
        id: trimmed,
        object: 'model',
        created: now,
        owned_by: 'gateway',
        permission: []
      },
      routedTo: [{ targetProvider, targetModel }]
    })
  }

  // 判断是系统端点还是自定义端点
  if (endpointId.startsWith('custom:')) {
    // 自定义端点：从 customEndpoints 中查找
    const customId = endpointId.slice(7) // 去掉 'custom:' 前缀
    const customEndpoint = configSnapshot.customEndpoints?.find((e) => e.id === customId)

    if (customEndpoint?.routing?.modelRoutes) {
      for (const [sourceModel, target] of Object.entries(customEndpoint.routing.modelRoutes)) {
        const [providerId, targetModel] = target.split(':')
        if (providerId && targetModel) {
          addModel(sourceModel, providerId, targetModel)
        }
      }
    }
  } else {
    // 系统端点：从 endpointRouting 中查找
    const routing = isGatewayEndpoint(endpointId)
      ? configSnapshot.endpointRouting?.[endpointId]
      : undefined

    if (routing?.modelRoutes) {
      for (const [sourceModel, target] of Object.entries(routing.modelRoutes)) {
        const [providerId, targetModel] = target.split(':')
        if (providerId && targetModel) {
          addModel(sourceModel, providerId, targetModel)
        }
      }
    }
  }

  // 构建最终响应
  const data = Array.from(models.values())
    .map(({ entry, routedTo }) => {
      const metadata: Record<string, unknown> = {
        routes: routedTo.map((r) => ({
          target: `${r.targetProvider}:${r.targetModel}`
        }))
      }
      entry.metadata = metadata
      return entry
    })
    .sort((a, b) => a.id.localeCompare(b.id))

  return data
}
