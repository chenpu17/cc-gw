import { describe, expect, it } from 'vitest'

/**
 * 测试 provider connector 的 header 选择逻辑
 */

// 模拟 OpenAI connector 的 header 选择逻辑
function buildOpenAIHeaders(config: { apiKey?: string; authMode?: string }): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) {
    if (config.authMode === 'xAuthToken') {
      headers['X-Auth-Token'] = config.apiKey
    } else {
      headers['Authorization'] = `Bearer ${config.apiKey}`
    }
  }
  return headers
}

// 模拟 Anthropic connector 的 header 选择逻辑
function buildAnthropicHeaders(config: { apiKey?: string; authMode?: string }): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (config.apiKey) {
    const mode = config.authMode ?? 'apiKey'
    if (mode === 'authToken') {
      headers['authorization'] = `Bearer ${config.apiKey}`
    } else if (mode === 'xAuthToken') {
      headers['x-auth-token'] = config.apiKey
    } else {
      headers['x-api-key'] = config.apiKey
    }
  }
  return headers
}

describe('OpenAI connector header selection', () => {
  it('uses Authorization Bearer by default', () => {
    const headers = buildOpenAIHeaders({ apiKey: 'sk-test' })
    expect(headers['Authorization']).toBe('Bearer sk-test')
    expect(headers['X-Auth-Token']).toBeUndefined()
  })

  it('uses Authorization Bearer for apiKey mode', () => {
    const headers = buildOpenAIHeaders({ apiKey: 'sk-test', authMode: 'apiKey' })
    expect(headers['Authorization']).toBe('Bearer sk-test')
  })

  it('uses Authorization Bearer for authToken mode', () => {
    const headers = buildOpenAIHeaders({ apiKey: 'sk-test', authMode: 'authToken' })
    expect(headers['Authorization']).toBe('Bearer sk-test')
  })

  it('uses X-Auth-Token for xAuthToken mode', () => {
    const headers = buildOpenAIHeaders({ apiKey: 'sk-test', authMode: 'xAuthToken' })
    expect(headers['X-Auth-Token']).toBe('sk-test')
    expect(headers['Authorization']).toBeUndefined()
  })
})

describe('Anthropic connector header selection', () => {
  it('uses x-api-key by default', () => {
    const headers = buildAnthropicHeaders({ apiKey: 'sk-ant-test' })
    expect(headers['x-api-key']).toBe('sk-ant-test')
    expect(headers['authorization']).toBeUndefined()
  })

  it('uses x-api-key for apiKey mode', () => {
    const headers = buildAnthropicHeaders({ apiKey: 'sk-ant-test', authMode: 'apiKey' })
    expect(headers['x-api-key']).toBe('sk-ant-test')
  })

  it('uses Authorization Bearer for authToken mode', () => {
    const headers = buildAnthropicHeaders({ apiKey: 'sk-ant-test', authMode: 'authToken' })
    expect(headers['authorization']).toBe('Bearer sk-ant-test')
    expect(headers['x-api-key']).toBeUndefined()
  })

  it('uses x-auth-token for xAuthToken mode', () => {
    const headers = buildAnthropicHeaders({ apiKey: 'sk-ant-test', authMode: 'xAuthToken' })
    expect(headers['x-auth-token']).toBe('sk-ant-test')
    expect(headers['x-api-key']).toBeUndefined()
    expect(headers['authorization']).toBeUndefined()
  })
})
