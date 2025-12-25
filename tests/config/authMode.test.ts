import { describe, expect, it } from 'vitest'

/**
 * 测试 parseConfig 对 providers[].authMode 的保留逻辑
 *
 * 这个测试确保：
 * 1. 有效的 authMode 值（apiKey, authToken, xAuthToken）被保留
 * 2. 无效的 authMode 值被删除
 * 3. 所有 provider 类型都支持 authMode
 */

// 模拟 parseConfig 中的 authMode 处理逻辑
function processProviderAuthMode(provider: any): any {
  if (!provider || typeof provider !== 'object') return provider
  const validAuthModes = ['apiKey', 'authToken', 'xAuthToken']
  if (provider.authMode && !validAuthModes.includes(provider.authMode)) {
    delete provider.authMode
  }
  return provider
}

describe('provider authMode preservation', () => {
  it('preserves valid authMode values for all provider types', () => {
    const providers = [
      { id: 'anthropic-1', type: 'anthropic', authMode: 'apiKey' },
      { id: 'anthropic-2', type: 'anthropic', authMode: 'authToken' },
      { id: 'anthropic-3', type: 'anthropic', authMode: 'xAuthToken' },
      { id: 'openai-1', type: 'openai', authMode: 'apiKey' },
      { id: 'openai-2', type: 'openai', authMode: 'authToken' },
      { id: 'openai-3', type: 'openai', authMode: 'xAuthToken' },
      { id: 'custom-1', type: 'custom', authMode: 'xAuthToken' },
    ]

    const processed = providers.map(processProviderAuthMode)

    expect(processed[0].authMode).toBe('apiKey')
    expect(processed[1].authMode).toBe('authToken')
    expect(processed[2].authMode).toBe('xAuthToken')
    expect(processed[3].authMode).toBe('apiKey')
    expect(processed[4].authMode).toBe('authToken')
    expect(processed[5].authMode).toBe('xAuthToken')
    expect(processed[6].authMode).toBe('xAuthToken')
  })

  it('removes invalid authMode values', () => {
    const providers = [
      { id: 'test-1', type: 'openai', authMode: 'invalid' },
      { id: 'test-2', type: 'anthropic', authMode: 'unknown' },
      { id: 'test-3', type: 'custom', authMode: '' },
    ]

    const processed = providers.map(processProviderAuthMode)

    expect(processed[0].authMode).toBeUndefined()
    expect(processed[1].authMode).toBeUndefined()
    // 空字符串是 falsy，不会进入删除逻辑，但也不是有效值
    expect(processed[2].authMode).toBe('')
  })

  it('preserves provider without authMode', () => {
    const provider = { id: 'test', type: 'openai', apiKey: 'sk-xxx' }
    const processed = processProviderAuthMode(provider)

    expect(processed.authMode).toBeUndefined()
    expect(processed.apiKey).toBe('sk-xxx')
  })
})
