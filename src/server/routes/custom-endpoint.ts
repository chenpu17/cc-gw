import type { FastifyInstance, FastifyRequest, RouteOptions } from 'fastify'
import type { CustomEndpointConfig, EndpointPathConfig, EndpointProtocol } from '../config/types.js'
import { normalizeClaudePayload } from '../protocol/normalize.js'
import { normalizeOpenAIChatPayload } from '../protocol/normalize-openai-chat.js'
import { normalizeOpenAIResponsesPayload } from '../protocol/normalize-openai.js'
import { resolveRoute } from '../router/index.js'
import { buildProviderBody, buildAnthropicBody } from '../protocol/toProvider.js'
import { convertOpenAIToAnthropic } from '../protocol/responseConverter.js'
import { StreamTransformer, type StreamFormat } from '../protocol/streamTransformer.js'
import { getConnector } from '../providers/registry.js'
import { createOpenAIConnector } from '../providers/openai.js'
import { finalizeLog, recordLog, updateLogTokens, updateMetrics, upsertLogPayload } from '../logging/logger.js'
import { estimateTokens, estimateTextTokens } from '../protocol/tokenizer.js'
import { decrementActiveRequests, incrementActiveRequests } from '../metrics/activity.js'
import { getConfig } from '../config/manager.js'
import type { NormalizedPayload } from '../protocol/types.js'
import { resolveApiKey, ApiKeyError, recordApiKeyUsage } from '../api-keys/service.js'
import { encryptSecret } from '../security/encryption.js'
import { validateAnthropicRequest } from './anthropic-validator.js'
import { recordEvent } from '../events/service.js'
import { buildModelsResponse } from './shared/models-handler.js'
import type { ProviderConnector } from '../providers/types.js'

function resolveHeaderValue(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.find((item) => typeof item === 'string' && item.trim().length > 0)
  }
  return undefined
}

function extractApiKeyFromRequest(request: any): string | undefined {
  let provided = resolveHeaderValue(request.headers?.authorization as any)
  if (provided && typeof provided === 'string' && provided.toLowerCase().startsWith('bearer ')) {
    provided = provided.slice(7)
  }
  if (!provided) {
    provided = resolveHeaderValue(request.headers?.['x-api-key'] as any)
  }
  return provided
}

/**
 * 根据协议类型生成需要注册的路径列表
 * 模仿系统端点的行为，自动添加协议特定的子路径
 */
function getPathsToRegister(basePath: string, protocol: EndpointProtocol): string[] {
  switch (protocol) {
    case 'anthropic':
      // Anthropic 协议：注册 /v1/messages 和 /v1/v1/messages（兼容性）
      return [
        `${basePath}/v1/messages`,
        `${basePath}/v1/v1/messages`
      ]
    case 'openai-auto':
      // OpenAI Auto：同时注册 chat 和 responses 路径
      return [
        `${basePath}/v1/models`,
        `${basePath}/v1/chat/completions`,
        `${basePath}/v1/responses`
      ]
    case 'openai-chat':
      // OpenAI Chat Completions
      return [
        `${basePath}/v1/models`,
        `${basePath}/v1/chat/completions`
      ]
    case 'openai-responses':
      // OpenAI Responses API
      return [
        `${basePath}/v1/models`,
        `${basePath}/v1/responses`
      ]
    default:
      // 未知协议，只注册基础路径
      return [basePath]
  }
}


function resolveCachedTokens(usage: any): { read: number; creation: number } {
  const result = { read: 0, creation: 0 }

  if (!usage || typeof usage !== 'object') {
    return result
  }

  // Anthropic 格式 - 分别统计
  if (typeof usage.cache_read_input_tokens === 'number') {
    result.read = usage.cache_read_input_tokens
  }
  if (typeof usage.cache_creation_input_tokens === 'number') {
    result.creation = usage.cache_creation_input_tokens
  }

  // OpenAI 格式的 cached_tokens (视为读取)
  if (typeof usage.cached_tokens === 'number') {
    result.read = usage.cached_tokens
  }

  // OpenAI 详细格式
  const promptDetails = usage.prompt_tokens_details
  if (promptDetails && typeof promptDetails.cached_tokens === 'number') {
    result.read = promptDetails.cached_tokens
  }

  return result
}

interface StreamResponseSummary {
  content: string
  model?: string
  finish_reason?: string | null
  usage?: {
    prompt_tokens?: number | null
    completion_tokens?: number | null
    cached_tokens?: number | null
  }
  tool_calls?: Array<{
    id: string
    type: string
    function: {
      name: string
      arguments: string
    }
  }>
}

/**
 * Parse SSE chunks and build a clean response summary.
 * Supports both OpenAI Chat Completions and OpenAI Responses formats.
 */
function parseSSEToSummary(
  chunks: string[],
  format: 'chat' | 'responses',
  modelId?: string
): StreamResponseSummary {
  const allChunks = chunks.join('')
  const lines = allChunks.split('\n')

  let accumulatedContent = ''
  let finishReason: string | null = null
  const toolCalls = new Map<number, { id: string; type: string; name: string; arguments: string }>()
  let usagePrompt: number | null = null
  let usageCompletion: number | null = null
  let usageCached: number | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue

    const dataStr = trimmed.slice(5).trim()
    if (dataStr === '[DONE]') continue

    try {
      const data = JSON.parse(dataStr)

      if (format === 'chat') {
        // OpenAI Chat Completions format
        const choice = data?.choices?.[0]
        if (choice) {
          const delta = choice.delta
          if (delta?.content) {
            accumulatedContent += delta.content
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0
              const existing = toolCalls.get(idx)
              if (!existing && tc.id) {
                toolCalls.set(idx, {
                  id: tc.id,
                  type: tc.type || 'function',
                  name: tc.function?.name || '',
                  arguments: tc.function?.arguments || ''
                })
              } else if (existing) {
                if (tc.function?.arguments) {
                  existing.arguments += tc.function.arguments
                }
              }
            }
          }
          if (choice.finish_reason) {
            finishReason = choice.finish_reason
          }
        }
        // Usage info
        if (data?.usage) {
          usagePrompt = data.usage.prompt_tokens ?? usagePrompt
          usageCompletion = data.usage.completion_tokens ?? usageCompletion
          const cached = resolveCachedTokens(data.usage)
          if (cached.read > 0 || cached.creation > 0) {
            usageCached = cached.read + cached.creation
          }
        }
      } else {
        // OpenAI Responses format
        const eventType = data?.type
        if (eventType === 'response.output_text.delta') {
          const delta = data?.delta
          if (typeof delta === 'string') {
            accumulatedContent += delta
          }
        } else if (eventType === 'response.content_part.delta') {
          const delta = data?.delta?.text
          if (typeof delta === 'string') {
            accumulatedContent += delta
          }
        } else if (eventType === 'response.function_call_arguments.delta') {
          const itemId = data?.item_id
          const delta = data?.delta
          if (itemId && typeof delta === 'string') {
            let found = false
            for (const tc of toolCalls.values()) {
              if (tc.id === itemId) {
                tc.arguments += delta
                found = true
                break
              }
            }
            if (!found) {
              toolCalls.set(toolCalls.size, {
                id: itemId,
                type: 'function',
                name: '',
                arguments: delta
              })
            }
          }
        } else if (eventType === 'response.output_item.added') {
          const item = data?.item
          if (item?.type === 'function_call' && item?.call_id) {
            toolCalls.set(toolCalls.size, {
              id: item.call_id,
              type: 'function',
              name: item.name || '',
              arguments: ''
            })
          }
        } else if (eventType === 'response.completed' || eventType === 'response.done') {
          const response = data?.response
          if (response?.status) {
            finishReason = response.status
          }
          if (response?.usage) {
            usagePrompt = response.usage.input_tokens ?? response.usage.prompt_tokens ?? usagePrompt
            usageCompletion = response.usage.output_tokens ?? response.usage.completion_tokens ?? usageCompletion
            const cached = resolveCachedTokens(response.usage)
            if (cached.read > 0 || cached.creation > 0) {
              usageCached = cached.read + cached.creation
            }
          }
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  const summary: StreamResponseSummary = {
    content: accumulatedContent,
    model: modelId,
    finish_reason: finishReason
  }

  if (usagePrompt != null || usageCompletion != null || usageCached != null) {
    summary.usage = {
      prompt_tokens: usagePrompt,
      completion_tokens: usageCompletion,
      cached_tokens: usageCached
    }
  }

  if (toolCalls.size > 0) {
    summary.tool_calls = Array.from(toolCalls.values()).map(tc => ({
      id: tc.id,
      type: tc.type,
      function: {
        name: tc.name,
        arguments: tc.arguments
      }
    }))
  }

  return summary
}

const roundTwoDecimals = (value: number): number => Math.round(value * 100) / 100

function cloneOriginalPayload<T>(value: T): T {
  const structuredCloneFn = (globalThis as any).structuredClone as (<U>(input: U) => U) | undefined
  if (structuredCloneFn) {
    return structuredCloneFn(value)
  }
  return JSON.parse(JSON.stringify(value)) as T
}

function computeTpot(
  totalLatencyMs: number,
  outputTokens: number,
  options?: { ttftMs?: number | null; streaming?: boolean }
): number | null {
  if (!Number.isFinite(outputTokens) || outputTokens <= 0) {
    return null
  }
  const streaming = options?.streaming ?? false
  const ttftMs = options?.ttftMs ?? null

  if (streaming && (ttftMs === null || ttftMs === undefined)) {
    return null
  }

  const effectiveLatency = streaming && ttftMs != null
    ? Math.max(totalLatencyMs - ttftMs, 0)
    : totalLatencyMs

  const raw = effectiveLatency / outputTokens
  return Number.isFinite(raw) ? roundTwoDecimals(raw) : null
}

/**
 * 存储已注册的自定义端点路由，用于追踪
 * Map<endpointId, Map<path, protocol>>，允许一个endpoint注册多个path并追踪协议
 */
const registeredRoutes = new Map<string, Map<string, string>>()

/**
 * 规范化端点配置：将旧格式转换为新格式
 * 向后兼容旧的 { path, protocol } 格式
 */
function normalizeEndpointPaths(endpoint: CustomEndpointConfig): EndpointPathConfig[] {
  // 新格式：使用 paths 数组
  if (endpoint.paths && Array.isArray(endpoint.paths) && endpoint.paths.length > 0) {
    return endpoint.paths
  }

  // 旧格式：使用 path 和 protocol
  if (endpoint.path && endpoint.protocol) {
    return [{ path: endpoint.path, protocol: endpoint.protocol }]
  }

  // 无效配置
  return []
}

/**
 * 为自定义端点注册路由处理器
 * 支持多个路径，每个路径可以使用不同的协议
 */
export async function registerCustomEndpoint(
  app: FastifyInstance,
  endpoint: CustomEndpointConfig
): Promise<void> {
  if (endpoint.enabled === false) {
    app.log.info(`Custom endpoint "${endpoint.id}" is disabled, skipping registration`)
    return
  }

  const endpointId = endpoint.id
  const pathConfigs = normalizeEndpointPaths(endpoint)

  if (pathConfigs.length === 0) {
    app.log.warn(`Custom endpoint "${endpointId}" has no valid paths configured`)
    return
  }

  // 为每个路径注册 handler
  for (const pathConfig of pathConfigs) {
    let basePath = pathConfig.path.startsWith('/') ? pathConfig.path : `/${pathConfig.path}`
    const protocol = pathConfig.protocol

    // 根据协议类型生成实际需要注册的路径列表
    const pathsToRegister = getPathsToRegister(basePath, protocol)

    for (const endpointPath of pathsToRegister) {
      // 对路径进行 URL 编码以支持空格和非 ASCII 字符
      // 但保留斜杠 "/" 不编码
      const encodedPath = endpointPath.split('/').map(segment => encodeURIComponent(segment)).join('/')

      // 检查该path是否已注册（使用编码后的路径作为 key）
      const existingPaths = registeredRoutes.get(endpointId)
      const existingProtocol = existingPaths?.get(encodedPath)

      if (existingProtocol) {
        if (existingProtocol === protocol) {
          app.log.debug(`Custom endpoint "${endpointId}" path "${endpointPath}" already registered with same protocol, skipping`)
          continue
        } else {
          // 协议变更：更新记录，统一handler会自动使用新协议
          app.log.info(
            { endpointId, path: endpointPath, encodedPath, oldProtocol: existingProtocol, newProtocol: protocol },
            `Custom endpoint protocol changed from "${existingProtocol}" to "${protocol}". Change will take effect immediately.`
          )
          if (existingPaths) {
            existingPaths.set(encodedPath, protocol)
          }
          continue
        }
      }

      app.log.info(
        {
          endpointId,
          basePath,
          path: endpointPath,
          encodedPath,
          protocol,
          label: endpoint.label
        },
        `Registering custom endpoint path with unified handler`
      )

      // 存储路由信息（使用编码后的路径作为 key）
      if (!registeredRoutes.has(endpointId)) {
        registeredRoutes.set(endpointId, new Map())
      }
      registeredRoutes.get(endpointId)!.set(encodedPath, protocol)

      const isModelsPath = endpointPath.endsWith('/v1/models')

      // 注册统一的动态处理器（使用编码后的路径）
      if (isModelsPath) {
        await registerModelsHandler(app, encodedPath, endpointId)
      } else {
        await registerUnifiedHandler(app, encodedPath, endpointId)
      }
    }
  }
}

/**
 * 获取所有已注册的自定义端点 ID
 */
export function getRegisteredEndpointIds(): string[] {
  return Array.from(registeredRoutes.keys())
}

/**
 * 获取指定endpoint已注册的所有路径
 */
export function getRegisteredPaths(endpointId: string): string[] {
  const paths = registeredRoutes.get(endpointId)
  return paths ? Array.from(paths.keys()) : []
}

/**
 * 清理已注册的路由（仅用于测试）
 */
export function clearRegisteredRoutes(): void {
  registeredRoutes.clear()
}

/**
 * 实时获取endpoint配置，并验证其有效性
 * 返回null表示endpoint已被删除、禁用或路径不匹配
 */
function getCurrentEndpointConfig(
  endpointId: string,
  requestPath: string,
  app: FastifyInstance
): CustomEndpointConfig | null {
  const config = getConfig()
  const endpoint = config.customEndpoints?.find((e) => e.id === endpointId)

  if (!endpoint) {
    app.log.debug(`Endpoint "${endpointId}" not found in current config`)
    return null
  }

  if (endpoint.enabled === false) {
    app.log.debug(`Endpoint "${endpointId}" is disabled`)
    return null
  }

  // 验证路径是否匹配（支持新旧两种格式）
  // 先解码 URL，因为请求中可能包含 %20（空格）等编码字符
  let actualPath: string
  try {
    actualPath = decodeURIComponent(requestPath.split('?')[0])
  } catch (error) {
    // 如果解码失败（例如无效的编码），使用原始路径
    actualPath = requestPath.split('?')[0]
  }

  // 获取所有应该注册的完整路径（包括根据协议自动添加的子路径）
  const expectedPaths: string[] = []
  if (endpoint.paths && Array.isArray(endpoint.paths) && endpoint.paths.length > 0) {
    for (const pathConfig of endpoint.paths) {
      const basePath = pathConfig.path.startsWith('/') ? pathConfig.path : `/${pathConfig.path}`
      expectedPaths.push(...getPathsToRegister(basePath, pathConfig.protocol))
    }
  } else if (endpoint.path) {
    const basePath = endpoint.path.startsWith('/') ? endpoint.path : `/${endpoint.path}`
    const protocol = endpoint.protocol || 'anthropic'
    expectedPaths.push(...getPathsToRegister(basePath, protocol))
  }

  if (expectedPaths.length === 0 || !expectedPaths.includes(actualPath)) {
    app.log.debug(
      `Endpoint "${endpointId}" accessed via path "${actualPath}". ` +
        `Expected paths: ${expectedPaths.join(', ')}. Returning 404.`
    )
    return null
  }

  return endpoint
}

/**
 * 为 OpenAI 协议的自定义端点注册 /v1/models
 */
async function registerModelsHandler(app: FastifyInstance, path: string, endpointId: string): Promise<void> {
  const handler = async (request: any, reply: any) => {
    const endpoint = getCurrentEndpointConfig(endpointId, request.url, app)
    if (!endpoint) {
      reply.code(404)
      return { error: 'Endpoint not found, disabled, or path changed' }
    }

    const providedApiKey = extractApiKeyFromRequest(request)

    try {
      await resolveApiKey(providedApiKey, { ipAddress: request.ip })
    } catch (error) {
      if (error instanceof ApiKeyError) {
        reply.code(401)
        return {
          error: {
            code: 'invalid_api_key',
            message: error.message
          }
        }
      }
      throw error
    }

    const configSnapshot = getConfig()
    const data = buildModelsResponse(configSnapshot, `custom:${endpointId}`)

    reply.header('content-type', 'application/json')
    return {
      object: 'list',
      data
    }
  }

  app.get(path, handler)
  app.log.debug(`Registered GET models handler for path: ${path}`)
}

/**
 * 注册统一的动态协议处理器
 * 根据实时读取的 endpoint.protocol 动态选择处理逻辑
 */
async function registerUnifiedHandler(
  app: FastifyInstance,
  path: string,
  endpointId: string
): Promise<void> {
  const handler = async (request: any, reply: any) => {
    // 实时读取endpoint配置（包括protocol）
    const endpoint = getCurrentEndpointConfig(endpointId, request.url, app)
    if (!endpoint) {
      reply.code(404)
      return { error: 'Endpoint not found, disabled, or path changed' }
    }

    // 根据当前请求路径确定协议
    // 先解码 URL，因为请求中可能包含 %20（空格）等编码字符
    let actualPath: string
    try {
      actualPath = decodeURIComponent(request.url.split('?')[0])
    } catch (error) {
      // 如果解码失败（例如无效的编码），使用原始路径
      actualPath = request.url.split('?')[0]
    }
    let protocol: EndpointProtocol | undefined

    // 新格式：从 paths 数组中查找匹配的路径
    if (endpoint.paths && Array.isArray(endpoint.paths) && endpoint.paths.length > 0) {
      const matchedPath = endpoint.paths.find(p => {
        const normalizedPath = p.path.startsWith('/') ? p.path : `/${p.path}`
        // 需要检查 actualPath 是否是根据 normalizedPath 和 protocol 生成的完整路径之一
        const expandedPaths = getPathsToRegister(normalizedPath, p.protocol)
        return expandedPaths.includes(actualPath)
      })
      protocol = matchedPath?.protocol
    }
    // 旧格式：使用顶层的 protocol 字段
    else if (endpoint.protocol) {
      protocol = endpoint.protocol
    }

    // 如果协议是 openai-auto，根据请求路径自动检测
    if (protocol === 'openai-auto') {
      if (actualPath.endsWith('/v1/chat/completions')) {
        protocol = 'openai-chat'
      } else if (actualPath.endsWith('/v1/responses')) {
        protocol = 'openai-responses'
      } else {
        app.log.error(`OpenAI auto protocol: unable to detect specific protocol for path "${actualPath}"`)
        reply.code(400)
        return { error: 'OpenAI auto protocol requires path ending with /v1/chat/completions or /v1/responses' }
      }
    }

    if (protocol === 'anthropic') {
      return await handleAnthropicProtocol(request, reply, endpoint, endpointId, app)
    } else if (protocol === 'openai-chat') {
      return await handleOpenAIChatProtocol(request, reply, endpoint, endpointId, app)
    } else if (protocol === 'openai-responses') {
      return await handleOpenAIResponsesProtocol(request, reply, endpoint, endpointId, app)
    } else {
      app.log.error(`Unknown or missing protocol "${protocol}" for endpoint "${endpointId}" at path "${actualPath}"`)
      reply.code(500)
      return { error: `Unsupported protocol: ${protocol}` }
    }
  }

  // 注册路由
  app.post(path, handler)
  app.log.debug(`Registered unified POST handler for path: ${path}`)
}

/**
 * Anthropic 协议处理逻辑
 */
async function handleAnthropicProtocol(
  request: any,
  reply: any,
  endpoint: CustomEndpointConfig,
  endpointId: string,
  app: FastifyInstance
): Promise<any> {
  const payload = request.body
  if (!payload || typeof payload !== 'object') {
    reply.code(400)
    return { error: 'Invalid request body' }
  }

  // 提取 query 字符串
  const rawUrl = typeof request.raw?.url === 'string' ? request.raw.url : request.url ?? ''
  let querySuffix: string | null = null
  if (typeof rawUrl === 'string') {
    const questionIndex = rawUrl.indexOf('?')
    if (questionIndex !== -1) {
      querySuffix = rawUrl.slice(questionIndex + 1)
    }
  }
  if (!querySuffix && typeof (request as any).querystring === 'string') {
    querySuffix = (request as any).querystring || null
  }

  const configSnapshot = getConfig()
  // Use custom endpoint's validation config if specified, otherwise fall back to global Anthropic endpoint config
  const validationConfig = endpoint.routing?.validation ?? configSnapshot.endpointRouting?.anthropic?.validation
  const validationMode = validationConfig?.mode ?? 'off'

  // 收集需要转发的 headers（排除模式：转发所有头，只排除不应转发的）
  const providerHeaders: Record<string, string> = {}
  // Note: authorization and x-api-key are excluded because they are for cc-gw auth,
  // the provider connector will set the correct auth header based on provider config
  const excludedHeaders = new Set([
    'host',
    'connection',
    'content-length',
    'transfer-encoding',
    'keep-alive',
    'upgrade',
    'proxy-connection',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'upgrade-insecure-requests',
    'authorization',
    'x-api-key'
  ])
  for (const [key, rawValue] of Object.entries(request.headers)) {
    const lower = key.toLowerCase()
    if (excludedHeaders.has(lower)) continue
    const value = typeof rawValue === 'string' ? rawValue : Array.isArray(rawValue) ? rawValue[0] : undefined
    if (value && value.length > 0) {
      providerHeaders[lower] = value
    }
  }

  const providedApiKey = extractApiKeyFromRequest(request)

  let apiKeyContext: Awaited<ReturnType<typeof resolveApiKey>>
  try {
    apiKeyContext = await resolveApiKey(providedApiKey, { ipAddress: request.ip })
  } catch (error) {
    if (error instanceof ApiKeyError) {
      reply.code(401)
      return {
        error: {
          code: 'invalid_api_key',
          message: error.message
        }
      }
    }
    throw error
  }

  const encryptedApiKeyValue = apiKeyContext.providedKey ? encryptSecret(apiKeyContext.providedKey) : null
  let usageRecorded = false
  const commitUsage = async (inputTokens: number, outputTokens: number) => {
    if (usageRecorded) return
    usageRecorded = true
    if (apiKeyContext.id) {
      const safeInput = Number.isFinite(inputTokens) ? inputTokens : 0
      const safeOutput = Number.isFinite(outputTokens) ? outputTokens : 0
      await recordApiKeyUsage(apiKeyContext.id, {
        inputTokens: safeInput,
        outputTokens: safeOutput
      })
    }
  }

  const normalized = normalizeClaudePayload(payload)
  const requestedModel = typeof payload.model === 'string' ? payload.model : undefined

  if (validationMode && validationMode !== 'off') {
    const modeLabel = validationMode === 'anthropic-strict' ? 'Anthropic' : 'Claude Code'
    const validationResult = validateAnthropicRequest(payload, {
      mode: validationMode === 'anthropic-strict' ? 'anthropic-strict' : 'claude-code',
      allowExperimentalBlocks: validationConfig?.allowExperimentalBlocks,
      request: {
        headers: request.headers,
        method: request.method,
        query: querySuffix
      }
    })
    if (!validationResult.ok) {
      const detail = validationResult.path
        ? `${validationResult.message} (${validationResult.path})`
        : validationResult.message
      void recordEvent({
        type: 'claude_validation',
        level: 'warn',
        source: 'custom-endpoint',
        title: 'Claude Code 请求校验防护（实验特性）拦截',
        message: detail,
        endpoint: endpointId,
        ipAddress: request.ip,
        apiKeyId: apiKeyContext.id ?? null,
        apiKeyName: apiKeyContext.name ?? null,
        apiKeyValue: encryptedApiKeyValue,
        userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
        mode: validationMode,
        details: {
          code: validationResult.code,
          path: validationResult.path ?? null,
          method: request.method,
          query: querySuffix,
          clientModel: payload.model ?? null
        }
      })
      reply.code(430)
      return {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          code: validationResult.code,
          message: `请求不符合 ${modeLabel} 规范：${detail}`
        }
      }
    }
  }

  // 使用实时读取的endpoint.routing
  const target = resolveRoute({
    payload: normalized,
    requestedModel,
    endpoint: endpointId,
    customRouting: endpoint.routing
  })

  const requestStart = Date.now()
  const storeRequestPayloads = configSnapshot.storeRequestPayloads !== false
  const storeResponsePayloads = configSnapshot.storeResponsePayloads !== false

  const logId = await recordLog({
    timestamp: requestStart,
    endpoint: endpointId,
    provider: target.providerId,
    model: target.modelId,
    clientModel: requestedModel,
    sessionId: payload.metadata?.user_id,
    stream: normalized.stream,
    apiKeyId: apiKeyContext.id,
    apiKeyName: apiKeyContext.name,
    apiKeyValue: encryptedApiKeyValue
  })

  incrementActiveRequests()

  if (storeRequestPayloads) {
    await upsertLogPayload(logId, {
      prompt: (() => {
        try {
          return JSON.stringify(payload)
        } catch {
          return null
        }
      })()
    })
  }

  let finalized = false
  const finalize = async (statusCode: number | null, error: string | null) => {
    if (finalized) return
    await finalizeLog(logId, {
      latencyMs: Date.now() - requestStart,
      statusCode,
      error,
      clientModel: requestedModel ?? null
    })
    finalized = true
  }

  try {
    const providerType = target.provider.type ?? 'custom'
    const connector = getConnector(target.providerId)

    let providerBody: any
    let finalHeaders: Record<string, string> | undefined = providerHeaders

    if (providerType === 'anthropic') {
      // 对于 anthropic provider，完全透明转发（与标准端点对齐）
      providerBody = cloneOriginalPayload(payload)
      providerBody.model = target.modelId
      if (Object.prototype.hasOwnProperty.call(payload, 'stream')) {
        providerBody.stream = Boolean(payload.stream)
      }

      // 收集所有原始 headers（与标准端点对齐）
      const collected: Record<string, string> = {}
      const skip = new Set(['content-length', 'host', 'connection', 'transfer-encoding'])
      const sourceHeaders = (request.raw?.headers ?? request.headers) as Record<string, string | string[] | undefined>
      for (const [headerKey, headerValue] of Object.entries(sourceHeaders)) {
        const lower = headerKey.toLowerCase()
        if (skip.has(lower)) continue

        let value: string | undefined
        if (typeof headerValue === 'string') {
          value = headerValue
        } else if (Array.isArray(headerValue)) {
          value = headerValue.find((item): item is string => typeof item === 'string' && item.length > 0)
        }

        if (value && value.length > 0) {
          collected[lower] = value
        }
      }

      if (!('content-type' in collected)) {
        collected['content-type'] = 'application/json'
      }

      if (Object.keys(collected).length > 0) {
        finalHeaders = collected
      }
    } else {
      providerBody = buildProviderBody(normalized, {
        maxTokens: payload.max_tokens,
        temperature: payload.temperature
      })
    }

    const upstream = await connector.send({
      model: target.modelId,
      body: providerBody,
      stream: normalized.stream,
      query: querySuffix,
      headers: finalHeaders
    })

    if (upstream.status >= 400) {
      reply.code(upstream.status)
      const bodyText = upstream.body ? await new Response(upstream.body).text() : ''
      const errorText = bodyText || 'Upstream provider error'
      if (storeResponsePayloads) {
        await upsertLogPayload(logId, { response: bodyText || null })
      }
      await commitUsage(0, 0)
      await finalize(upstream.status, errorText)
      return { error: errorText }
    }

    if (!normalized.stream) {
      const json = await new Response(upstream.body!).json()

      // Check if we need to convert response format
      const providerType = target.provider.type
      const needsConversion = providerType !== 'anthropic'

      // Convert OpenAI format to Anthropic format if needed
      const responseToReturn = needsConversion
        ? convertOpenAIToAnthropic(json, target.modelId)
        : json

      const inputTokens = json.usage?.input_tokens ?? json.usage?.prompt_tokens ?? estimateTokens(normalized, target.modelId)
      const outputTokens = json.usage?.output_tokens ?? json.usage?.completion_tokens ?? 0
      const cached = resolveCachedTokens(json.usage)
      const cachedTokens = cached.read + cached.creation
      const latencyMs = Date.now() - requestStart

      await updateLogTokens(logId, {
        inputTokens,
        outputTokens,
        cachedTokens,
        cacheReadTokens: cached.read,
        cacheCreationTokens: cached.creation,
        ttftMs: latencyMs,
        tpotMs: computeTpot(latencyMs, outputTokens, { streaming: false })
      })
      await commitUsage(inputTokens, outputTokens)
      await updateMetrics(new Date().toISOString().slice(0, 10), endpointId, {
        requests: 1,
        inputTokens,
        outputTokens,
        cachedTokens,
        cacheReadTokens: cached.read,
        cacheCreationTokens: cached.creation,
        latencyMs
      })
      if (storeResponsePayloads) {
        await upsertLogPayload(logId, {
          response: (() => {
            try {
              return JSON.stringify(json)
            } catch {
              return null
            }
          })()
        })
      }
      await finalize(200, null)
      reply.header('content-type', 'application/json')
      return responseToReturn
    }

    // Streaming response
    reply.header('content-type', 'text/event-stream; charset=utf-8')
    reply.header('cache-control', 'no-cache, no-store, must-revalidate')
    reply.header('connection', 'keep-alive')
    reply.hijack()
    reply.raw.writeHead(200)

    const reader = upstream.body!.getReader()
    const decoder = new TextDecoder()

    // Determine stream format conversion
    const sourceFormat: StreamFormat = providerType === 'anthropic' ? 'anthropic' : 'openai-chat'
    const targetFormat: StreamFormat = 'anthropic' // Custom endpoint with Anthropic protocol always outputs Anthropic format

    let firstTokenAt: number | null = null
    const capturedChunks: string[] | null = storeResponsePayloads ? [] : null
    let usagePrompt = 0
    let usageCompletion = 0
    let usageCacheRead = 0
    let usageCacheCreation = 0

    // When source and target format are the same, use direct passthrough for 100% compatibility
    // This preserves all SSE events (including ping) and avoids any parsing/reconstruction differences
    if (sourceFormat === targetFormat) {
      // Direct passthrough mode (same as messages.ts for Anthropic → Anthropic)
      app.log.info({ sourceFormat, targetFormat }, 'Using direct passthrough mode (no StreamTransformer)')
      let buffer = ''

      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          if (!value) continue

          const chunk = decoder.decode(value, { stream: true })
          buffer += chunk

          // Capture for logging
          if (capturedChunks) {
            capturedChunks.push(chunk)
          }

          // Extract metadata while passing through
          let newlineIndex = buffer.indexOf('\n')
          while (newlineIndex !== -1) {
            const line = buffer.slice(0, newlineIndex + 1)
            buffer = buffer.slice(newlineIndex + 1)

            // Extract first token timing
            if (!firstTokenAt && line.includes('content_block_delta')) {
              firstTokenAt = Date.now()
            }

            // Extract usage from message_delta or message_stop
            if (line.startsWith('data:')) {
              try {
                const dataStr = line.slice(5).trim()
                if (dataStr && dataStr !== '[DONE]') {
                  const payload = JSON.parse(dataStr)
                  if (payload.usage) {
                    if (payload.usage.input_tokens !== undefined) {
                      usagePrompt = payload.usage.input_tokens
                    }
                    if (payload.usage.output_tokens !== undefined) {
                      usageCompletion = payload.usage.output_tokens
                    }
                    const cached = resolveCachedTokens(payload.usage)
                    usageCacheRead = cached.read
                    usageCacheCreation = cached.creation
                  }
                }
              } catch {
                // Ignore parse errors
              }
            }

            // Write original line directly to client (preserves all events including ping)
            reply.raw.write(line)
            newlineIndex = buffer.indexOf('\n')
          }
        }

        // Write any remaining buffer
        if (buffer.length > 0) {
          reply.raw.write(buffer)
        }
      } finally {
        reply.raw.end()
      }
    } else {
      // Format conversion mode - use StreamTransformer
      app.log.info({ sourceFormat, targetFormat }, 'Using StreamTransformer for format conversion')
      const transformer = new StreamTransformer(sourceFormat, targetFormat, target.modelId)

      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          if (!value) continue

          const chunk = decoder.decode(value, { stream: true })

          // Transform chunk
          const { transformedChunk, metadata } = transformer.transform(chunk)

          // Track TTFT
          if (!firstTokenAt && metadata.ttft) {
            firstTokenAt = Date.now()
          }

          // Capture transformed chunks for logging (Anthropic format)
          if (capturedChunks) {
            capturedChunks.push(transformedChunk)
          }

          // Write transformed chunk to client
          app.log.debug({
            chunkLength: transformedChunk.length,
            preview: transformedChunk.slice(0, 200)
          }, 'Writing chunk to client')
          reply.raw.write(transformedChunk)
        }
      } finally {
        reply.raw.end()
      }

      // Get final usage from transformer
      const finalUsage = transformer.getFinalUsage()
      usagePrompt = finalUsage.inputTokens
      usageCompletion = finalUsage.outputTokens
      usageCacheRead = finalUsage.cacheReadTokens
      usageCacheCreation = finalUsage.cacheCreationTokens
    }

    // Apply token estimation fallback if needed
    if (!usagePrompt) {
      usagePrompt = target.tokenEstimate || estimateTokens(normalized, target.modelId)
    }
    if (!usageCompletion) {
      usageCompletion = estimateTextTokens('', target.modelId)
    }
    const usageCached = usageCacheRead + usageCacheCreation

    const totalLatencyMs = Date.now() - requestStart
    const ttftMs = firstTokenAt ? firstTokenAt - requestStart : null

    await updateLogTokens(logId, {
      inputTokens: usagePrompt,
      outputTokens: usageCompletion,
      cachedTokens: usageCached,
      cacheReadTokens: usageCacheRead,
      cacheCreationTokens: usageCacheCreation,
      ttftMs,
      tpotMs: computeTpot(totalLatencyMs, usageCompletion, {
        streaming: true,
        ttftMs
      })
    })
    await commitUsage(usagePrompt, usageCompletion)
    await updateMetrics(new Date().toISOString().slice(0, 10), endpointId, {
      requests: 1,
      inputTokens: usagePrompt,
      outputTokens: usageCompletion,
      cachedTokens: usageCached,
      cacheReadTokens: usageCacheRead,
      cacheCreationTokens: usageCacheCreation,
      latencyMs: totalLatencyMs
    })

    if (storeResponsePayloads && capturedChunks) {
      try {
        // Parse captured chunks (already in Anthropic format after transformation)
        const allChunks = capturedChunks.join('')
        let accumulatedText = ''
        let stopReason: string | null = null
        const contentBlocks: any[] = []

        // Parse Anthropic SSE stream
        const lines = allChunks.split('\n')

        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim()
            if (dataStr !== '[DONE]') {
              try {
                const currentData = JSON.parse(dataStr)

                // Parse Anthropic format events
                if (currentData?.type === 'content_block_delta') {
                  const text = currentData?.delta?.text
                  if (typeof text === 'string') {
                    accumulatedText += text
                  }
                } else if (currentData?.type === 'content_block_start') {
                  const block = currentData?.content_block
                  if (block?.type === 'text') {
                    contentBlocks.push({ type: 'text', text: '' })
                  } else if (block?.type === 'tool_use') {
                    contentBlocks.push({
                      type: 'tool_use',
                      id: block.id,
                      name: block.name,
                      input: {}
                    })
                  }
                } else if (currentData?.type === 'message_stop' || currentData?.type === 'message_delta') {
                  if (currentData.delta?.stop_reason) {
                    stopReason = currentData.delta.stop_reason
                  }
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
        }

        // Construct structured response summary
        const responseSummary = {
          content: accumulatedText,
          blocks: contentBlocks,
          usage: {
            input_tokens: usagePrompt,
            output_tokens: usageCompletion,
            cached_tokens: usageCached ?? 0,
            cache_read_tokens: usageCacheRead,
            cache_creation_tokens: usageCacheCreation
          },
          stop_reason: stopReason ?? 'end_turn',
          model: target.modelId
        }

        await upsertLogPayload(logId, { response: JSON.stringify(responseSummary) })
      } catch (error) {
        app.log.warn({ error }, 'Failed to persist streamed response')
      }
    }

    await finalize(200, null)
    return reply
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    if (!reply.sent) {
      reply.code(500)
    }
    await commitUsage(0, 0)
    await finalize(reply.statusCode >= 400 ? reply.statusCode : 500, message)
    return { error: message }
  } finally {
    decrementActiveRequests()
    if (!finalized && reply.sent) {
      await finalize(reply.statusCode ?? 200, null)
    }
  }
}

/**
 * OpenAI Chat Completions 协议处理逻辑
 */
async function handleOpenAIChatProtocol(
  request: any,
  reply: any,
  endpoint: CustomEndpointConfig,
  endpointId: string,
  app: FastifyInstance
): Promise<any> {
  // 直接调用现有handler的逻辑
  // 为了快速实现，我们复用registerOpenAIChatHandler中的handler代码
  const payload = request.body
  if (!payload || typeof payload !== 'object') {
    reply.code(400)
    return { error: 'Invalid request body' }
  }

  // 提取 query 字符串
  const rawUrl = typeof request.raw?.url === 'string' ? request.raw.url : request.url ?? ''
  let querySuffix: string | null = null
  if (typeof rawUrl === 'string') {
    const questionIndex = rawUrl.indexOf('?')
    if (questionIndex !== -1) {
      querySuffix = rawUrl.slice(questionIndex + 1)
    }
  }
  if (!querySuffix && typeof (request as any).querystring === 'string') {
    querySuffix = (request as any).querystring || null
  }

  // 收集需要转发的 headers（排除模式：转发所有头，只排除不应转发的）
  const providerHeaders: Record<string, string> = {}
  // Note: authorization and x-api-key are excluded because they are for cc-gw auth,
  // the provider connector will set the correct auth header based on provider config
  const excludedHeaders = new Set([
    'host',
    'connection',
    'content-length',
    'transfer-encoding',
    'keep-alive',
    'upgrade',
    'proxy-connection',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'upgrade-insecure-requests',
    'authorization',
    'x-api-key'
  ])
  for (const [key, rawValue] of Object.entries(request.headers)) {
    const lower = key.toLowerCase()
    if (excludedHeaders.has(lower)) continue
    const value = typeof rawValue === 'string' ? rawValue : Array.isArray(rawValue) ? rawValue[0] : undefined
    if (value && value.length > 0) {
      providerHeaders[lower] = value
    }
  }

  const providedApiKey = extractApiKeyFromRequest(request)
  let apiKeyContext: Awaited<ReturnType<typeof resolveApiKey>>
  try {
    apiKeyContext = await resolveApiKey(providedApiKey, { ipAddress: request.ip })
  } catch (error) {
    if (error instanceof ApiKeyError) {
      reply.code(401)
      return {
        error: {
          code: 'invalid_api_key',
          message: error.message
        }
      }
    }
    throw error
  }

  const encryptedApiKeyValue = apiKeyContext.providedKey ? encryptSecret(apiKeyContext.providedKey) : null
  let usageRecorded = false
  const commitUsage = async (inputTokens: number, outputTokens: number) => {
    if (usageRecorded) return
    usageRecorded = true
    if (apiKeyContext.id) {
      await recordApiKeyUsage(apiKeyContext.id, {
        inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
        outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0
      })
    }
  }

  const normalized = normalizeOpenAIChatPayload(payload)
  const requestedModel = typeof payload.model === 'string' ? payload.model : undefined
  const target = resolveRoute({
    payload: normalized,
    requestedModel,
    endpoint: endpointId,
    customRouting: endpoint.routing
  })

  const requestStart = Date.now()
  const configSnapshot = getConfig()
  const storeRequestPayloads = configSnapshot.storeRequestPayloads !== false
  const storeResponsePayloads = configSnapshot.storeResponsePayloads !== false

  const logId = await recordLog({
    timestamp: requestStart,
    endpoint: endpointId,
    provider: target.providerId,
    model: target.modelId,
    clientModel: requestedModel,
    stream: normalized.stream,
    apiKeyId: apiKeyContext.id,
    apiKeyName: apiKeyContext.name,
    apiKeyValue: encryptedApiKeyValue
  })

  if (storeRequestPayloads) {
    try {
      await upsertLogPayload(logId, { prompt: JSON.stringify(payload) })
    } catch {}
  }

  incrementActiveRequests()

  let finalized = false
  const finalize = async (statusCode: number | null, error: string | null) => {
    if (finalized) return
    await finalizeLog(logId, {
      latencyMs: Date.now() - requestStart,
      statusCode,
      error,
      clientModel: requestedModel ?? null
    })
    finalized = true
  }

  try {
    const providerType = target.provider.type ?? 'openai'
    let connector: ProviderConnector

    if (providerType === 'openai') {
      connector = createOpenAIConnector(target.provider, { defaultPath: 'v1/chat/completions' })
    } else {
      connector = getConnector(target.providerId)
    }

    let providerBody: any
    if (providerType === 'anthropic') {
      providerBody = buildAnthropicBody(normalized, {
        maxTokens: payload.max_tokens,
        temperature: payload.temperature
      })
    } else {
      providerBody = { ...payload }
      if (providerBody.max_output_tokens == null && typeof providerBody.max_tokens === 'number') {
        providerBody.max_output_tokens = providerBody.max_tokens
      }
      delete providerBody.max_tokens

      if (typeof providerBody.thinking === 'boolean') {
        delete providerBody.thinking
      }
      if (typeof providerBody.reasoning === 'boolean') {
        delete providerBody.reasoning
      }
      if (providerBody.tool_choice === undefined) {
        delete providerBody.tool_choice
      }
      if (providerBody.tools === undefined) {
        delete providerBody.tools
      }
      if (providerBody.response_format === undefined) {
        delete providerBody.response_format
      }
    }
    providerBody.model = target.modelId
    if (Object.prototype.hasOwnProperty.call(payload, 'stream')) {
      providerBody.stream = Boolean(payload.stream)
    }

    const upstream = await connector.send({
      model: target.modelId,
      body: providerBody,
      stream: normalized.stream,
      query: querySuffix,
      headers: providerHeaders
    })

    if (upstream.status >= 400) {
      reply.code(upstream.status)
      const bodyText = upstream.body ? await new Response(upstream.body).text() : ''
      const errorText = bodyText || 'Upstream provider error'
      if (storeResponsePayloads) {
        await upsertLogPayload(logId, { response: bodyText || null })
      }
      await commitUsage(0, 0)
      await finalize(upstream.status, errorText)
      return { error: errorText }
    }

    if (!normalized.stream) {
      const json = await new Response(upstream.body!).json()
      const usagePayload = json?.usage ?? null
      const inputTokens =
        usagePayload?.prompt_tokens ??
        usagePayload?.input_tokens ??
        target.tokenEstimate ??
        estimateTokens(normalized, target.modelId)
      const outputTokens =
        usagePayload?.completion_tokens ??
        usagePayload?.output_tokens ??
        estimateTextTokens(json?.choices?.[0]?.message?.content ?? '', target.modelId)
      const cached = resolveCachedTokens(usagePayload)
      const cachedTokens = cached.read + cached.creation
      const latencyMs = Date.now() - requestStart

      await updateLogTokens(logId, {
        inputTokens,
        outputTokens,
        cachedTokens,
        cacheReadTokens: cached.read,
        cacheCreationTokens: cached.creation,
        ttftMs: latencyMs,
        tpotMs: computeTpot(latencyMs, outputTokens, { streaming: false })
      })
      await commitUsage(inputTokens, outputTokens)
      await updateMetrics(new Date().toISOString().slice(0, 10), endpointId, {
        requests: 1,
        inputTokens,
        outputTokens,
        cachedTokens,
        cacheReadTokens: cached.read,
        cacheCreationTokens: cached.creation,
        latencyMs
      })

      if (storeResponsePayloads) {
        try {
          await upsertLogPayload(logId, { response: JSON.stringify(json) })
        } catch {}
      }

      await finalize(200, null)
      reply.header('content-type', 'application/json')
      return json
    }

    // Streaming
    reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8')
    reply.raw.setHeader('cache-control', 'no-cache, no-transform')
    reply.raw.setHeader('connection', 'keep-alive')
    if (typeof reply.raw.writeHead === 'function') {
      reply.raw.writeHead(200)
    }

    const reader = upstream.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let usagePrompt: number | null = null
    let usageCompletion: number | null = null
    let usageCached: number | null = null
    let usageCacheRead = 0
    let usageCacheCreation = 0
    let firstTokenAt: number | null = null
    const capturedChunks: string[] | null = storeResponsePayloads ? [] : null

    try {
      while (true) {
        const { value, done } = await reader.read()
        if (value && !firstTokenAt) {
          firstTokenAt = Date.now()
        }
        if (value) {
          const chunk = decoder.decode(value, { stream: !done })
          buffer += chunk
          reply.raw.write(chunk)

          if (capturedChunks) {
            capturedChunks.push(chunk)
          }

          let newlineIndex = buffer.indexOf('\n')
          while (newlineIndex !== -1) {
            const line = buffer.slice(0, newlineIndex)
            buffer = buffer.slice(newlineIndex + 1)
            const trimmed = line.trim()
            if (trimmed.startsWith('data:')) {
              const dataStr = trimmed.slice(5).trim()
              if (dataStr !== '[DONE]') {
                try {
                  const parsed = JSON.parse(dataStr)
                  const usage = parsed?.usage || parsed?.choices?.[0]?.delta?.usage || null
                  if (usage) {
                    usagePrompt = usage.prompt_tokens ?? usage.input_tokens ?? usagePrompt
                    usageCompletion = usage.completion_tokens ?? usage.output_tokens ?? usageCompletion
                    const cachedResult = resolveCachedTokens(usage)
                    usageCacheRead = cachedResult.read
                    usageCacheCreation = cachedResult.creation
                    usageCached = cachedResult.read + cachedResult.creation
                  }
                } catch {}
              }
            }
            newlineIndex = buffer.indexOf('\n')
          }
        }
        if (done) break
      }
    } finally {
      reply.raw.end()
    }

    const latencyMs = Date.now() - requestStart
    const inputTokens = usagePrompt ?? target.tokenEstimate ?? estimateTokens(normalized, target.modelId)
    const outputTokens = usageCompletion ?? 0

    await updateLogTokens(logId, {
      inputTokens,
      outputTokens,
      cachedTokens: usageCached,
      cacheReadTokens: usageCacheRead,
      cacheCreationTokens: usageCacheCreation,
      ttftMs: firstTokenAt ? firstTokenAt - requestStart : null,
      tpotMs: computeTpot(latencyMs, outputTokens, {
        streaming: true,
        ttftMs: firstTokenAt ? firstTokenAt - requestStart : null
      })
    })
    await commitUsage(inputTokens, outputTokens)
    await updateMetrics(new Date().toISOString().slice(0, 10), endpointId, {
      requests: 1,
      inputTokens,
      outputTokens,
      latencyMs
    })

    if (storeResponsePayloads && capturedChunks) {
      try {
        // Parse captured chunks to extract content and metadata
        const allChunks = capturedChunks.join('')
        let accumulatedText = ''
        let finishReason: string | null = null

        // Parse SSE stream to extract structured response
        const lines = allChunks.split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim()
            if (dataStr !== '[DONE]') {
              try {
                const parsed = JSON.parse(dataStr)
                const choice = parsed?.choices?.[0]
                if (choice) {
                  // Extract text content
                  if (choice.delta?.content) {
                    accumulatedText += choice.delta.content
                  }
                  // Extract finish_reason
                  if (choice.finish_reason) {
                    finishReason = choice.finish_reason
                  }
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
        }

        // Construct structured response summary (OpenAI Chat Completion style)
        const responseSummary = {
          id: `chatcmpl_${Date.now()}`,
          object: 'chat.completion',
          model: target.modelId,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: accumulatedText
            },
            finish_reason: finishReason ?? 'stop'
          }],
          usage: {
            prompt_tokens: inputTokens,
            completion_tokens: outputTokens,
            total_tokens: inputTokens + outputTokens,
            cached_tokens: usageCached ?? 0
          }
        }

        await upsertLogPayload(logId, { response: JSON.stringify(responseSummary) })
      } catch {}
    }

    await finalize(200, null)
    return reply
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    if (!reply.sent) {
      reply.code(500)
    }
    await commitUsage(0, 0)
    await finalize(reply.statusCode >= 400 ? reply.statusCode : 500, message)
    return { error: message }
  } finally {
    decrementActiveRequests()
    if (!finalized && reply.sent) {
      await finalize(reply.statusCode ?? 200, null)
    }
  }
}

/**
 * OpenAI Responses 协议处理逻辑
 */
async function handleOpenAIResponsesProtocol(
  request: any,
  reply: any,
  endpoint: CustomEndpointConfig,
  endpointId: string,
  app: FastifyInstance
): Promise<any> {
  // 与 OpenAI Chat 类似，使用 normalizeOpenAIResponsesPayload
  const payload = request.body
  if (!payload || typeof payload !== 'object') {
    reply.code(400)
    return { error: 'Invalid request body' }
  }

  // 提取 query 字符串
  const rawUrl = typeof request.raw?.url === 'string' ? request.raw.url : request.url ?? ''
  let querySuffix: string | null = null
  if (typeof rawUrl === 'string') {
    const questionIndex = rawUrl.indexOf('?')
    if (questionIndex !== -1) {
      querySuffix = rawUrl.slice(questionIndex + 1)
    }
  }
  if (!querySuffix && typeof (request as any).querystring === 'string') {
    querySuffix = (request as any).querystring || null
  }

  // 收集需要转发的 headers（排除模式：转发所有头，只排除不应转发的）
  const providerHeaders: Record<string, string> = {}
  // Note: authorization and x-api-key are excluded because they are for cc-gw auth,
  // the provider connector will set the correct auth header based on provider config
  const excludedHeaders = new Set([
    'host',
    'connection',
    'content-length',
    'transfer-encoding',
    'keep-alive',
    'upgrade',
    'proxy-connection',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'upgrade-insecure-requests',
    'authorization',
    'x-api-key'
  ])
  for (const [key, rawValue] of Object.entries(request.headers)) {
    const lower = key.toLowerCase()
    if (excludedHeaders.has(lower)) continue
    const value = typeof rawValue === 'string' ? rawValue : Array.isArray(rawValue) ? rawValue[0] : undefined
    if (value && value.length > 0) {
      providerHeaders[lower] = value
    }
  }

  const providedApiKey = extractApiKeyFromRequest(request)
  let apiKeyContext: Awaited<ReturnType<typeof resolveApiKey>>
  try {
    apiKeyContext = await resolveApiKey(providedApiKey, { ipAddress: request.ip })
  } catch (error) {
    if (error instanceof ApiKeyError) {
      reply.code(401)
      return {
        error: {
          code: 'invalid_api_key',
          message: error.message
        }
      }
    }
    throw error
  }

  const encryptedApiKeyValue = apiKeyContext.providedKey ? encryptSecret(apiKeyContext.providedKey) : null
  let usageRecorded = false
  const commitUsage = async (inputTokens: number, outputTokens: number) => {
    if (usageRecorded) return
    usageRecorded = true
    if (apiKeyContext.id) {
      await recordApiKeyUsage(apiKeyContext.id, {
        inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
        outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0
      })
    }
  }

  const normalized = normalizeOpenAIResponsesPayload(payload)
  const requestedModel = typeof payload.model === 'string' ? payload.model : undefined
  const target = resolveRoute({
    payload: normalized,
    requestedModel,
    endpoint: endpointId,
    customRouting: endpoint.routing
  })

  const requestStart = Date.now()
  const configSnapshot = getConfig()
  const storeRequestPayloads = configSnapshot.storeRequestPayloads !== false
  const storeResponsePayloads = configSnapshot.storeResponsePayloads !== false

  const logId = await recordLog({
    timestamp: requestStart,
    endpoint: endpointId,
    provider: target.providerId,
    model: target.modelId,
    clientModel: requestedModel,
    stream: normalized.stream,
    apiKeyId: apiKeyContext.id,
    apiKeyName: apiKeyContext.name,
    apiKeyValue: encryptedApiKeyValue
  })

  if (storeRequestPayloads) {
    try {
      await upsertLogPayload(logId, { prompt: JSON.stringify(payload) })
    } catch {}
  }

  incrementActiveRequests()

  let finalized = false
  const finalize = async (statusCode: number | null, error: string | null) => {
    if (finalized) return
    await finalizeLog(logId, {
      latencyMs: Date.now() - requestStart,
      statusCode,
      error,
      clientModel: requestedModel ?? null
    })
    finalized = true
  }

  try {
    const providerType = target.provider.type ?? 'openai'
    let connector: ProviderConnector

    if (providerType === 'openai') {
      connector = createOpenAIConnector(target.provider, { defaultPath: 'v1/responses' })
    } else {
      connector = getConnector(target.providerId)
    }

    let providerBody: any
    if (providerType === 'anthropic') {
      providerBody = buildAnthropicBody(normalized, {
        maxTokens: payload.max_tokens,
        temperature: payload.temperature
      })
    } else {
      providerBody = { ...payload }
      if (providerBody.max_output_tokens == null && typeof providerBody.max_tokens === 'number') {
        providerBody.max_output_tokens = providerBody.max_tokens
      }
      delete providerBody.max_tokens

      if (typeof providerBody.thinking === 'boolean') {
        delete providerBody.thinking
      }
      if (typeof providerBody.reasoning === 'boolean') {
        delete providerBody.reasoning
      }
      if (providerBody.tool_choice === undefined) {
        delete providerBody.tool_choice
      }
      if (providerBody.tools === undefined) {
        delete providerBody.tools
      }
      if (providerBody.response_format === undefined) {
        delete providerBody.response_format
      }
    }
    providerBody.model = target.modelId
    if (Object.prototype.hasOwnProperty.call(payload, 'stream')) {
      providerBody.stream = Boolean(payload.stream)
    }

    const upstream = await connector.send({
      model: target.modelId,
      body: providerBody,
      stream: normalized.stream,
      query: querySuffix,
      headers: providerHeaders
    })

    if (upstream.status >= 400) {
      reply.code(upstream.status)
      const bodyText = upstream.body ? await new Response(upstream.body).text() : ''
      const errorText = bodyText || 'Upstream provider error'
      if (storeResponsePayloads) {
        await upsertLogPayload(logId, { response: bodyText || null })
      }
      await commitUsage(0, 0)
      await finalize(upstream.status, errorText)
      return { error: errorText }
    }

    if (!normalized.stream) {
      const json = await new Response(upstream.body!).json()
      const usagePayload = json?.usage ?? null
      const inputTokens =
        usagePayload?.prompt_tokens ??
        usagePayload?.input_tokens ??
        target.tokenEstimate ??
        estimateTokens(normalized, target.modelId)
      const content = json?.response?.body?.content ?? json?.choices?.[0]?.message?.content ?? ''
      const outputTokens =
        usagePayload?.completion_tokens ?? usagePayload?.output_tokens ?? estimateTextTokens(content, target.modelId)
      const cached = resolveCachedTokens(usagePayload)
      const cachedTokens = cached.read + cached.creation
      const latencyMs = Date.now() - requestStart

      await updateLogTokens(logId, {
        inputTokens,
        outputTokens,
        cachedTokens,
        cacheReadTokens: cached.read,
        cacheCreationTokens: cached.creation,
        ttftMs: latencyMs,
        tpotMs: computeTpot(latencyMs, outputTokens, { streaming: false })
      })
      await commitUsage(inputTokens, outputTokens)
      await updateMetrics(new Date().toISOString().slice(0, 10), endpointId, {
        requests: 1,
        inputTokens,
        outputTokens,
        cachedTokens,
        cacheReadTokens: cached.read,
        cacheCreationTokens: cached.creation,
        latencyMs
      })

      if (storeResponsePayloads) {
        try {
          await upsertLogPayload(logId, { response: JSON.stringify(json) })
        } catch {}
      }

      await finalize(200, null)
      reply.header('content-type', 'application/json')
      return json
    }

    // Streaming
    reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8')
    reply.raw.setHeader('cache-control', 'no-cache, no-transform')
    reply.raw.setHeader('connection', 'keep-alive')
    if (typeof reply.raw.writeHead === 'function') {
      reply.raw.writeHead(200)
    }

    const reader = upstream.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let usagePrompt: number | null = null
    let usageCompletion: number | null = null
    let usageCached: number | null = null
    let usageCacheRead = 0
    let usageCacheCreation = 0
    let firstTokenAt: number | null = null
    const capturedChunks: string[] | null = storeResponsePayloads ? [] : null

    try {
      while (true) {
        const { value, done } = await reader.read()
        if (value && !firstTokenAt) {
          firstTokenAt = Date.now()
        }
        if (value) {
          const chunk = decoder.decode(value, { stream: !done })
          buffer += chunk
          reply.raw.write(chunk)

          if (capturedChunks) {
            capturedChunks.push(chunk)
          }

          let newlineIndex = buffer.indexOf('\n')
          while (newlineIndex !== -1) {
            const line = buffer.slice(0, newlineIndex)
            buffer = buffer.slice(newlineIndex + 1)
            const trimmed = line.trim()
            if (trimmed.startsWith('data:')) {
              const dataStr = trimmed.slice(5).trim()
              if (dataStr !== '[DONE]') {
                try {
                  const parsed = JSON.parse(dataStr)
                  const usage = parsed?.usage || null
                  if (usage) {
                    usagePrompt = usage.prompt_tokens ?? usage.input_tokens ?? usagePrompt
                    usageCompletion = usage.completion_tokens ?? usage.output_tokens ?? usageCompletion
                    const cachedResult = resolveCachedTokens(usage)
                    usageCacheRead = cachedResult.read
                    usageCacheCreation = cachedResult.creation
                    usageCached = cachedResult.read + cachedResult.creation
                  }
                } catch {}
              }
            }
            newlineIndex = buffer.indexOf('\n')
          }
        }
        if (done) break
      }
    } finally {
      reply.raw.end()
    }

    const latencyMs = Date.now() - requestStart
    const inputTokens = usagePrompt ?? target.tokenEstimate ?? estimateTokens(normalized, target.modelId)
    const outputTokens = usageCompletion ?? 0

    await updateLogTokens(logId, {
      inputTokens,
      outputTokens,
      cachedTokens: usageCached,
      cacheReadTokens: usageCacheRead,
      cacheCreationTokens: usageCacheCreation,
      ttftMs: firstTokenAt ? firstTokenAt - requestStart : null,
      tpotMs: computeTpot(latencyMs, outputTokens, {
        streaming: true,
        ttftMs: firstTokenAt ? firstTokenAt - requestStart : null
      })
    })
    await commitUsage(inputTokens, outputTokens)
    await updateMetrics(new Date().toISOString().slice(0, 10), endpointId, {
      requests: 1,
      inputTokens,
      outputTokens,
      latencyMs
    })

    if (storeResponsePayloads && capturedChunks) {
      try {
        // Parse captured chunks to extract content and metadata
        const allChunks = capturedChunks.join('')
        let accumulatedText = ''
        let finishReason: string | null = null

        // Parse SSE stream to extract structured response
        const lines = allChunks.split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim()
            if (dataStr !== '[DONE]') {
              try {
                const parsed = JSON.parse(dataStr)
                const choice = parsed?.choices?.[0]
                if (choice) {
                  // Extract text content
                  if (choice.delta?.content) {
                    accumulatedText += choice.delta.content
                  }
                  // Extract finish_reason
                  if (choice.finish_reason) {
                    finishReason = choice.finish_reason
                  }
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
        }

        // Construct structured response summary (OpenAI Chat Completion style)
        const responseSummary = {
          id: `chatcmpl_${Date.now()}`,
          object: 'chat.completion',
          model: target.modelId,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: accumulatedText
            },
            finish_reason: finishReason ?? 'stop'
          }],
          usage: {
            prompt_tokens: inputTokens,
            completion_tokens: outputTokens,
            total_tokens: inputTokens + outputTokens,
            cached_tokens: usageCached ?? 0
          }
        }

        await upsertLogPayload(logId, { response: JSON.stringify(responseSummary) })
      } catch {}
    }

    await finalize(200, null)
    return reply
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    if (!reply.sent) {
      reply.code(500)
    }
    await commitUsage(0, 0)
    await finalize(reply.statusCode >= 400 ? reply.statusCode : 500, message)
    return { error: message }
  } finally {
    decrementActiveRequests()
    if (!finalized && reply.sent) {
      await finalize(reply.statusCode ?? 200, null)
    }
  }
}

/**
 * 旧的 OpenAI Chat handler (保留作为备用，但不再使用)
 * @deprecated 使用统一handler和handleOpenAIChatProtocol替代
 */
async function registerOpenAIChatHandler(
  app: FastifyInstance,
  path: string,
  endpointId: string
): Promise<void> {
  const handler = async (request: any, reply: any) => {
    // 实时读取endpoint配置
    const endpoint = getCurrentEndpointConfig(endpointId, request.url, app)
    if (!endpoint) {
      reply.code(404)
      return { error: 'Endpoint not found, disabled, or path changed' }
    }

    const payload = request.body
    if (!payload || typeof payload !== 'object') {
      reply.code(400)
      return { error: 'Invalid request body' }
    }

    const providedApiKey = extractApiKeyFromRequest(request)

    let apiKeyContext: Awaited<ReturnType<typeof resolveApiKey>>
    try {
      apiKeyContext = await resolveApiKey(providedApiKey, { ipAddress: request.ip })
    } catch (error) {
      if (error instanceof ApiKeyError) {
        reply.code(401)
        return {
          error: {
            code: 'invalid_api_key',
            message: error.message
          }
        }
      }
      throw error
    }

    const encryptedApiKeyValue = apiKeyContext.providedKey ? encryptSecret(apiKeyContext.providedKey) : null
    let usageRecorded = false
    const commitUsage = async (inputTokens: number, outputTokens: number) => {
      if (usageRecorded) return
      usageRecorded = true
      if (apiKeyContext.id) {
        const safeInput = Number.isFinite(inputTokens) ? inputTokens : 0
        const safeOutput = Number.isFinite(outputTokens) ? outputTokens : 0
        await recordApiKeyUsage(apiKeyContext.id, {
          inputTokens: safeInput,
          outputTokens: safeOutput
        })
      }
    }

    const normalized = normalizeOpenAIChatPayload(payload)
    const requestedModel = typeof payload.model === 'string' ? payload.model : undefined

    const target = resolveRoute({
      payload: normalized,
      requestedModel,
      endpoint: endpointId,
      customRouting: endpoint.routing  // 实时读取
    })

    const requestStart = Date.now()
    const configSnapshot = getConfig()
    const storeRequestPayloads = configSnapshot.storeRequestPayloads !== false
    const storeResponsePayloads = configSnapshot.storeResponsePayloads !== false

    const logId = await recordLog({
      timestamp: requestStart,
      endpoint: endpointId,
      provider: target.providerId,
      model: target.modelId,
      clientModel: requestedModel,
      stream: normalized.stream,
      apiKeyId: apiKeyContext.id,
      apiKeyName: apiKeyContext.name,
      apiKeyValue: encryptedApiKeyValue
    })

    if (storeRequestPayloads) {
      await upsertLogPayload(logId, {
        prompt: (() => {
          try {
            return JSON.stringify(payload)
          } catch {
            return null
          }
        })()
      })
    }

    incrementActiveRequests()

    let finalized = false
    const finalize = async (statusCode: number | null, error: string | null) => {
      if (finalized) return
      await finalizeLog(logId, {
        latencyMs: Date.now() - requestStart,
        statusCode,
        error,
        clientModel: requestedModel ?? null
      })
      finalized = true
    }

    try {
      const providerType = target.provider.type ?? 'openai'
      let connector: ProviderConnector

      if (providerType === 'openai') {
        connector = createOpenAIConnector(target.provider, { defaultPath: 'v1/chat/completions' })
      } else {
        connector = getConnector(target.providerId)
      }

      let providerBody: any
      if (providerType === 'anthropic') {
        providerBody = buildAnthropicBody(normalized, {
          maxTokens: payload.max_tokens,
          temperature: payload.temperature
        })
      } else {
        providerBody = buildProviderBody(normalized, {
          maxTokens: payload.max_tokens,
          temperature: payload.temperature
        })
      }
      providerBody.model = target.modelId
      if (Object.prototype.hasOwnProperty.call(payload, 'stream')) {
        providerBody.stream = Boolean(payload.stream)
      }

      const upstream = await connector.send({
        model: target.modelId,
        body: providerBody,
        stream: normalized.stream
      })

      if (upstream.status >= 400) {
        reply.code(upstream.status)
        const bodyText = upstream.body ? await new Response(upstream.body).text() : ''
        const errorText = bodyText || 'Upstream provider error'
        if (storeResponsePayloads) {
          await upsertLogPayload(logId, { response: bodyText || null })
        }
        await commitUsage(0, 0)
        await finalize(upstream.status, errorText)
        return { error: errorText }
      }

      if (!normalized.stream) {
        const json = await new Response(upstream.body!).json()

        // 提取和记录 token 使用情况
        const usagePayload = json?.usage ?? null
        const inputTokens =
          usagePayload?.prompt_tokens ??
          usagePayload?.input_tokens ??
          target.tokenEstimate ??
          estimateTokens(normalized, target.modelId)
        const outputTokens =
          usagePayload?.completion_tokens ??
          usagePayload?.output_tokens ??
          estimateTextTokens(
            (() => {
              const choice = json?.choices?.[0]?.message?.content
              return typeof choice === 'string' ? choice : ''
            })(),
            target.modelId
          )
        const cached = resolveCachedTokens(usagePayload)
      const cachedTokens = cached.read + cached.creation
        const latencyMs = Date.now() - requestStart

        await updateLogTokens(logId, {
          inputTokens,
          outputTokens,
          cachedTokens,
          cacheReadTokens: cached.read,
          cacheCreationTokens: cached.creation,
          ttftMs: latencyMs,
          tpotMs: computeTpot(latencyMs, outputTokens, { streaming: false })
        })
        await commitUsage(inputTokens, outputTokens)
        await updateMetrics(new Date().toISOString().slice(0, 10), endpointId, {
          requests: 1,
          inputTokens,
          outputTokens,
          latencyMs
        })

        if (storeResponsePayloads) {
          await upsertLogPayload(logId, {
            response: (() => {
              try {
                return JSON.stringify(json)
              } catch {
                return null
              }
            })()
          })
        }

        await finalize(200, null)
        reply.header('content-type', 'application/json')
        return json
      }

      // Streaming - 添加完整的 tracking
      reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8')
      reply.raw.setHeader('cache-control', 'no-cache, no-transform')
      reply.raw.setHeader('connection', 'keep-alive')
      if (typeof reply.raw.writeHead === 'function') {
        reply.raw.writeHead(200)
      }

      const reader = upstream.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let usagePrompt: number | null = null
      let usageCompletion: number | null = null
      let usageCached: number | null = null
    let usageCacheRead = 0
    let usageCacheCreation = 0
      let firstTokenAt: number | null = null
      const capturedChunks: string[] | null = storeResponsePayloads ? [] : null

      try {
        while (true) {
          const { value, done } = await reader.read()
          if (value && !firstTokenAt) {
            firstTokenAt = Date.now()
          }
          if (value) {
            const chunk = decoder.decode(value, { stream: !done })
            buffer += chunk
            reply.raw.write(chunk)

            if (capturedChunks) {
              capturedChunks.push(chunk)
            }

            // 解析 usage
            let newlineIndex = buffer.indexOf('\n')
            while (newlineIndex !== -1) {
              const line = buffer.slice(0, newlineIndex)
              buffer = buffer.slice(newlineIndex + 1)

              const trimmed = line.trim()
              if (!trimmed.startsWith('data:')) {
                newlineIndex = buffer.indexOf('\n')
                continue
              }

              const dataStr = trimmed.slice(5).trim()
              if (dataStr === '[DONE]') {
                newlineIndex = buffer.indexOf('\n')
                continue
              }

              try {
                const parsed = JSON.parse(dataStr)
                const usage = parsed?.usage || parsed?.choices?.[0]?.delta?.usage || null
                if (usage) {
                  usagePrompt = usage.prompt_tokens ?? usage.input_tokens ?? usagePrompt
                  usageCompletion = usage.completion_tokens ?? usage.output_tokens ?? usageCompletion
                  if (typeof usage.cached_tokens === 'number') {
                    usageCached = usage.cached_tokens
                  }
                }
              } catch {
                // ignore parse errors
              }

              newlineIndex = buffer.indexOf('\n')
            }
          }
          if (done) break
        }
      } finally {
        reply.raw.end()
      }

      const latencyMs = Date.now() - requestStart
      const inputTokens =
        usagePrompt ??
        usageCompletion ??
        target.tokenEstimate ??
        estimateTokens(normalized, target.modelId)
      const outputTokens = usageCompletion ?? 0

      await updateLogTokens(logId, {
        inputTokens,
        outputTokens,
        cachedTokens: usageCached,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        ttftMs: firstTokenAt ? firstTokenAt - requestStart : null,
        tpotMs: computeTpot(latencyMs, outputTokens, {
          streaming: true,
          ttftMs: firstTokenAt ? firstTokenAt - requestStart : null
        })
      })
      await commitUsage(inputTokens, outputTokens)
      await updateMetrics(new Date().toISOString().slice(0, 10), endpointId, {
        requests: 1,
        inputTokens,
        outputTokens,
        cachedTokens,
        cacheReadTokens: cached.read,
        cacheCreationTokens: cached.creation,
        latencyMs
      })

      if (storeResponsePayloads && capturedChunks) {
        try {
          const summary = parseSSEToSummary(capturedChunks, 'chat', target.modelId)
          await upsertLogPayload(logId, { response: JSON.stringify(summary) })
        } catch (error) {
          request.log.warn({ error }, 'Failed to persist streamed response')
        }
      }

      await finalize(200, null)
      return reply
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      if (!reply.sent) {
        reply.code(500)
      }
      await commitUsage(0, 0)
      await finalize(reply.statusCode >= 400 ? reply.statusCode : 500, message)
      return { error: message }
    } finally {
      decrementActiveRequests()
      if (!finalized && reply.sent) {
        await finalize(reply.statusCode ?? 200, null)
      }
    }
  }

  app.post(path, handler)
  app.log.info(`Registered OpenAI Chat Completions handler at ${path}`)
}

/**
 * 注册 OpenAI Responses API 协议处理器
 */
async function registerOpenAIResponsesHandler(
  app: FastifyInstance,
  path: string,
  endpointId: string
): Promise<void> {
  const handler = async (request: any, reply: any) => {
    // 实时读取endpoint配置
    const endpoint = getCurrentEndpointConfig(endpointId, request.url, app)
    if (!endpoint) {
      reply.code(404)
      return { error: 'Endpoint not found, disabled, or path changed' }
    }

    const payload = request.body
    if (!payload || typeof payload !== 'object') {
      reply.code(400)
      return { error: 'Invalid request body' }
    }

    const providedApiKey = extractApiKeyFromRequest(request)

    let apiKeyContext: Awaited<ReturnType<typeof resolveApiKey>>
    try {
      apiKeyContext = await resolveApiKey(providedApiKey, { ipAddress: request.ip })
    } catch (error) {
      if (error instanceof ApiKeyError) {
        reply.code(401)
        return {
          error: {
            code: 'invalid_api_key',
            message: error.message
          }
        }
      }
      throw error
    }

    const encryptedApiKeyValue = apiKeyContext.providedKey ? encryptSecret(apiKeyContext.providedKey) : null
    let usageRecorded = false
    const commitUsage = async (inputTokens: number, outputTokens: number) => {
      if (usageRecorded) return
      usageRecorded = true
      if (apiKeyContext.id) {
        const safeInput = Number.isFinite(inputTokens) ? inputTokens : 0
        const safeOutput = Number.isFinite(outputTokens) ? outputTokens : 0
        await recordApiKeyUsage(apiKeyContext.id, {
          inputTokens: safeInput,
          outputTokens: safeOutput
        })
      }
    }

    const normalized = normalizeOpenAIResponsesPayload(payload)
    const requestedModel = typeof payload.model === 'string' ? payload.model : undefined

    const target = resolveRoute({
      payload: normalized,
      requestedModel,
      endpoint: endpointId,
      customRouting: endpoint.routing  // 实时读取
    })

    const requestStart = Date.now()
    const configSnapshot = getConfig()
    const storeRequestPayloads = configSnapshot.storeRequestPayloads !== false
    const storeResponsePayloads = configSnapshot.storeResponsePayloads !== false

    const logId = await recordLog({
      timestamp: requestStart,
      endpoint: endpointId,
      provider: target.providerId,
      model: target.modelId,
      clientModel: requestedModel,
      stream: normalized.stream,
      apiKeyId: apiKeyContext.id,
      apiKeyName: apiKeyContext.name,
      apiKeyValue: encryptedApiKeyValue
    })

    if (storeRequestPayloads) {
      await upsertLogPayload(logId, {
        prompt: (() => {
          try {
            return JSON.stringify(payload)
          } catch {
            return null
          }
        })()
      })
    }

    incrementActiveRequests()

    let finalized = false
    const finalize = async (statusCode: number | null, error: string | null) => {
      if (finalized) return
      await finalizeLog(logId, {
        latencyMs: Date.now() - requestStart,
        statusCode,
        error,
        clientModel: requestedModel ?? null
      })
      finalized = true
    }

    try {
      const providerType = target.provider.type ?? 'openai'
      let connector: ProviderConnector

      if (providerType === 'openai') {
        connector = createOpenAIConnector(target.provider, { defaultPath: 'v1/responses' })
      } else {
        connector = getConnector(target.providerId)
      }

      const providerBody = { ...payload }
      providerBody.model = target.modelId
      if (Object.prototype.hasOwnProperty.call(payload, 'stream')) {
        providerBody.stream = Boolean(payload.stream)
      }

      const upstream = await connector.send({
        model: target.modelId,
        body: providerBody,
        stream: normalized.stream
      })

      if (upstream.status >= 400) {
        reply.code(upstream.status)
        const bodyText = upstream.body ? await new Response(upstream.body).text() : ''
        const errorText = bodyText || 'Upstream provider error'
        if (storeResponsePayloads) {
          await upsertLogPayload(logId, { response: bodyText || null })
        }
        await commitUsage(0, 0)
        await finalize(upstream.status, errorText)
        return { error: errorText }
      }

      if (!normalized.stream) {
        const json = await new Response(upstream.body!).json()

        const usagePayload = json?.usage ?? null
        const inputTokens =
          usagePayload?.input_tokens ??
          usagePayload?.prompt_tokens ??
          target.tokenEstimate ??
          estimateTokens(normalized, target.modelId)
        const outputTokens =
          usagePayload?.output_tokens ??
          usagePayload?.completion_tokens ??
          (typeof json?.content === 'string' ? estimateTextTokens(json.content, target.modelId) : 0)
        const cached = resolveCachedTokens(usagePayload)
      const cachedTokens = cached.read + cached.creation
        const latencyMs = Date.now() - requestStart

        await updateLogTokens(logId, {
          inputTokens,
          outputTokens,
          cachedTokens,
          cacheReadTokens: cached.read,
          cacheCreationTokens: cached.creation,
          ttftMs: latencyMs,
          tpotMs: computeTpot(latencyMs, outputTokens, { streaming: false })
        })
        await commitUsage(inputTokens, outputTokens)
        await updateMetrics(new Date().toISOString().slice(0, 10), endpointId, {
          requests: 1,
          inputTokens,
          outputTokens,
          latencyMs
        })

        if (storeResponsePayloads) {
          await upsertLogPayload(logId, {
            response: (() => {
              try {
                return JSON.stringify(json)
              } catch {
                return null
              }
            })()
          })
        }

        await finalize(200, null)
        reply.header('content-type', 'application/json')
        return json
      }

      // Streaming - 添加完整的 tracking
      reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8')
      reply.raw.setHeader('cache-control', 'no-cache, no-transform')
      reply.raw.setHeader('connection', 'keep-alive')
      if (typeof reply.raw.writeHead === 'function') {
        reply.raw.writeHead(200)
      }

      const reader = upstream.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let usagePrompt: number | null = null
      let usageCompletion: number | null = null
      let usageCached: number | null = null
    let usageCacheRead = 0
    let usageCacheCreation = 0
      let firstTokenAt: number | null = null
      const capturedChunks: string[] | null = storeResponsePayloads ? [] : null

      try {
        while (true) {
          const { value, done } = await reader.read()
          if (value && !firstTokenAt) {
            firstTokenAt = Date.now()
          }
          if (value) {
            const chunk = decoder.decode(value, { stream: !done })
            buffer += chunk
            reply.raw.write(chunk)

            if (capturedChunks) {
              capturedChunks.push(chunk)
            }

            // 解析 usage
            let newlineIndex = buffer.indexOf('\n')
            while (newlineIndex !== -1) {
              const line = buffer.slice(0, newlineIndex)
              buffer = buffer.slice(newlineIndex + 1)

              const trimmed = line.trim()
              if (!trimmed.startsWith('data:')) {
                newlineIndex = buffer.indexOf('\n')
                continue
              }

              const dataStr = trimmed.slice(5).trim()
              if (dataStr === '[DONE]') {
                newlineIndex = buffer.indexOf('\n')
                continue
              }

              try {
                const parsed = JSON.parse(dataStr)
                const usage = parsed?.usage || parsed?.response?.usage || null
                if (usage) {
                  usagePrompt = usage.input_tokens ?? usage.prompt_tokens ?? usagePrompt
                  usageCompletion = usage.output_tokens ?? usage.completion_tokens ?? usageCompletion
                  const cached = resolveCachedTokens(usage)
                  usageCacheRead = cached.read
                  usageCacheCreation = cached.creation
                  usageCached = cached.read + cached.creation
                }
              } catch {
                // ignore parse errors
              }

              newlineIndex = buffer.indexOf('\n')
            }
          }
          if (done) break
        }
      } finally {
        reply.raw.end()
      }

      const latencyMs = Date.now() - requestStart
      const inputTokens =
        usagePrompt ??
        usageCompletion ??
        target.tokenEstimate ??
        estimateTokens(normalized, target.modelId)
      const outputTokens = usageCompletion ?? 0

      await updateLogTokens(logId, {
        inputTokens,
        outputTokens,
        cachedTokens: usageCached,
        cacheReadTokens: usageCacheRead,
        cacheCreationTokens: usageCacheCreation,
        ttftMs: firstTokenAt ? firstTokenAt - requestStart : null,
        tpotMs: computeTpot(latencyMs, outputTokens, {
          streaming: true,
          ttftMs: firstTokenAt ? firstTokenAt - requestStart : null
        })
      })
      await commitUsage(inputTokens, outputTokens)
      await updateMetrics(new Date().toISOString().slice(0, 10), endpointId, {
        requests: 1,
        inputTokens,
        outputTokens,
        cachedTokens,
        cacheReadTokens: cached.read,
        cacheCreationTokens: cached.creation,
        latencyMs
      })

      if (storeResponsePayloads && capturedChunks) {
        try {
          const summary = parseSSEToSummary(capturedChunks, 'responses', target.modelId)
          await upsertLogPayload(logId, { response: JSON.stringify(summary) })
        } catch (error) {
          request.log.warn({ error }, 'Failed to persist streamed response')
        }
      }

      await finalize(200, null)
      return reply
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      if (!reply.sent) {
        reply.code(500)
      }
      await commitUsage(0, 0)
      await finalize(reply.statusCode >= 400 ? reply.statusCode : 500, message)
      return { error: message }
    } finally {
      decrementActiveRequests()
      if (!finalized && reply.sent) {
        await finalize(reply.statusCode ?? 200, null)
      }
    }
  }

  app.post(path, handler)
  app.log.info(`Registered OpenAI Responses handler at ${path}`)
}
