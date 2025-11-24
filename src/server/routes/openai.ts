import type { FastifyInstance } from 'fastify'
import { normalizeOpenAIResponsesPayload } from '../protocol/normalize-openai.js'
import { normalizeOpenAIChatPayload } from '../protocol/normalize-openai-chat.js'
import { resolveRoute } from '../router/index.js'
import { getConnector } from '../providers/registry.js'
import { createOpenAIConnector } from '../providers/openai.js'
import type { ProviderConnector } from '../providers/types.js'
import { recordLog, finalizeLog, updateLogTokens, updateMetrics, upsertLogPayload } from '../logging/logger.js'
import { resolveApiKey, ApiKeyError, recordApiKeyUsage } from '../api-keys/service.js'
import { encryptSecret } from '../security/encryption.js'
import { buildModelsResponse } from './shared/models-handler.js'
import { estimateTokens, estimateTextTokens } from '../protocol/tokenizer.js'
import { buildAnthropicBody, buildProviderBody } from '../protocol/toProvider.js'
import {
  convertAnthropicToOpenAIChat,
  convertAnthropicToOpenAIResponse,
  convertAnthropicContent,
  mapAnthropicStopReasonToChatFinish
} from '../protocol/responseConverter.js'
import { StreamTransformer, type StreamFormat } from '../protocol/streamTransformer.js'
const OPENAI_DEBUG = process.env.CC_GW_DEBUG_OPENAI === '1'
const debugLog = (...args: unknown[]) => {
  if (OPENAI_DEBUG) {
    console.info('[cc-gw][openai]', ...args)
  }
}

const GLOBAL_BETA_OVERRIDE = process.env.CC_GW_ANTHROPIC_BETA_ALL

function resolveAnthropicBetaOverride(modelId: string | undefined): string | null {
  if (!modelId) return GLOBAL_BETA_OVERRIDE ?? null

  const normalized = modelId.replace(/[^a-z0-9]/gi, '_').toUpperCase()
  const specific = process.env[`CC_GW_ANTHROPIC_BETA_${normalized}`]
  if (specific) return specific

  if (GLOBAL_BETA_OVERRIDE) {
    return GLOBAL_BETA_OVERRIDE
  }

  const presets: Array<{ test: RegExp; value: string }> = [
    // Claude 4.5 previews require fine-grained beta headers for streaming/tool use
    { test: /sonnet-4-5/i, value: 'fine-grained-tool-streaming-2025-05-14' },
    { test: /haiku-4-5/i, value: 'fine-grained-tool-streaming-2025-05-14' }
  ]

  for (const preset of presets) {
    if (preset.test.test(modelId)) {
      return preset.value
    }
  }

  return null
}
import { getConfig } from '../config/manager.js'
import type { NormalizedPayload } from '../protocol/types.js'
import { decrementActiveRequests, incrementActiveRequests } from '../metrics/activity.js'

const roundTwoDecimals = (value: number): number => Math.round(value * 100) / 100

function computeTpot(
  totalLatencyMs: number,
  outputTokens: number,
  options?: {
    ttftMs?: number | null
    streaming?: boolean
    reasoningTokens?: number | null
    totalTokens?: number | null
    outputTokensDetails?: Record<string, unknown> | null
    firstReasoningChunkAt?: number | null
  }
): number | null {
  if (!Number.isFinite(outputTokens) || outputTokens <= 0) {
    return null
  }
  const streaming = options?.streaming ?? false
  const ttftMs = options?.ttftMs ?? null
  const reasoningTokens = options?.reasoningTokens ?? 0
  const totalTokensHint = options?.totalTokens ?? null

  let effectiveLatency = totalLatencyMs
  if (streaming && ttftMs != null && totalLatencyMs > 0) {
    const ttftRatio = ttftMs / totalLatencyMs
    if (reasoningTokens > 0) {
      effectiveLatency = totalLatencyMs
    } else if (ttftRatio <= 0.2) {
      effectiveLatency = Math.max(totalLatencyMs - ttftMs, totalLatencyMs * 0.2)
    } else {
      effectiveLatency = totalLatencyMs
    }
  }

  const raw = effectiveLatency / outputTokens
  return Number.isFinite(raw) ? roundTwoDecimals(raw) : null
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

  // OpenAI input_tokens_details 格式
  const inputDetails = usage.input_tokens_details
  if (inputDetails && typeof inputDetails.cached_tokens === 'number') {
    result.read = inputDetails.cached_tokens
  }

  return result
}

const generateId = (prefix: string): string => `${prefix}_${Math.random().toString(36).slice(2, 10)}`

const isText = (input: unknown): input is string => typeof input === 'string' && input.length > 0

function filterForwardedAnthropicHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> {
  if (!headers) return {}
  const result: Record<string, string> = {}
  const allowContentHeaders = new Set(['content-type', 'accept'])
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue
    const lower = key.toLowerCase()
    if (lower.startsWith('anthropic-') || allowContentHeaders.has(lower)) {
      result[lower] = value
    }
  }
  return result
}

function summarizeAnthropicBody(body: Record<string, any> | undefined) {
  if (!body || typeof body !== 'object') {
    return null
  }

  const truncate = (text: string, max = 120) =>
    text.length > max ? `${text.slice(0, max)}…` : text

  const messages = Array.isArray(body.messages)
    ? body.messages.slice(0, 6).map((message: any) => {
        const blocks = Array.isArray(message?.content)
          ? message.content.map((block: any) => block?.type ?? typeof block)
          : undefined
        let preview: string | undefined
        if (Array.isArray(message?.content)) {
          for (const block of message.content) {
            if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
              preview = truncate(block.text.trim(), 80)
              break
            }
          }
        }
        return {
          role: message?.role,
          blocks,
          preview
        }
      })
    : undefined

  return {
    stream: Boolean(body.stream),
    system: isText(body.system) ? truncate(body.system, 80) : undefined,
    max_tokens: body.max_tokens ?? body.max_completion_tokens,
    temperature: body.temperature,
    tool_count: Array.isArray(body.tools) ? body.tools.length : 0,
    tool_choice: body.tool_choice,
    metadata_keys: body.metadata && typeof body.metadata === 'object' ? Object.keys(body.metadata).length : 0,
    message_count: Array.isArray(body.messages) ? body.messages.length : 0,
    messages
  }
}

function convertFunctionsToTools(functions: any[] | undefined): any[] | undefined {
  if (!Array.isArray(functions) || functions.length === 0) return undefined
  return functions.map((fn) => ({
    name: fn?.name,
    description: fn?.description,
    parameters: fn?.parameters ?? {}
  }))
}

function convertFunctionCallToToolChoice(
  toolChoice: any,
  functionCall: any
): any | undefined {
  if (toolChoice !== undefined) {
    return toolChoice
  }
  if (functionCall === undefined || functionCall === null) {
    return undefined
  }
  if (typeof functionCall === 'string') {
    if (functionCall === 'auto' || functionCall === 'none') {
      return functionCall
    }
    return undefined
  }
  if (typeof functionCall === 'object' && typeof functionCall.name === 'string') {
    return {
      type: 'function',
      function: {
        name: functionCall.name
      }
    }
  }
  return undefined
}

function convertOpenAIToolsToAnthropic(tools: any[] | undefined): any[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined
  return tools.map((tool: any) => {
    // OpenAI 格式: { type: 'function', function: { name, description, parameters } }
    // Anthropic 格式: { name, description, input_schema }
    if (tool.type === 'function' && tool.function) {
      return {
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters ?? {}
      }
    }
    // 如果已经是扁平格式（来自 convertFunctionsToTools），直接返回
    if (tool.name) {
      return {
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema ?? tool.parameters ?? {}
      }
    }
    // 降级处理
    return {
      name: tool.function?.name ?? 'unknown',
      description: tool.function?.description ?? '',
      input_schema: tool.function?.parameters ?? {}
    }
  })
}

interface ToolChoiceConversionResult {
  value: any
  warnings: string[]
}

function convertOpenAIToolChoiceToAnthropic(
  toolChoice: any,
  tools?: any[]
): ToolChoiceConversionResult {
  const result: ToolChoiceConversionResult = {
    value: undefined,
    warnings: []
  }

  if (!toolChoice) return result

  // 字符串格式处理
  if (typeof toolChoice === 'string') {
    // 'auto' - 直接返回，Anthropic 支持
    if (toolChoice === 'auto') {
      result.value = 'auto'
      return result
    }

    // 'none' - Anthropic 不支持，返回 undefined（使用默认行为）
    if (toolChoice === 'none') {
      result.value = undefined
      result.warnings.push(
        "tool_choice='none' is not supported by Anthropic. Using default behavior (model may choose to use tools)."
      )
      return result
    }

    // 'required' - 根据工具数量智能选择
    if (toolChoice === 'required') {
      const toolCount = Array.isArray(tools) ? tools.length : 0

      if (toolCount === 0) {
        // 没有工具时，使用 auto
        result.value = 'auto'
        return result
      } else if (toolCount === 1) {
        // 只有一个工具时，强制使用该工具（精确映射）
        result.value = {
          type: 'tool',
          name: tools![0].name
        }
        return result
      } else {
        // 多个工具时，使用 auto（语义不完全匹配）
        result.value = 'auto'
        result.warnings.push(
          `tool_choice='required' with ${toolCount} tools cannot be precisely mapped. ` +
          `Using 'auto'. Note: Anthropic's 'auto' allows skipping tools, unlike OpenAI's 'required'.`
        )
        return result
      }
    }

    // 其他未知字符串返回 undefined
    return result
  }

  // 对象格式处理
  // OpenAI 格式: { type: 'function', function: { name } }
  // Anthropic 格式: { type: 'tool', name }
  if (typeof toolChoice === 'object') {
    if (toolChoice.type === 'function' && toolChoice.function?.name) {
      result.value = {
        type: 'tool',
        name: toolChoice.function.name
      }
      return result
    }
    // 如果已经是 Anthropic 格式，直接返回
    if (toolChoice.type === 'tool' && toolChoice.name) {
      result.value = toolChoice
      return result
    }
  }

  return result
}

function resolveHeaderValue(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const found = value.find((item) => typeof item === 'string' && item.trim().length > 0)
    return found
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

// ============================================================================
// Response Format Conversion Functions
// ============================================================================
//
// The following functions have been moved to protocol/responseConverter.ts
// to eliminate code duplication and provide centralized conversion logic:
//
// - mapClaudeStopReasonToOpenAIStatus → mapAnthropicStopReasonToStatus
// - mapClaudeStopReasonToChatFinish → mapAnthropicStopReasonToChatFinish
// - ConvertedAnthropicContent (interface)
// - convertAnthropicContent
// - BuildOpenAIResponseOptions (interface)
// - buildOpenAIResponseFromClaude → convertAnthropicToOpenAIResponse
// - BuildChatCompletionOptions (interface)
// - buildChatCompletionFromClaude → convertAnthropicToOpenAIChat
//
// Import them from '../protocol/responseConverter.js' instead
// ============================================================================

function collectAnthropicForwardHeaders(
  source: Record<string, string | string[] | undefined>
): Record<string, string> | undefined {
  const collected: Record<string, string> = {}
  const skip = new Set(['content-length', 'host', 'connection', 'transfer-encoding'])

  for (const [key, value] of Object.entries(source)) {
    const lower = key.toLowerCase()
    if (skip.has(lower)) continue
    if (typeof value === 'string' && value.length > 0) {
      collected[lower] = value
    } else if (Array.isArray(value)) {
      const candidate = value.find((item) => typeof item === 'string' && item.length > 0)
      if (candidate) {
        collected[lower] = candidate
      }
    }
  }

  if (!collected['content-type']) {
    collected['content-type'] = 'application/json'
  }

  return Object.keys(collected).length > 0 ? collected : undefined
}

export async function registerOpenAiRoutes(app: FastifyInstance): Promise<void> {
  const handleResponses = async (request: any, reply: any) => {
    const payload = request.body
    if (!payload || typeof payload !== 'object') {
      reply.code(400)
      return { error: 'Invalid request body' }
    }

    request.log.info(
      {
        event: 'responses.request',
        stream: Boolean(payload.stream),
        model: payload.model,
        hasToolChoice: Boolean(payload.tool_choice),
        toolsCount: Array.isArray(payload.tools) ? payload.tools.length : 0
      },
      'openai responses request'
    )

    const providedApiKey = extractApiKeyFromRequest(request)

    const normalized = normalizeOpenAIResponsesPayload(payload)
    const requestedModel = typeof payload.model === 'string' ? payload.model : undefined
    const target = resolveRoute({
      payload: normalized,
      requestedModel,
      endpoint: 'openai'
    })

    request.log.info(
      {
        event: 'responses.target',
        requestedModel,
        provider: target.providerId,
        model: target.modelId,
        endpoint: 'openai'
      },
      'openai responses resolved target'
    )

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

    let connector: ProviderConnector
    const providerType = target.provider.type ?? 'openai'
    if (providerType === 'openai') {
      connector = createOpenAIConnector(target.provider, { defaultPath: 'v1/responses' })
    } else {
      connector = getConnector(target.providerId)
    }
    const requestStart = Date.now()
    const configSnapshot = getConfig()
    const storeRequestPayloads = configSnapshot.storeRequestPayloads !== false
    const storeResponsePayloads = configSnapshot.storeResponsePayloads !== false

    const logId = await recordLog({
      timestamp: requestStart,
      endpoint: 'openai',
      provider: target.providerId,
      model: target.modelId,
      clientModel: requestedModel,
      sessionId: payload.metadata?.user_id ?? payload.user,
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
      let providerHeaders: Record<string, string> | undefined
      let betaHeader: string | null = null
      let providerBody: Record<string, any>

      if (providerType === 'anthropic') {
        const maxTokens =
          typeof payload.max_output_tokens === 'number'
            ? payload.max_output_tokens
            : typeof payload.max_tokens === 'number'
            ? payload.max_tokens
            : undefined

        // 转换 OpenAI 格式的 tools 和 tool_choice 为 Anthropic 格式
        const anthropicTools = convertOpenAIToolsToAnthropic(payload.tools)
        const toolChoiceResult = convertOpenAIToolChoiceToAnthropic(payload.tool_choice, anthropicTools)

        // Log warnings if any
        for (const warning of toolChoiceResult.warnings) {
          app.log.warn({ warning, endpoint: 'openai-chat', tool_choice: payload.tool_choice }, 'tool_choice conversion warning')
        }

        providerBody = buildAnthropicBody(normalized, {
          maxTokens,
          temperature: typeof payload.temperature === 'number' ? payload.temperature : undefined,
          toolChoice: toolChoiceResult.value,
          overrideTools: anthropicTools
        }) as Record<string, any>

        providerBody.model = target.modelId
        if (Object.prototype.hasOwnProperty.call(payload, 'stream')) {
          providerBody.stream = Boolean(payload.stream)
        }

        const rawHeaders = (request.raw?.headers ?? request.headers) as Record<string, string | string[] | undefined>
        const forwarded = collectAnthropicForwardHeaders(rawHeaders)
        providerHeaders = filterForwardedAnthropicHeaders(forwarded)

        betaHeader = resolveAnthropicBetaOverride(target.modelId)
        if (betaHeader) {
          providerHeaders['anthropic-beta'] = betaHeader
        }

        if (OPENAI_DEBUG) {
          try {
            debugLog(
              'responses anthropic payload',
              JSON.stringify(providerBody).slice(0, 800)
            )
          } catch {
            debugLog('responses anthropic payload', '[unserializable]')
          }
        }
        request.log.info(
          {
            event: 'responses.forward_payload',
            provider: target.providerId,
            model: target.modelId,
            summary: summarizeAnthropicBody(providerBody)
          },
          'forwarding anthropic payload (responses)'
        )

        request.log.info(
          {
            event: 'responses.forward_headers',
            provider: target.providerId,
            model: target.modelId,
            headers: providerHeaders
          },
          'forwarding anthropic headers (responses)'
        )
      } else {
        providerBody = { ...payload }

        providerBody.model = target.modelId
        if (Object.prototype.hasOwnProperty.call(payload, 'stream')) {
          providerBody.stream = Boolean(payload.stream)
        }

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

      const queryString = betaHeader ? 'beta=true' : undefined

      const upstream = await connector.send({
        model: target.modelId,
        body: providerBody,
        stream: normalized.stream,
        headers: providerHeaders,
        query: queryString
      })

      if (upstream.status >= 400) {
        reply.code(upstream.status)
        const bodyText = upstream.body ? await new Response(upstream.body).text() : ''
        const errorText = bodyText || 'Upstream provider error'
        debugLog('upstream error', upstream.status, errorText.slice(0, 200))
        if (storeResponsePayloads) {
          await upsertLogPayload(logId, { response: bodyText || null })
        }
        await commitUsage(0, 0)
        await finalize(upstream.status, errorText)
        return { error: errorText }
      }

      if (!normalized.stream) {
        const rawBody = upstream.body ? await new Response(upstream.body).text() : ''
        let parsed: any = null
        try {
          parsed = rawBody ? JSON.parse(rawBody) : {}
        } catch (error) {
          if (storeResponsePayloads) {
            await upsertLogPayload(logId, { response: rawBody })
          }
          await commitUsage(0, 0)
          await finalize(200, null)
          reply.header('content-type', 'application/json')
          return rawBody
        }

        if (providerType === 'anthropic') {
          const usagePayload = parsed?.usage ?? null
          let inputTokens =
            typeof usagePayload?.input_tokens === 'number'
              ? usagePayload.input_tokens
              : typeof usagePayload?.prompt_tokens === 'number'
              ? usagePayload.prompt_tokens
              : target.tokenEstimate ?? estimateTokens(normalized, target.modelId)

          // Convert content for token estimation
          // Note: convertAnthropicToOpenAIResponse also converts internally,
          // but we need aggregatedText for fallback token estimation
          const converted = convertAnthropicContent(parsed?.content)
          let outputTokens =
            typeof usagePayload?.output_tokens === 'number'
              ? usagePayload.output_tokens
              : typeof usagePayload?.completion_tokens === 'number'
              ? usagePayload.completion_tokens
              : 0

          if (!Number.isFinite(outputTokens) || outputTokens <= 0) {
            outputTokens = converted.aggregatedText
              ? estimateTextTokens(converted.aggregatedText, target.modelId)
              : estimateTokens(normalized, target.modelId)
          }

          if (!Number.isFinite(inputTokens) || inputTokens <= 0) {
            inputTokens = target.tokenEstimate ?? estimateTokens(normalized, target.modelId)
          }

          const cached = resolveCachedTokens(usagePayload)
      const cachedTokens = cached.read + cached.creation
          const latencyMs = Date.now() - requestStart

          const openAIResponse = convertAnthropicToOpenAIResponse(parsed, target.modelId, {
            inputTokens,
            outputTokens,
            cachedTokens
          })

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
          await updateMetrics(new Date().toISOString().slice(0, 10), 'openai', {
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
                  return JSON.stringify(openAIResponse)
                } catch {
                  return null
                }
              })()
            })
          }
          await finalize(200, null)
          reply.header('content-type', 'application/json')
          return openAIResponse
        }

        if (storeResponsePayloads) {
          await upsertLogPayload(logId, { response: rawBody })
        }

        const usagePayload = parsed?.usage ?? null
        const inputTokens =
          usagePayload?.input_tokens ??
          usagePayload?.prompt_tokens ??
          target.tokenEstimate ??
          estimateTokens(normalized, target.modelId)
        const baseOutputTokens =
          usagePayload?.output_tokens ??
          usagePayload?.completion_tokens ??
          (typeof parsed?.content === 'string' ? estimateTokens(normalized, target.modelId) : 0)
        const reasoningTokens = (() => {
          const details = usagePayload?.completion_tokens_details
          if (details && typeof details.reasoning_tokens === 'number') {
            return details.reasoning_tokens
          }
          if (typeof usagePayload?.reasoning_tokens === 'number') {
            return usagePayload.reasoning_tokens
          }
          return 0
        })()
        const outputTokens = baseOutputTokens + reasoningTokens
        const cached = resolveCachedTokens(usagePayload)
      const cachedTokens = cached.read + cached.creation
        const latencyMs = Date.now() - requestStart

        await updateLogTokens(logId, {
          inputTokens,
          outputTokens,
          cachedTokens,
          cacheReadTokens: cached.read,
          cacheCreationTokens: cached.creation,
          ttftMs: usagePayload?.first_token_latency_ms ?? latencyMs,
          tpotMs: usagePayload?.tokens_per_second
            ? computeTpot(latencyMs, outputTokens, { streaming: false, reasoningTokens })
            : null
        })
        await commitUsage(inputTokens, outputTokens)
        await updateMetrics(new Date().toISOString().slice(0, 10), 'openai', {
          requests: 1,
          inputTokens,
          outputTokens,
          cachedTokens,
          cacheReadTokens: cached.read,
          cacheCreationTokens: cached.creation,
          latencyMs
        })
        await finalize(200, null)
        reply.header('content-type', 'application/json')
        return parsed ?? {}
      }

      if (!upstream.body) {
        reply.code(500)
        await commitUsage(0, 0)
        await finalize(500, 'Upstream returned empty body')
        return { error: 'Upstream returned empty body' }
      }

      reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8')
      reply.raw.setHeader('cache-control', 'no-cache, no-transform')
      reply.raw.setHeader('connection', 'keep-alive')
      reply.raw.setHeader('x-accel-buffering', 'no')
      if (typeof reply.raw.writeHead === 'function') {
      reply.raw.writeHead(200)
    }
    if (typeof (reply.raw as any).flushHeaders === 'function') {
      ;(reply.raw as any).flushHeaders()
    }

      if (providerType === 'anthropic') {
        // Streaming response - use StreamTransformer for Anthropic → OpenAI Responses conversion
        const reader = upstream.body.getReader()
        const decoder = new TextDecoder()

        // Determine stream format conversion
        const sourceFormat: StreamFormat = 'anthropic' // Anthropic provider
        const targetFormat: StreamFormat = 'openai-responses' // OpenAI Responses API endpoint
        const transformer = new StreamTransformer(sourceFormat, targetFormat, target.modelId)

        let firstTokenAt: number | null = null
        const capturedResponseChunks: string[] | null = storeResponsePayloads ? [] : null

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

            // Capture transformed chunks for logging (OpenAI Responses format)
            if (capturedResponseChunks) {
              capturedResponseChunks.push(transformedChunk)
            }

            // Write transformed chunk to client
            reply.raw.write(transformedChunk)
          }
        } finally {
          reply.raw.end()
        }

        // Get final usage statistics from transformer
        const finalUsage = transformer.getFinalUsage()
        const finalPromptTokens = finalUsage.inputTokens || target.tokenEstimate || estimateTokens(normalized, target.modelId)
        const finalCompletionTokens = finalUsage.outputTokens || estimateTextTokens('', target.modelId)
        const finalCachedRead = finalUsage.cacheReadTokens
        const finalCachedCreation = finalUsage.cacheCreationTokens
        const finalCachedTokens = finalCachedRead + finalCachedCreation

        const totalLatencyMs = Date.now() - requestStart
        const ttftMs = firstTokenAt ? firstTokenAt - requestStart : null

        await updateLogTokens(logId, {
          inputTokens: finalPromptTokens,
          outputTokens: finalCompletionTokens,
          cachedTokens: finalCachedTokens ?? null,
          cacheReadTokens: finalCachedRead,
          cacheCreationTokens: finalCachedCreation,
          ttftMs,
          tpotMs: computeTpot(totalLatencyMs, finalCompletionTokens, {
            streaming: true,
            ttftMs
          })
        })
        await commitUsage(finalPromptTokens, finalCompletionTokens)
        await updateMetrics(new Date().toISOString().slice(0, 10), 'openai', {
          requests: 1,
          inputTokens: finalPromptTokens,
          outputTokens: finalCompletionTokens,
          cachedTokens: finalCachedTokens,
          cacheReadTokens: finalCachedRead,
          cacheCreationTokens: finalCachedCreation,
          latencyMs: totalLatencyMs
        })
        if (storeResponsePayloads && capturedResponseChunks) {
          try {
            await upsertLogPayload(logId, { response: capturedResponseChunks.join('') })
          } catch (error) {
            debugLog('failed to persist streamed payload', error)
          }
        }
        await finalize(200, null)
        return reply
      }

      const reader = upstream.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let usagePrompt: number | null = null
      let usageCompletion: number | null = null
      let usageReasoning: number | null = null
      let usageCached: number | null = null
      let usageCacheRead = 0
      let usageCacheCreation = 0
      let firstTokenAt: number | null = null
      let chunkCount = 0
      const capturedResponseChunks: string[] | null = storeResponsePayloads ? [] : null

      const replyClosed = () => {
        debugLog('client connection closed before completion')
      }
      reply.raw.once('close', replyClosed)

      try {
        const selectMax = (candidates: Array<number | null>, current: number | null) =>
          candidates.reduce<number | null>((max, value) => {
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
              return max == null || value > max ? value : max
            }
            return max
          }, current)

        const applyUsagePayload = (usagePayload: any) => {
          usagePrompt = selectMax(
            [
              typeof usagePayload.prompt_tokens === 'number' ? usagePayload.prompt_tokens : null,
              typeof usagePayload.input_tokens === 'number' ? usagePayload.input_tokens : null,
              typeof usagePayload.total_tokens === 'number' &&
              typeof usagePayload.completion_tokens === 'number'
                ? usagePayload.total_tokens - usagePayload.completion_tokens
                : null
            ],
            usagePrompt
          )

          const reasoningTokens =
            typeof usagePayload?.completion_tokens_details?.reasoning_tokens === 'number'
              ? usagePayload.completion_tokens_details.reasoning_tokens
              : typeof usagePayload.reasoning_tokens === 'number'
              ? usagePayload.reasoning_tokens
              : null

          usageCompletion = selectMax(
            [
              typeof usagePayload.output_tokens === 'number' ? usagePayload.output_tokens : null,
              typeof usagePayload.completion_tokens === 'number' ? usagePayload.completion_tokens : null,
              typeof usagePayload.response_tokens === 'number' ? usagePayload.response_tokens : null,
              typeof usagePayload.total_tokens === 'number' && typeof usagePrompt === 'number'
                ? usagePayload.total_tokens - usagePrompt
                : null,
              reasoningTokens
            ],
            usageCompletion
          )

          usageReasoning = selectMax(
            [reasoningTokens],
            usageReasoning
          )

          if (usageCached == null) {
            const cachedResult = resolveCachedTokens(usagePayload)
            usageCacheRead = cachedResult.read
            usageCacheCreation = cachedResult.creation
            usageCached = cachedResult.read + cachedResult.creation
          }
          if (OPENAI_DEBUG) {
            debugLog('usage payload received', usagePayload)
          }
        }

        while (true) {
          const { value, done } = await reader.read()
          if (value && !firstTokenAt) {
            firstTokenAt = Date.now()
          }
          if (value) {
            const chunk = decoder.decode(value, { stream: !done })
            if (OPENAI_DEBUG) {
              debugLog('sse chunk', chunk.length > 200 ? `${chunk.slice(0, 200)}…` : chunk)
            }
            buffer += chunk
            chunkCount += 1

            // 透传上游的chunks到客户端
            reply.raw.write(chunk)
            if (capturedResponseChunks) {
              capturedResponseChunks.push(chunk)
            }

            // 解析完整的行用于日志记录
            while (true) {
              const newlineIndex = buffer.indexOf('\n')
              if (newlineIndex === -1) break

              const line = buffer.slice(0, newlineIndex)
              buffer = buffer.slice(newlineIndex + 1)

              const trimmed = line.trim()
              if (!trimmed.startsWith('data:')) continue

              const dataStr = trimmed.slice(5).trim()
              if (dataStr === '[DONE]') {
                if (OPENAI_DEBUG) {
                  debugLog('done marker received')
                }
                continue
              }

              try {
                const parsed = JSON.parse(dataStr)

                const usagePayload = parsed?.usage || parsed?.response?.usage || null
                if (usagePayload) {
                  applyUsagePayload(usagePayload)
                }
              } catch (parseError) {
                // JSON解析失败，可能是不完整的数据
                if (OPENAI_DEBUG) {
                  debugLog('failed to parse SSE data line (possibly incomplete):', dataStr.slice(0, 100))
                }
              }
            }
          }
          if (done) {
            if (buffer.length > 0) {
              const trimmed = buffer.trim()
              if (trimmed.startsWith('data:')) {
                const dataStr = trimmed.slice(5).trim()
                if (dataStr !== '[DONE]') {
                  try {
                    const parsed = JSON.parse(dataStr)
                    const usagePayload = parsed?.usage || parsed?.response?.usage || null
                    if (usagePayload) {
                      applyUsagePayload(usagePayload)
                    }
                  } catch {
                    // ignore parse errors on trailing buffer
                  }
                }
              }
            }
            break
          }
        }
      } finally {
        reply.raw.end()
        reply.raw.removeListener('close', replyClosed)
        debugLog('stream finished', { chunkCount, usagePrompt, usageCompletion, usageReasoning, usageCached })
        if (capturedResponseChunks && capturedResponseChunks.length > 0) {
          try {
            await upsertLogPayload(logId, { response: capturedResponseChunks.join('') })
          } catch (error) {
            debugLog('failed to persist streamed payload', error)
          }
        }
      }

      const latencyMs = Date.now() - requestStart
      const inputTokens = usagePrompt ?? usageCompletion ?? target.tokenEstimate ?? estimateTokens(normalized, target.modelId)
      const textOutputTokens = usageCompletion ?? 0
      const reasoningTokens = usageReasoning ?? 0
      const outputTokens = textOutputTokens + reasoningTokens
      const hasCacheStats = usageCached != null
      const resolvedCachedTokens = hasCacheStats ? usageCached : null
      const resolvedCacheRead = hasCacheStats ? usageCacheRead : null
      const resolvedCacheCreation = hasCacheStats ? usageCacheCreation : null

      await updateLogTokens(logId, {
        inputTokens,
        outputTokens,
        cachedTokens: resolvedCachedTokens,
        cacheReadTokens: resolvedCacheRead,
        cacheCreationTokens: resolvedCacheCreation,
        ttftMs: firstTokenAt ? firstTokenAt - requestStart : null,
        tpotMs: computeTpot(latencyMs, outputTokens, {
          streaming: true,
          ttftMs: firstTokenAt ? firstTokenAt - requestStart : null,
          reasoningTokens
        })
      })
      await commitUsage(inputTokens, outputTokens)
      await updateMetrics(new Date().toISOString().slice(0, 10), 'openai', {
        requests: 1,
        inputTokens,
        outputTokens,
        cachedTokens: resolvedCachedTokens ?? 0,
        cacheReadTokens: resolvedCacheRead ?? 0,
        cacheCreationTokens: resolvedCacheCreation ?? 0,
        latencyMs
      })
      await finalize(200, null)
      return reply
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error'
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

  const handleChatCompletions = async (request: any, reply: any) => {
    const payload = request.body
    if (!payload || typeof payload !== 'object') {
      reply.code(400)
      return { error: 'Invalid request body' }
    }

    debugLog('chat completions request', {
      stream: Boolean(payload.stream),
      model: payload.model,
      hasFunctions: Array.isArray(payload.functions),
      hasTools: Array.isArray(payload.tools)
    })

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
      endpoint: 'openai'
    })

    let connector: ProviderConnector
    const providerType = target.provider.type ?? 'openai'
    if (providerType === 'openai') {
      connector = createOpenAIConnector(target.provider, { defaultPath: 'v1/chat/completions' })
    } else {
      connector = getConnector(target.providerId)
    }

    const requestStart = Date.now()
    const configSnapshot = getConfig()
    const storeRequestPayloads = configSnapshot.storeRequestPayloads !== false
    const storeResponsePayloads = configSnapshot.storeResponsePayloads !== false

    const logId = await recordLog({
      timestamp: requestStart,
      endpoint: 'openai',
      provider: target.providerId,
      model: target.modelId,
      clientModel: requestedModel,
      sessionId: payload.user,
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
      const overrideTools =
        Array.isArray(payload.tools) && payload.tools.length > 0
          ? payload.tools
          : convertFunctionsToTools(payload.functions)
      const toolChoice = convertFunctionCallToToolChoice(payload.tool_choice, payload.function_call)

      let providerHeaders: Record<string, string> | undefined
      let providerBody: Record<string, any>
      let betaHeader: string | null = null

      if (providerType === 'anthropic') {
        const maxTokens =
          typeof payload.max_tokens === 'number'
            ? payload.max_tokens
            : typeof payload.max_completion_tokens === 'number'
            ? payload.max_completion_tokens
            : undefined

        // 转换 OpenAI 格式的 tools 和 tool_choice 为 Anthropic 格式
        const anthropicTools = convertOpenAIToolsToAnthropic(overrideTools)
        const toolChoiceResult = convertOpenAIToolChoiceToAnthropic(toolChoice, anthropicTools)

        // Log warnings if any
        for (const warning of toolChoiceResult.warnings) {
          app.log.warn({ warning, endpoint: 'openai-responses', tool_choice: toolChoice }, 'tool_choice conversion warning')
        }

        providerBody = buildAnthropicBody(normalized, {
          maxTokens,
          temperature: typeof payload.temperature === 'number' ? payload.temperature : undefined,
          toolChoice: toolChoiceResult.value,
          overrideTools: anthropicTools
        }) as Record<string, any>

        providerBody.model = target.modelId
        if (Object.prototype.hasOwnProperty.call(payload, 'stream')) {
          providerBody.stream = Boolean(payload.stream)
        }

        const rawHeaders = (request.raw?.headers ?? request.headers) as Record<string, string | string[] | undefined>
        const forwarded = collectAnthropicForwardHeaders(rawHeaders)
        providerHeaders = filterForwardedAnthropicHeaders(forwarded)

        betaHeader = resolveAnthropicBetaOverride(target.modelId)
        if (betaHeader) {
          providerHeaders['anthropic-beta'] = betaHeader
        }

        if (OPENAI_DEBUG) {
          try {
            debugLog(
              'chat completions anthropic payload',
              JSON.stringify(providerBody).slice(0, 800)
            )
          } catch {
            debugLog('chat completions anthropic payload', '[unserializable]')
          }
        }
        request.log.info(
          {
            event: 'chat.completions.forward_payload',
            provider: target.providerId,
            model: target.modelId,
            summary: summarizeAnthropicBody(providerBody)
          },
          'forwarding anthropic payload (chat completions)'
        )

        request.log.info(
          {
            event: 'chat.completions.forward_headers',
            provider: target.providerId,
            model: target.modelId,
            headers: providerHeaders
          },
          'forwarding anthropic headers (chat completions)'
        )
      } else {
        providerBody = buildProviderBody(normalized, {
          maxTokens: typeof payload.max_tokens === 'number' ? payload.max_tokens : undefined,
          temperature: typeof payload.temperature === 'number' ? payload.temperature : undefined,
          toolChoice,
          overrideTools,
          providerType
        }) as Record<string, any>

        providerBody.model = target.modelId
        if (Object.prototype.hasOwnProperty.call(payload, 'stream')) {
          providerBody.stream = Boolean(payload.stream)
        }

        if (Array.isArray(payload.functions) && !providerBody.functions) {
          providerBody.functions = payload.functions
        }
        if (payload.function_call !== undefined && providerBody.function_call === undefined) {
          providerBody.function_call = payload.function_call
        }
      }

      const queryString = betaHeader ? 'beta=true' : undefined

      const upstream = await connector.send({
        model: target.modelId,
        body: providerBody,
        stream: normalized.stream,
        headers: providerHeaders,
        query: queryString
      })

      if (upstream.status >= 400) {
        reply.code(upstream.status)
        const bodyText = upstream.body ? await new Response(upstream.body).text() : ''
        const errorText = bodyText || 'Upstream provider error'
        request.log.warn(
          {
            event: 'chat.completions.upstream_error',
            status: upstream.status,
            provider: target.providerId,
            model: target.modelId,
            body: bodyText || null
          },
          'chat completions upstream error'
        )
        if (storeResponsePayloads) {
          await upsertLogPayload(logId, { response: bodyText || null })
        }
        await commitUsage(0, 0)
        await finalize(upstream.status, errorText)
        try {
          return bodyText ? JSON.parse(bodyText) : { error: { message: errorText } }
        } catch {
          return { error: { message: errorText } }
        }
      }

      if (!normalized.stream) {
        const rawBody = upstream.body ? await new Response(upstream.body).text() : ''
        let parsed: any = null
        try {
          parsed = rawBody ? JSON.parse(rawBody) : {}
        } catch (error) {
          if (storeResponsePayloads) {
            await upsertLogPayload(logId, { response: rawBody })
          }
          await commitUsage(0, 0)
          await finalize(200, null)
          reply.header('content-type', 'application/json')
          return rawBody
        }

        if (providerType === 'anthropic') {
          const usagePayload = parsed?.usage ?? null
          let inputTokens =
            typeof usagePayload?.input_tokens === 'number'
              ? usagePayload.input_tokens
              : typeof usagePayload?.prompt_tokens === 'number'
              ? usagePayload.prompt_tokens
              : target.tokenEstimate ?? estimateTokens(normalized, target.modelId)

          const converted = convertAnthropicContent(parsed?.content)
          let outputTokens =
            typeof usagePayload?.output_tokens === 'number'
              ? usagePayload.output_tokens
              : typeof usagePayload?.completion_tokens === 'number'
              ? usagePayload.completion_tokens
              : 0

          if (!Number.isFinite(outputTokens) || outputTokens <= 0) {
            outputTokens = converted.aggregatedText
              ? estimateTextTokens(converted.aggregatedText, target.modelId)
              : estimateTokens(normalized, target.modelId)
          }

          if (!Number.isFinite(inputTokens) || inputTokens <= 0) {
            inputTokens = target.tokenEstimate ?? estimateTokens(normalized, target.modelId)
          }

          const cached = resolveCachedTokens(usagePayload)
          const cachedTokens = cached.read + cached.creation

          const openAIResponse = convertAnthropicToOpenAIChat(parsed, target.modelId, {
            inputTokens,
            outputTokens,
            cachedTokens
          })

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
          await updateMetrics(new Date().toISOString().slice(0, 10), 'openai', {
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
                  return JSON.stringify(openAIResponse)
                } catch {
                  return null
                }
              })()
            })
          }

          await finalize(200, null)
          reply.header('content-type', 'application/json')
          return openAIResponse
        }

        if (storeResponsePayloads) {
          await upsertLogPayload(logId, { response: rawBody })
        }

        const usagePayload = parsed?.usage ?? null
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
              const choice = parsed?.choices?.[0]?.message?.content
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
          ttftMs: usagePayload?.first_token_latency_ms ?? latencyMs,
          tpotMs: usagePayload?.tokens_per_second
            ? computeTpot(latencyMs, outputTokens, { streaming: false })
            : null
        })
        await commitUsage(inputTokens, outputTokens)
        await updateMetrics(new Date().toISOString().slice(0, 10), 'openai', {
          requests: 1,
          inputTokens,
          outputTokens,
          cachedTokens,
          cacheReadTokens: cached.read,
          cacheCreationTokens: cached.creation,
          latencyMs
        })
        await finalize(200, null)
        reply.header('content-type', 'application/json')
        return parsed ?? {}
      }

      if (!upstream.body) {
        reply.code(500)
        await commitUsage(0, 0)
        await finalize(500, 'Upstream returned empty body')
        return { error: 'Upstream returned empty body' }
      }

      reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8')
      reply.raw.setHeader('cache-control', 'no-cache, no-transform')
      reply.raw.setHeader('connection', 'keep-alive')
      reply.raw.setHeader('x-accel-buffering', 'no')
      if (typeof reply.raw.writeHead === 'function') {
        reply.raw.writeHead(200)
      }
      if (typeof (reply.raw as any).flushHeaders === 'function') {
        ;(reply.raw as any).flushHeaders()
      }

      if (providerType === 'anthropic') {
        // Streaming response - use StreamTransformer for Anthropic → OpenAI Chat conversion
        const reader = upstream.body.getReader()
        const decoder = new TextDecoder()

        // Determine stream format conversion
        const sourceFormat: StreamFormat = 'anthropic' // Anthropic provider
        const targetFormat: StreamFormat = 'openai-chat' // OpenAI Chat Completions endpoint
        const transformer = new StreamTransformer(sourceFormat, targetFormat, target.modelId)

        let firstTokenAt: number | null = null
        const capturedResponseChunks: string[] | null = storeResponsePayloads ? [] : null

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

            // Capture transformed chunks for logging (OpenAI Chat format)
            if (capturedResponseChunks) {
              capturedResponseChunks.push(transformedChunk)
            }

            // Write transformed chunk to client
            reply.raw.write(transformedChunk)
          }
        } finally {
          reply.raw.end()
        }

        // Get final usage statistics from transformer
        const finalUsage = transformer.getFinalUsage()
        const finalPromptTokens = finalUsage.inputTokens || target.tokenEstimate || estimateTokens(normalized, target.modelId)
        const finalCompletionTokens = finalUsage.outputTokens || estimateTextTokens('', target.modelId)
        const finalCachedRead = finalUsage.cacheReadTokens
        const finalCachedCreation = finalUsage.cacheCreationTokens
        const finalCachedTokens = finalCachedRead + finalCachedCreation

        const totalLatencyMs = Date.now() - requestStart
        const ttftMs = firstTokenAt ? firstTokenAt - requestStart : null

        await updateLogTokens(logId, {
          inputTokens: finalPromptTokens,
          outputTokens: finalCompletionTokens,
          cachedTokens: finalCachedTokens ?? null,
          cacheReadTokens: finalCachedRead,
          cacheCreationTokens: finalCachedCreation,
          ttftMs,
          tpotMs: computeTpot(totalLatencyMs, finalCompletionTokens, {
            streaming: true,
            ttftMs
          })
        })
        await commitUsage(finalPromptTokens, finalCompletionTokens)
        await updateMetrics(new Date().toISOString().slice(0, 10), 'openai', {
          requests: 1,
          inputTokens: finalPromptTokens,
          outputTokens: finalCompletionTokens,
          cachedTokens: finalCachedTokens,
          cacheReadTokens: finalCachedRead,
          cacheCreationTokens: finalCachedCreation,
          latencyMs: totalLatencyMs
        })
        if (storeResponsePayloads && capturedResponseChunks) {
          try {
            await upsertLogPayload(logId, { response: capturedResponseChunks.join('') })
          } catch (error) {
            debugLog('failed to persist streamed payload', error)
          }
        }
        await finalize(200, null)
        return reply
      }

      const reader = upstream.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let usagePrompt: number | null = null
      let usageCompletion: number | null = null
      let usageCached: number | null = null
      let usageCacheRead = 0
      let usageCacheCreation = 0
      let firstTokenAt: number | null = null
      const capturedResponseChunks: string[] | null = storeResponsePayloads ? [] : null

      const replyClosed = () => {
        debugLog('client connection closed before completion')
      }
      reply.raw.once('close', replyClosed)

      try {
        const selectMax = (candidates: Array<number | null>, current: number | null) =>
          candidates.reduce<number | null>((max, value) => {
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
              return max == null || value > max ? value : max
            }
            return max
          }, current)

        const applyUsagePayload = (usagePayload: any) => {
          usagePrompt = selectMax(
            [
              typeof usagePayload.prompt_tokens === 'number' ? usagePayload.prompt_tokens : null,
              typeof usagePayload.input_tokens === 'number' ? usagePayload.input_tokens : null,
              typeof usagePayload.total_tokens === 'number' && typeof usageCompletion === 'number'
                ? usagePayload.total_tokens - usageCompletion
                : null
            ],
            usagePrompt
          )

          usageCompletion = selectMax(
            [
              typeof usagePayload.output_tokens === 'number' ? usagePayload.output_tokens : null,
              typeof usagePayload.completion_tokens === 'number' ? usagePayload.completion_tokens : null,
              typeof usagePayload.response_tokens === 'number' ? usagePayload.response_tokens : null,
              typeof usagePayload.total_tokens === 'number' && typeof usagePrompt === 'number'
                ? usagePayload.total_tokens - usagePrompt
                : null
            ],
            usageCompletion
          )

          if (usageCached == null) {
            const cachedResult = resolveCachedTokens(usagePayload)
            usageCacheRead = cachedResult.read
            usageCacheCreation = cachedResult.creation
            usageCached = cachedResult.read + cachedResult.creation
          }
        }

        while (true) {
          const { value, done } = await reader.read()
          if (value && !firstTokenAt) {
            firstTokenAt = Date.now()
          }
          if (value) {
            const chunk = decoder.decode(value, { stream: !done })
            buffer += chunk
            reply.raw.write(chunk)
            if (capturedResponseChunks) {
              capturedResponseChunks.push(chunk)
            }

            while (true) {
              const newlineIndex = buffer.indexOf('\n')
              if (newlineIndex === -1) break

              const line = buffer.slice(0, newlineIndex)
              buffer = buffer.slice(newlineIndex + 1)
              const trimmed = line.trim()
              if (!trimmed.startsWith('data:')) continue
              const dataStr = trimmed.slice(5).trim()
              if (dataStr === '[DONE]') continue
              try {
                const parsed = JSON.parse(dataStr)
                const usagePayload = parsed?.usage || parsed?.response?.usage || null
                if (usagePayload) {
                  applyUsagePayload(usagePayload)
                }
              } catch {
                // ignore
              }
            }
          }
          if (done) {
            if (buffer.length > 0) {
              const trimmed = buffer.trim()
              if (trimmed.startsWith('data:')) {
                const dataStr = trimmed.slice(5).trim()
                if (dataStr !== '[DONE]') {
                  try {
                    const parsed = JSON.parse(dataStr)
                    const usagePayload = parsed?.usage || parsed?.response?.usage || null
                    if (usagePayload) {
                      applyUsagePayload(usagePayload)
                    }
                  } catch {
                    // ignore
                  }
                }
              }
            }
            break
          }
        }
      } finally {
        reply.raw.end()
        reply.raw.removeListener('close', replyClosed)
        if (capturedResponseChunks && capturedResponseChunks.length > 0) {
          try {
            await upsertLogPayload(logId, { response: capturedResponseChunks.join('') })
          } catch (error) {
            debugLog('failed to persist streamed payload', error)
          }
        }
      }

      const latencyMs = Date.now() - requestStart
      const inputTokens =
        usagePrompt ??
        usageCompletion ??
        target.tokenEstimate ??
        estimateTokens(normalized, target.modelId)
      const outputTokens = usageCompletion ?? 0
      const hasCacheStats = usageCached != null
      const resolvedCachedTokens = hasCacheStats ? usageCached : null
      const resolvedCacheRead = hasCacheStats ? usageCacheRead : null
      const resolvedCacheCreation = hasCacheStats ? usageCacheCreation : null

      await updateLogTokens(logId, {
        inputTokens,
        outputTokens,
        cachedTokens: resolvedCachedTokens,
        cacheReadTokens: resolvedCacheRead,
        cacheCreationTokens: resolvedCacheCreation,
        ttftMs: firstTokenAt ? firstTokenAt - requestStart : null,
        tpotMs: computeTpot(latencyMs, outputTokens, {
          streaming: true,
          ttftMs: firstTokenAt ? firstTokenAt - requestStart : null
        })
      })
      await commitUsage(inputTokens, outputTokens)
      await updateMetrics(new Date().toISOString().slice(0, 10), 'openai', {
        requests: 1,
        inputTokens,
        outputTokens,
        cachedTokens: resolvedCachedTokens ?? 0,
        cacheReadTokens: resolvedCacheRead ?? 0,
        cacheCreationTokens: resolvedCacheCreation ?? 0,
        latencyMs
      })
      await finalize(200, null)
      return reply
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error'
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

  const handleModels = async (request: any, reply: any) => {
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
    const data = buildModelsResponse(configSnapshot, 'openai')

    reply.header('content-type', 'application/json')
    return {
      object: 'list',
      data
    }
  }

  app.get('/openai/v1/models', handleModels)
  app.get('/openai/models', handleModels)

  app.post('/openai/v1/chat/completions', handleChatCompletions)
  app.post('/openai/chat/completions', handleChatCompletions)

  app.post('/openai/v1/responses', handleResponses)
  app.post('/openai/responses', handleResponses)
}
