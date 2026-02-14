import { randomBytes, createHash } from 'node:crypto'
import { getAll, getOne, runQuery } from '../storage/index.js'
import { encryptSecret, decryptSecret } from '../security/encryption.js'

let apiKeysHasUpdatedAt: boolean | null = null

async function ensureApiKeysMetadataLoaded(): Promise<void> {
  if (apiKeysHasUpdatedAt !== null) {
    return
  }
  const info = await getAll<{ name: string }>('PRAGMA table_info(api_keys)')
  apiKeysHasUpdatedAt = info.some((row) => row.name === 'updated_at')
}

function toIsoOrNull(value: number | null | undefined): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    try {
      return new Date(value).toISOString()
    } catch {}
  }
  return null
}

export interface ApiKeyListItem {
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

export interface CreateApiKeyResult {
  id: number
  key: string
  name: string
  description: string | null
  createdAt: string
}

export interface ResolvedApiKey {
  id: number
  name: string
  isWildcard: boolean
  providedKey: string
}

export type ApiKeyOperation = 'create' | 'delete' | 'enable' | 'disable' | 'update_endpoints' | 'auth_failure'

interface AuditLogPayload {
  apiKeyId?: number | null
  apiKeyName?: string | null
  operation: ApiKeyOperation
  operator?: string | null
  details?: Record<string, unknown> | null
  ipAddress?: string | null
}

export class ApiKeyError extends Error {
  constructor(message: string, public readonly code: 'missing' | 'invalid' | 'disabled' | 'forbidden') {
    super(message)
    this.name = 'ApiKeyError'
  }
}

const KEY_PREFIX = 'sk-ccgw-'

function hashKey(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function maskKey(prefix: string | null, suffix: string | null): string {
  if (!prefix && !suffix) {
    return '********'
  }
  const safePrefix = prefix ?? ''
  const safeSuffix = suffix ?? ''
  return `${safePrefix}****${safeSuffix}`
}

function parseEndpointList(value: unknown): { ok: true; value: string[] } | { ok: false } {
  if (!Array.isArray(value)) {
    return { ok: false }
  }
  const normalized: string[] = []
  for (const raw of value) {
    if (typeof raw !== 'string') {
      return { ok: false }
    }
    const endpointId = raw.trim()
    if (!endpointId) {
      return { ok: false }
    }
    normalized.push(endpointId)
  }
  return { ok: true, value: [...new Set(normalized)] }
}

function normalizeAllowedEndpointsForStorage(value: unknown): string[] | null {
  if (value == null) {
    return null
  }
  const parsed = parseEndpointList(value)
  if (!parsed.ok) {
    throw new Error('allowedEndpoints must be an array of strings or null')
  }
  return parsed.value.length > 0 ? parsed.value : null
}

async function recordAuditLog(payload: AuditLogPayload): Promise<void> {
  const { apiKeyId = null, apiKeyName = null, operation, operator = null, details = null, ipAddress = null } = payload
  const serializedDetails = details ? JSON.stringify(details) : null
  await runQuery(
    `INSERT INTO api_key_audit_logs (api_key_id, api_key_name, operation, operator, details, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [apiKeyId, apiKeyName, operation, operator, serializedDetails, ipAddress, new Date().toISOString()]
  )
}

function generateKey(): { key: string; prefix: string; suffix: string } {
  const randomPart = randomBytes(24).toString('base64url')
  const key = `${KEY_PREFIX}${randomPart}`
  return {
    key,
    prefix: key.slice(0, 6),
    suffix: key.slice(-4)
  }
}

export async function listApiKeys(): Promise<ApiKeyListItem[]> {
  const rows = await getAll<{
    id: number
    name: string
    description: string | null
    key_prefix: string | null
    key_suffix: string | null
    is_wildcard: number
    enabled: number
    created_at: number
    last_used_at: number | null
    request_count: number
    total_input_tokens: number
    total_output_tokens: number
    allowed_endpoints: string | null
  }>('SELECT id, name, description, key_prefix, key_suffix, is_wildcard, enabled, created_at, last_used_at, request_count, total_input_tokens, total_output_tokens, allowed_endpoints FROM api_keys ORDER BY is_wildcard DESC, created_at DESC')

  return rows.map((row) => {
    let allowedEndpoints: string[] | null = null
    if (row.allowed_endpoints) {
      try {
        const parsed = JSON.parse(row.allowed_endpoints)
        const endpointList = parseEndpointList(parsed)
        if (endpointList.ok && endpointList.value.length > 0) {
          allowedEndpoints = endpointList.value
        }
      } catch {}
    }
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      maskedKey: row.is_wildcard ? null : maskKey(row.key_prefix, row.key_suffix),
      isWildcard: Boolean(row.is_wildcard),
      enabled: Boolean(row.enabled),
      createdAt: toIsoOrNull(row.created_at),
      lastUsedAt: toIsoOrNull(row.last_used_at),
      requestCount: row.request_count ?? 0,
      totalInputTokens: row.total_input_tokens ?? 0,
      totalOutputTokens: row.total_output_tokens ?? 0,
      allowedEndpoints
    }
  })
}

export async function createApiKey(
  name: string,
  description?: string,
  context?: { operator?: string; ipAddress?: string },
  allowedEndpoints?: string[] | null
): Promise<CreateApiKeyResult> {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Name is required')
  }

  if (trimmed.length > 100) {
    throw new Error('Name too long (max 100 characters)')
  }

  const trimmedDescription = typeof description === 'string' ? description.trim() : ''
  if (trimmedDescription.length > 500) {
    throw new Error('Description too long (max 500 characters)')
  }

  await ensureApiKeysMetadataLoaded()
  const { key, prefix, suffix } = generateKey()
  const hashed = hashKey(key)
  const encrypted = encryptSecret(key)
  const now = Date.now()

  const columns = ['name', 'description', 'key_hash', 'key_ciphertext', 'key_prefix', 'key_suffix', 'is_wildcard', 'enabled', 'created_at', 'allowed_endpoints']
  const placeholders = ['?', '?', '?', '?', '?', '?', '?', '?', '?', '?']
  const normalizedEndpoints = normalizeAllowedEndpointsForStorage(allowedEndpoints)
  const serializedEndpoints = normalizedEndpoints ? JSON.stringify(normalizedEndpoints) : null
  const values: Array<string | number | null> = [trimmed, trimmedDescription || null, hashed, encrypted, prefix, suffix, 0, 1, now, serializedEndpoints]

  if (apiKeysHasUpdatedAt) {
    columns.push('updated_at')
    placeholders.push('?')
    values.push(now)
  }

  const result = await runQuery(
    `INSERT INTO api_keys (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
    values
  )

  await recordAuditLog({
    apiKeyId: result.lastID,
    apiKeyName: trimmed,
    operation: 'create',
    operator: context?.operator ?? null,
    ipAddress: context?.ipAddress ?? null
  })

  return {
    id: result.lastID,
    key,
    name: trimmed,
    description: trimmedDescription || null,
    createdAt: new Date(now).toISOString()
  }
}

export async function setApiKeyEnabled(
  id: number,
  enabled: boolean,
  context?: { operator?: string; ipAddress?: string }
): Promise<void> {
  await ensureApiKeysMetadataLoaded()
  const existing = await getOne<{
    id: number
    name: string
    is_wildcard: number
    enabled: number
  }>('SELECT id, name, is_wildcard, enabled FROM api_keys WHERE id = ?', [id])

  if (!existing) {
    throw new Error('API key not found')
  }

  if (apiKeysHasUpdatedAt) {
    await runQuery('UPDATE api_keys SET enabled = ?, updated_at = ? WHERE id = ?', [enabled ? 1 : 0, Date.now(), id])
  } else {
    await runQuery('UPDATE api_keys SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id])
  }

  await recordAuditLog({
    apiKeyId: existing.id,
    apiKeyName: existing.name,
    operation: enabled ? 'enable' : 'disable',
    operator: context?.operator ?? null,
    ipAddress: context?.ipAddress ?? null
  })
}

export async function updateApiKeyEndpoints(
  id: number,
  allowedEndpoints: string[] | null,
  context?: { ipAddress?: string }
): Promise<void> {
  await ensureApiKeysMetadataLoaded()
  const existing = await getOne<{
    id: number
    name: string
    is_wildcard: number
  }>('SELECT id, name, is_wildcard FROM api_keys WHERE id = ?', [id])

  if (!existing) {
    throw new Error('API key not found')
  }

  if (existing.is_wildcard) {
    throw new Error('Cannot set endpoint restrictions on wildcard key')
  }

  const normalizedEndpoints = normalizeAllowedEndpointsForStorage(allowedEndpoints)
  const serialized = normalizedEndpoints ? JSON.stringify(normalizedEndpoints) : null

  if (apiKeysHasUpdatedAt) {
    await runQuery('UPDATE api_keys SET allowed_endpoints = ?, updated_at = ? WHERE id = ?', [serialized, Date.now(), id])
  } else {
    await runQuery('UPDATE api_keys SET allowed_endpoints = ? WHERE id = ?', [serialized, id])
  }

  await recordAuditLog({
    apiKeyId: existing.id,
    apiKeyName: existing.name,
    operation: 'update_endpoints',
    details: { allowedEndpoints: normalizedEndpoints },
    ipAddress: context?.ipAddress ?? null
  })
}

export async function updateApiKeySettings(
  id: number,
  updates: {
    enabled?: boolean
    allowedEndpoints?: string[] | null
    allowedEndpointsProvided?: boolean
  },
  context?: { operator?: string; ipAddress?: string }
): Promise<void> {
  await ensureApiKeysMetadataLoaded()
  const existing = await getOne<{
    id: number
    name: string
    is_wildcard: number
    enabled: number
  }>('SELECT id, name, is_wildcard, enabled FROM api_keys WHERE id = ?', [id])

  if (!existing) {
    throw new Error('API key not found')
  }

  const setClauses: string[] = []
  const values: Array<string | number | null> = []
  const logs: AuditLogPayload[] = []

  if (typeof updates.enabled === 'boolean') {
    setClauses.push('enabled = ?')
    values.push(updates.enabled ? 1 : 0)
    logs.push({
      apiKeyId: existing.id,
      apiKeyName: existing.name,
      operation: updates.enabled ? 'enable' : 'disable',
      operator: context?.operator ?? null,
      ipAddress: context?.ipAddress ?? null
    })
  }

  if (updates.allowedEndpointsProvided) {
    if (existing.is_wildcard) {
      throw new Error('Cannot set endpoint restrictions on wildcard key')
    }
    const normalizedEndpoints = normalizeAllowedEndpointsForStorage(updates.allowedEndpoints)
    const serialized = normalizedEndpoints ? JSON.stringify(normalizedEndpoints) : null
    setClauses.push('allowed_endpoints = ?')
    values.push(serialized)
    logs.push({
      apiKeyId: existing.id,
      apiKeyName: existing.name,
      operation: 'update_endpoints',
      details: { allowedEndpoints: normalizedEndpoints },
      operator: context?.operator ?? null,
      ipAddress: context?.ipAddress ?? null
    })
  }

  if (setClauses.length === 0) {
    throw new Error('No updates provided')
  }

  if (apiKeysHasUpdatedAt) {
    setClauses.push('updated_at = ?')
    values.push(Date.now())
  }

  values.push(id)
  await runQuery(`UPDATE api_keys SET ${setClauses.join(', ')} WHERE id = ?`, values)

  for (const payload of logs) {
    await recordAuditLog(payload)
  }
}

export async function deleteApiKey(
  id: number,
  context?: { operator?: string; ipAddress?: string }
): Promise<void> {
  const existing = await getOne<{
    id: number
    name: string
    is_wildcard: number
  }>('SELECT id, name, is_wildcard FROM api_keys WHERE id = ?', [id])

  if (!existing) {
    throw new Error('API key not found')
  }

  if (existing.is_wildcard) {
    throw new Error('Cannot delete wildcard key')
  }

  await runQuery('DELETE FROM api_keys WHERE id = ?', [id])

  await recordAuditLog({
    apiKeyId: existing.id,
    apiKeyName: existing.name,
    operation: 'delete',
    operator: context?.operator ?? null,
    ipAddress: context?.ipAddress ?? null
  })
}

async function fetchWildcard(): Promise<{
  id: number
  name: string
  enabled: number
} | null> {
  const wildcard = await getOne<{
    id: number
    name: string
    enabled: number
  }>('SELECT id, name, enabled FROM api_keys WHERE is_wildcard = 1 LIMIT 1')
  return wildcard ?? null
}

export async function resolveApiKey(
  providedRaw: string | null | undefined,
  context?: { ipAddress?: string; endpointId?: string }
): Promise<ResolvedApiKey> {
  const provided = providedRaw?.trim() ?? ''
  const wildcard = await fetchWildcard()

  if (!provided) {
    if (wildcard && wildcard.enabled) {
      return {
        id: wildcard.id,
        name: wildcard.name,
        isWildcard: true,
        providedKey: ''
      }
    }
    await recordAuditLog({
      operation: 'auth_failure',
      details: { reason: 'missing' },
      ipAddress: context?.ipAddress ?? null
    })
    throw new ApiKeyError('API key is required', 'missing')
  }

  const hashed = hashKey(provided)
  const existing = await getOne<{
    id: number
    name: string
    enabled: number
    is_wildcard: number
    allowed_endpoints: string | null
  }>('SELECT id, name, enabled, is_wildcard, allowed_endpoints FROM api_keys WHERE key_hash = ?', [hashed])

  if (existing) {
    if (!existing.enabled) {
      await recordAuditLog({
        apiKeyId: existing.id,
        apiKeyName: existing.name,
        operation: 'auth_failure',
        details: { reason: 'disabled' },
        ipAddress: context?.ipAddress ?? null
      })
      throw new ApiKeyError('API key is disabled', 'disabled')
    }

    // Endpoint access control check (skip for wildcard keys)
    if (context?.endpointId && !existing.is_wildcard && existing.allowed_endpoints) {
      let parsed: unknown
      try {
        parsed = JSON.parse(existing.allowed_endpoints)
      } catch {
        await recordAuditLog({
          apiKeyId: existing.id,
          apiKeyName: existing.name,
          operation: 'auth_failure',
          details: { reason: 'endpoint_policy_invalid', endpoint: context.endpointId },
          ipAddress: context?.ipAddress ?? null
        })
        throw new ApiKeyError('API key endpoint policy is invalid', 'forbidden')
      }

      if (!Array.isArray(parsed)) {
        await recordAuditLog({
          apiKeyId: existing.id,
          apiKeyName: existing.name,
          operation: 'auth_failure',
          details: { reason: 'endpoint_policy_invalid', endpoint: context.endpointId },
          ipAddress: context?.ipAddress ?? null
        })
        throw new ApiKeyError('API key endpoint policy is invalid', 'forbidden')
      }

      const endpointList = parseEndpointList(parsed)
      if (!endpointList.ok) {
        await recordAuditLog({
          apiKeyId: existing.id,
          apiKeyName: existing.name,
          operation: 'auth_failure',
          details: { reason: 'endpoint_policy_invalid', endpoint: context.endpointId },
          ipAddress: context?.ipAddress ?? null
        })
        throw new ApiKeyError('API key endpoint policy is invalid', 'forbidden')
      }
      const allowed = endpointList.value

      if (allowed.length > 0 && !allowed.includes(context.endpointId)) {
        await recordAuditLog({
          apiKeyId: existing.id,
          apiKeyName: existing.name,
          operation: 'auth_failure',
          details: { reason: 'forbidden', endpoint: context.endpointId },
          ipAddress: context?.ipAddress ?? null
        })
        throw new ApiKeyError('API key is not authorized for this endpoint', 'forbidden')
      }
    }

    return {
      id: existing.id,
      name: existing.name,
      isWildcard: Boolean(existing.is_wildcard),
      providedKey: provided
    }
  }

  if (wildcard && wildcard.enabled) {
    return {
      id: wildcard.id,
      name: wildcard.name,
      isWildcard: true,
      providedKey: provided
    }
  }

  await recordAuditLog({
    operation: 'auth_failure',
    details: { reason: 'invalid', hash: hashed.slice(0, 16) },
    ipAddress: context?.ipAddress ?? null
  })
  throw new ApiKeyError('Invalid API key provided', 'invalid')
}

export async function recordApiKeyUsage(
  id: number,
  delta: { inputTokens: number; outputTokens: number }
): Promise<void> {
  const now = Date.now()
  await ensureApiKeysMetadataLoaded()
  if (apiKeysHasUpdatedAt) {
    await runQuery(
      `UPDATE api_keys
          SET last_used_at = ?,
              request_count = COALESCE(request_count, 0) + 1,
              total_input_tokens = COALESCE(total_input_tokens, 0) + ?,
              total_output_tokens = COALESCE(total_output_tokens, 0) + ?,
              updated_at = ?
        WHERE id = ?`,
      [now, delta.inputTokens, delta.outputTokens, now, id]
    )
  } else {
    await runQuery(
      `UPDATE api_keys
          SET last_used_at = ?,
              request_count = COALESCE(request_count, 0) + 1,
              total_input_tokens = COALESCE(total_input_tokens, 0) + ?,
              total_output_tokens = COALESCE(total_output_tokens, 0) + ?
        WHERE id = ?`,
      [now, delta.inputTokens, delta.outputTokens, id]
    )
  }
}

export async function decryptApiKeyValue(value: string | null): Promise<string | null> {
  return decryptSecret(value)
}

export async function revealApiKey(id: number): Promise<{ key: string } | null> {
  const row = await getOne<{
    id: number
    key_ciphertext: string | null
    is_wildcard: number
  }>('SELECT id, key_ciphertext, is_wildcard FROM api_keys WHERE id = ?', [id])

  if (!row) {
    return null
  }

  if (row.is_wildcard) {
    return null
  }

  const decrypted = await decryptSecret(row.key_ciphertext)
  if (!decrypted) {
    return null
  }

  return { key: decrypted }
}

export async function ensureWildcardMetadata(): Promise<void> {
  const wildcard = await fetchWildcard()
  if (!wildcard) {
    return
  }
  await runQuery(
    'UPDATE api_keys SET key_prefix = COALESCE(key_prefix, ?), key_suffix = COALESCE(key_suffix, ?) WHERE id = ?',
    ['WILD', 'KEY', wildcard.id]
  )
}
