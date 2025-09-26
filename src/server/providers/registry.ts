import type { ProviderConfig } from '../config/types.js'
import { getConfig, onConfigChange } from '../config/manager.js'
import { createOpenAIConnector } from './openai.js'
import { createKimiConnector } from './kimi.js'
import { createDeepSeekConnector } from './deepseek.js'
import { createAnthropicConnector } from './anthropic.js'
import type { ProviderConnector } from './types.js'

let connectors = new Map<string, ProviderConnector>()

function buildConnector(config: ProviderConfig): ProviderConnector {
  switch (config.type) {
    case 'deepseek':
      return createDeepSeekConnector(config)
    case 'huawei':
      return createOpenAIConnector(config)
    case 'kimi':
      return createKimiConnector(config)
    case 'anthropic':
      return createAnthropicConnector(config)
    case 'openai':
    case 'custom':
    default:
      return createOpenAIConnector(config)
  }
}

function rebuildConnectors(): void {
  const config = getConfig()
  connectors = new Map(config.providers.map((provider) => [provider.id, buildConnector(provider)]))
}

rebuildConnectors()
onConfigChange(() => rebuildConnectors())

export function getConnector(providerId: string): ProviderConnector {
  const connector = connectors.get(providerId)
  if (!connector) {
    throw new Error(`未找到 provider: ${providerId}`)
  }
  return connector
}

export function listProviders(): ProviderConnector[] {
  return Array.from(connectors.values())
}
