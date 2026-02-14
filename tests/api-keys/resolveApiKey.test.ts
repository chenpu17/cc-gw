import { beforeEach, describe, expect, it, vi } from 'vitest'

let currentKeyRecord: any = null

const mockedGetOne = vi.fn(async (sql: string) => {
  if (sql.includes('is_wildcard = 1')) {
    return { id: 999, name: 'Any Key', enabled: 0 }
  }
  if (sql.includes('WHERE key_hash = ?')) {
    return currentKeyRecord
  }
  return null
})

const mockedRunQuery = vi.fn(async () => ({ lastID: 1, changes: 1 }))

vi.mock('../../src/server/storage/index.ts', () => ({
  getAll: vi.fn(async () => []),
  getOne: mockedGetOne,
  runQuery: mockedRunQuery
}))

vi.mock('../../src/server/security/encryption.ts', () => ({
  encryptSecret: vi.fn((value: string) => value),
  decryptSecret: vi.fn(async () => null)
}))

const { resolveApiKey } = await import('../../src/server/api-keys/service.ts')

describe('resolveApiKey endpoint policy checks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentKeyRecord = null
  })

  it('fails closed when stored endpoint policy contains non-string values', async () => {
    currentKeyRecord = {
      id: 1,
      name: 'restricted-key',
      enabled: 1,
      is_wildcard: 0,
      allowed_endpoints: JSON.stringify(['openai', 123])
    }

    await expect(resolveApiKey('sk-test', { endpointId: 'openai', ipAddress: '127.0.0.1' }))
      .rejects
      .toMatchObject({ code: 'forbidden' })

    const details = JSON.parse(mockedRunQuery.mock.calls[0]?.[1]?.[4] as string)
    expect(details.reason).toBe('endpoint_policy_invalid')
  })

  it('rejects endpoint access when endpoint is not in allow list', async () => {
    currentKeyRecord = {
      id: 1,
      name: 'restricted-key',
      enabled: 1,
      is_wildcard: 0,
      allowed_endpoints: JSON.stringify(['openai'])
    }

    await expect(resolveApiKey('sk-test', { endpointId: 'anthropic', ipAddress: '127.0.0.1' }))
      .rejects
      .toMatchObject({ code: 'forbidden' })

    const details = JSON.parse(mockedRunQuery.mock.calls[0]?.[1]?.[4] as string)
    expect(details.reason).toBe('forbidden')
    expect(details.endpoint).toBe('anthropic')
  })

  it('allows endpoint access when endpoint is in allow list', async () => {
    currentKeyRecord = {
      id: 1,
      name: 'restricted-key',
      enabled: 1,
      is_wildcard: 0,
      allowed_endpoints: JSON.stringify(['openai', 'custom-a'])
    }

    const result = await resolveApiKey('sk-test', { endpointId: 'custom-a', ipAddress: '127.0.0.1' })

    expect(result.id).toBe(1)
    expect(result.name).toBe('restricted-key')
  })
})
