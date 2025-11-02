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
import { estimateTokens, estimateTextTokens } from '../protocol/tokenizer.js'
import { buildAnthropicBody, buildProviderBody } from '../protocol/toProvider.js'
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

function mapClaudeStopReasonToOpenAIStatus(reason: string | null | undefined): string {
  switch (reason) {
    case 'tool_use':
      return 'requires_action'
    case 'max_tokens':
    case 'stop_sequence':
      return 'incomplete'
    default:
      return 'completed'
  }
}

function mapClaudeStopReasonToChatFinish(reason: string | null | undefined): string | null {
  switch (reason) {
    case 'tool_use':
      return 'tool_calls'
    case 'max_tokens':
      return 'length'
    case 'stop_sequence':
      return 'stop'
    case 'end_turn':
    case 'stop':
      return 'stop'
    default:
      return reason ?? null
  }
}

interface ConvertedAnthropicContent {
  content: any[]
  aggregatedText: string
}

function convertAnthropicContent(blocks: any): ConvertedAnthropicContent {
  const result: ConvertedAnthropicContent = {
    content: [],
    aggregatedText: ''
  }
  if (!Array.isArray(blocks)) {
    return result
  }

  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const type = block.type ?? ''

    if (type === 'text') {
      const text = typeof block.text === 'string'
        ? block.text
        : Array.isArray(block.content)
        ? block.content
            .filter((item: any) => item && typeof item === 'object' && typeof item.text === 'string')
            .map((item: any) => item.text)
            .join('')
        : ''
      const id = typeof block.id === 'string' ? block.id : generateId('text')
      result.content.push({
        id,
        type: 'output_text',
        text
      })
      if (text) {
        result.aggregatedText += text
      }
      continue
    }

    if (type === 'tool_use') {
      result.content.push({
        id: typeof block.id === 'string' ? block.id : generateId('tool'),
        type: 'tool_use',
        name: typeof block.name === 'string' ? block.name : 'tool',
        input: block.input ?? {},
        cache_control: block.cache_control
      })
      continue
    }

    if (type === 'tool_result') {
      const id =
        typeof block.id === 'string'
          ? block.id
          : block.tool_use_id
          ? `result_${block.tool_use_id}`
          : generateId('tool_result')
      result.content.push({
        id,
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content: block.content ?? null,
        cache_control: block.cache_control
      })
      continue
    }
  }

  return result
}

interface BuildOpenAIResponseOptions {
  inputTokens: number
  outputTokens: number
  cachedTokens: number | null
}

function buildOpenAIResponseFromClaude(
  claude: any,
  model: string,
  converted: ConvertedAnthropicContent,
  usage: BuildOpenAIResponseOptions
): any {
  const created = Math.floor(Date.now() / 1000)
  const responseId =
    typeof claude?.id === 'string' ? claude.id.replace(/^msg_/, 'resp_') : generateId('resp')
  const outputId = `out_${responseId.slice(responseId.indexOf('_') + 1)}`
  const role = typeof claude?.role === 'string' ? claude.role : 'assistant'

  const usagePayload: Record<string, number | null> = {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.inputTokens + usage.outputTokens,
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens
  }
  if (usage.cachedTokens != null) {
    usagePayload.cached_tokens = usage.cachedTokens
  }

  const messageContent = converted.content.map((item) => ({ ...item }))
  const outputContent = converted.content.map((item) => ({ ...item }))

  const response = {
    id: responseId,
    object: 'response',
    created,
    model,
    status: mapClaudeStopReasonToOpenAIStatus(claude?.stop_reason),
    status_code: 200,
    response: {
      id: responseId,
      type: 'message',
      role,
      content: messageContent
    },
    output: [
      {
        id: outputId,
        type: 'output_message',
        role,
        content: outputContent
      }
    ],
    usage: usagePayload,
    metadata: claude?.metadata ?? {},
    stop_reason: claude?.stop_reason ?? null,
    stop_sequence: claude?.stop_sequence ?? null
  }

  if (converted.aggregatedText) {
    ;(response as Record<string, unknown>).output_text = converted.aggregatedText
  }

  return response
}

interface BuildChatCompletionOptions {
  inputTokens: number
  outputTokens: number
}

function buildChatCompletionFromClaude(
  claude: any,
  model: string,
  converted: ConvertedAnthropicContent,
  usage: BuildChatCompletionOptions
): any {
  const created = Math.floor(Date.now() / 1000)
  const chatId =
    typeof claude?.id === 'string' ? claude.id.replace(/^msg_/, 'chatcmpl_') : generateId('chatcmpl')

  const message: Record<string, unknown> = {
    role: typeof claude?.role === 'string' ? claude.role : 'assistant',
    content: converted.aggregatedText ?? ''
  }

  const toolCalls = converted.content
    .filter((item) => item?.type === 'tool_use')
    .map((item, index) => ({
      id: item.id ?? `call_${index}`,
      type: 'function',
      function: {
        name: item.name ?? 'tool',
        arguments: JSON.stringify(item.input ?? {})
      }
    }))

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls
    if (!converted.aggregatedText) {
      message.content = ''
    }
  }

  const usagePayload = {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.inputTokens + usage.outputTokens
  }

  return {
    id: chatId,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        finish_reason: mapClaudeStopReasonToChatFinish(claude?.stop_reason),
        message
      }
    ],
    usage: usagePayload
  }
}

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

        providerBody = buildAnthropicBody(normalized, {
          maxTokens,
          temperature: typeof payload.temperature === 'number' ? payload.temperature : undefined,
          toolChoice: payload.tool_choice,
          overrideTools: Array.isArray(payload.tools) ? payload.tools : undefined
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

          const openAIResponse = buildOpenAIResponseFromClaude(parsed, target.modelId, converted, {
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
        const reader = upstream.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let currentEvent: string | null = null
        const contentBlocks = new Map<number, any>()
        let aggregatedText = ''
        let usagePrompt: number | null = null
        let usageCompletion: number | null = null
        let usageCached: number | null = null
        let usageCacheRead = 0
        let usageCacheCreation = 0
        let lastUsagePayload: any = null
        let firstTokenAt: number | null = null
        let claudeMessageId: string | null = null
        let claudeRole = 'assistant'
        let claudeStopReason: string | null = null
        let claudeStopSequence: string | null = null
        let responseId = generateId('resp')
        const capturedResponseChunks: string[] | null = storeResponsePayloads ? [] : null
        let clientClosed = false
        const replyClosed = () => {
          clientClosed = true
          debugLog('client connection closed before completion')
        }
        reply.raw.once('close', replyClosed)

        const selectMax = (candidates: Array<number | null>, current: number | null) =>
          candidates.reduce<number | null>((max, value) => {
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
              return max == null || value > max ? value : max
            }
            return max
          }, current)

        const applyUsagePayload = (usagePayload: any) => {
          if (!usagePayload || typeof usagePayload !== 'object') {
            return
          }
          usagePrompt = selectMax(
            [
              typeof usagePayload.input_tokens === 'number' ? usagePayload.input_tokens : null,
              typeof usagePayload.prompt_tokens === 'number' ? usagePayload.prompt_tokens : null,
              typeof usagePayload.total_tokens === 'number' &&
              typeof usageCompletion === 'number'
                ? usagePayload.total_tokens - usageCompletion
                : null
            ],
            usagePrompt
          )
          usageCompletion = selectMax(
            [
              typeof usagePayload.output_tokens === 'number' ? usagePayload.output_tokens : null,
              typeof usagePayload.completion_tokens === 'number' ? usagePayload.completion_tokens : null
            ],
            usageCompletion
          )
          if (usageCached == null) {
            const candidate = resolveCachedTokens(usagePayload)
            usageCacheRead = candidate.read
            usageCacheCreation = candidate.creation
            usageCached = candidate.read + candidate.creation
          }
          lastUsagePayload = usagePayload
        }

        const nowSeconds = () => Math.floor(Date.now() / 1000)

        const sendEvent = (payload: Record<string, unknown>) => {
          const serialized = JSON.stringify(payload)
          if (!clientClosed) {
            reply.raw.write(`data: ${serialized}\n\n`)
          }
          if (capturedResponseChunks) {
            capturedResponseChunks.push(`data: ${serialized}\n\n`)
          }
        }

        let createdSent = false
        const ensureCreatedSent = () => {
          if (createdSent) return
          sendEvent({
            id: responseId,
            object: 'response',
            created: nowSeconds(),
            model: target.modelId,
            type: 'response.created'
          })
          createdSent = true
        }

        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            if (!value) continue
            const chunk = decoder.decode(value, { stream: true })
            buffer += chunk

            let newlineIndex = buffer.indexOf('\n')
            while (newlineIndex !== -1) {
              const line = buffer.slice(0, newlineIndex + 1)
              buffer = buffer.slice(newlineIndex + 1)
              const trimmed = line.trim()
              if (!trimmed) {
                newlineIndex = buffer.indexOf('\n')
                continue
              }
              if (trimmed.startsWith('event:')) {
                currentEvent = trimmed.slice(6).trim()
                newlineIndex = buffer.indexOf('\n')
                continue
              }
              if (!trimmed.startsWith('data:')) {
                newlineIndex = buffer.indexOf('\n')
                continue
              }
              const dataStr = trimmed.slice(5).trim()
              if (dataStr === '[DONE]') {
                newlineIndex = buffer.indexOf('\n')
                continue
              }
              let payload: any
              try {
                payload = JSON.parse(dataStr)
              } catch {
                newlineIndex = buffer.indexOf('\n')
                continue
              }

              if (payload?.usage) {
                applyUsagePayload(payload.usage)
              }

              switch (currentEvent) {
                case 'message_start': {
                  const message = payload?.message
                  if (message && typeof message === 'object') {
                    if (typeof message.id === 'string') {
                      claudeMessageId = message.id
                      responseId = message.id.replace(/^msg_/, 'resp_')
                    }
                    if (typeof message.role === 'string') {
                      claudeRole = message.role
                    }
                    ensureCreatedSent()
                  }
                  break
                }
                case 'content_block_start': {
                  const index = typeof payload?.index === 'number' ? payload.index : null
                  const block = payload?.content_block
                  if (index != null && block && typeof block === 'object') {
                    const normalized: any = { ...block }
                    ensureCreatedSent()
                    if (normalized.type === 'text') {
                      normalized.text = typeof normalized.text === 'string' ? normalized.text : ''
                      if (normalized.text) {
                        aggregatedText += normalized.text
                        if (!firstTokenAt && normalized.text.trim().length > 0) {
                          firstTokenAt = Date.now()
                        }
                        sendEvent({
                          id: responseId,
                          object: 'response',
                          created: nowSeconds(),
                          model: target.modelId,
                          type: 'response.output_text.delta',
                          response_id: responseId,
                          output_index: 0,
                          delta: {
                            type: 'output_text.delta',
                            text: normalized.text
                          }
                        })
                      }
                    } else if (normalized.type === 'tool_use') {
                      if (typeof normalized.id !== 'string') {
                        normalized.id = generateId('tool')
                      }
                      if (normalized.input == null || typeof normalized.input !== 'object') {
                        normalized.input = {}
                      }
                      sendEvent({
                        id: responseId,
                        object: 'response',
                        created: nowSeconds(),
                        model: target.modelId,
                        type: 'response.output_tool_call.delta',
                        response_id: responseId,
                        output_index: 0,
                        delta: {
                          type: 'tool_call.delta',
                          tool_call: {
                            id: normalized.id,
                            type: 'function',
                            name: typeof normalized.name === 'string' ? normalized.name : 'tool',
                            arguments: normalized.input ?? {}
                          }
                        }
                      })
                    }
                    contentBlocks.set(index, normalized)
                  }
                  break
                }
                case 'content_block_delta': {
                  const index = typeof payload?.index === 'number' ? payload.index : null
                  if (index == null) break
                  const block = contentBlocks.get(index)
                  if (!block || typeof payload?.delta !== 'object') break
                  if (block.type === 'text') {
                    const deltaValue = payload.delta
                    let deltaText = ''
                    if (typeof deltaValue?.text === 'string') {
                      deltaText = deltaValue.text
                    } else if (Array.isArray(deltaValue?.text)) {
                      deltaText = deltaValue.text.filter((item: any) => typeof item === 'string').join('')
                    }
                    if (deltaText) {
                      ensureCreatedSent()
                      block.text = (block.text ?? '') + deltaText
                      aggregatedText += deltaText
                      if (!firstTokenAt) {
                        firstTokenAt = Date.now()
                      }
                      sendEvent({
                        id: responseId,
                        object: 'response',
                        created: nowSeconds(),
                        model: target.modelId,
                        type: 'response.output_text.delta',
                        response_id: responseId,
                        output_index: 0,
                        delta: {
                          type: 'output_text.delta',
                          text: deltaText
                        }
                      })
                    }
                  } else if (block.type === 'tool_use') {
                    if (payload.delta?.input && typeof payload.delta.input === 'object') {
                      block.input = { ...(block.input ?? {}), ...payload.delta.input }
                      ensureCreatedSent()
                      sendEvent({
                        id: responseId,
                        object: 'response',
                        created: nowSeconds(),
                        model: target.modelId,
                        type: 'response.output_tool_call.delta',
                        response_id: responseId,
                        output_index: 0,
                        delta: {
                          type: 'tool_call.delta',
                          tool_call: {
                            id: block.id,
                            type: 'function',
                            name: typeof block.name === 'string' ? block.name : 'tool',
                            arguments: block.input ?? {}
                          }
                        }
                      })
                    }
                  }
                  break
                }
                case 'message_delta': {
                  if (payload?.delta) {
                    if (payload.delta.stop_reason) {
                      claudeStopReason = payload.delta.stop_reason
                    }
                    if (payload.delta.stop_sequence) {
                      claudeStopSequence = payload.delta.stop_sequence
                    }
                  }
                  break
                }
                case 'message_stop': {
                  if (payload?.usage) {
                    applyUsagePayload(payload.usage)
                  }
                  break
                }
                default:
                  break
              }
              newlineIndex = buffer.indexOf('\n')
            }
          }
        } finally {
          reply.raw.removeListener('close', replyClosed)
        }

        if (buffer.trim().length > 0) {
          const trimmed = buffer.trim()
          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim()
            if (dataStr !== '[DONE]') {
              try {
                const payload = JSON.parse(dataStr)
                if (payload?.usage) {
                  applyUsagePayload(payload.usage)
                }
                if (payload?.delta?.stop_reason) {
                  claudeStopReason = payload.delta.stop_reason
                }
                if (payload?.delta?.stop_sequence) {
                  claudeStopSequence = payload.delta.stop_sequence
                }
              } catch {
                // ignore trailing parse errors
              }
            }
          }
        }

        const sortedBlocks = Array.from(contentBlocks.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([, block]) => block)

        const claudeMessage = {
          id: claudeMessageId ?? responseId.replace(/^resp_/, 'msg_'),
          role: claudeRole,
          content: sortedBlocks,
          stop_reason: claudeStopReason,
          stop_sequence: claudeStopSequence,
          usage: lastUsagePayload
        }

        responseId = claudeMessage.id.replace(/^msg_/, 'resp_')

        const converted = convertAnthropicContent(claudeMessage.content)
        if (!aggregatedText && converted.aggregatedText) {
          aggregatedText = converted.aggregatedText
        }

        ensureCreatedSent()

        let finalPromptTokens =
          typeof usagePrompt === 'number' && usagePrompt > 0
            ? usagePrompt
            : target.tokenEstimate ?? estimateTokens(normalized, target.modelId)
        let finalCompletionTokens =
          typeof usageCompletion === 'number' && usageCompletion > 0
            ? usageCompletion
            : aggregatedText
            ? estimateTextTokens(aggregatedText, target.modelId)
            : 0
        const finalCachedResult = usageCached != null 
          ? { read: usageCacheRead, creation: usageCacheCreation }
          : resolveCachedTokens(lastUsagePayload)
        const finalCachedTokens = finalCachedResult.read + finalCachedResult.creation
        const totalLatencyMs = Date.now() - requestStart
        const ttftMs = firstTokenAt ? firstTokenAt - requestStart : null

        const openAIResponse = buildOpenAIResponseFromClaude(claudeMessage, target.modelId, converted, {
          inputTokens: finalPromptTokens,
          outputTokens: finalCompletionTokens,
          cachedTokens: finalCachedTokens ?? null
        })

        sendEvent({
          id: responseId,
          object: 'response',
          created: nowSeconds(),
          model: target.modelId,
          type: 'response.completed',
          response: openAIResponse.response,
          output: openAIResponse.output,
          usage: openAIResponse.usage,
          status: openAIResponse.status,
          status_code: openAIResponse.status_code
        })
        if (capturedResponseChunks) {
          capturedResponseChunks.push('data: [DONE]\n\n')
        }
        if (!clientClosed) {
          reply.raw.write('data: [DONE]\n\n')
          reply.raw.end()
        }

        await updateLogTokens(logId, {
          inputTokens: finalPromptTokens,
          outputTokens: finalCompletionTokens,
          cachedTokens: finalCachedTokens ?? null,
          cacheReadTokens: finalCachedResult.read,
          cacheCreationTokens: finalCachedResult.creation,
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
          cacheReadTokens: finalCachedResult.read,
          cacheCreationTokens: finalCachedResult.creation,
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

        providerBody = buildAnthropicBody(normalized, {
          maxTokens,
          temperature: typeof payload.temperature === 'number' ? payload.temperature : undefined,
          toolChoice,
          overrideTools
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
          overrideTools
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

          const openAIResponse = buildChatCompletionFromClaude(parsed, target.modelId, converted, {
            inputTokens,
            outputTokens
          })

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
        const reader = upstream.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let currentEvent: string | null = null
        const contentBlocks = new Map<number, any>()
        let aggregatedText = ''
        let usagePrompt: number | null = null
        let usageCompletion: number | null = null
        let usageCached: number | null = null
        let usageCacheRead = 0
        let usageCacheCreation = 0
        let lastUsagePayload: any = null
        let firstTokenAt: number | null = null
        let claudeStopReason: string | null = null
        let claudeStopSequence: string | null = null
        let claudeMessageId: string | null = null
        let responseId = generateId('chatcmpl')
        const toolStates = new Map<
          number,
          { id: string; name: string; input: Record<string, any>; serialized: string }
        >()
        const capturedResponseChunks: string[] | null = storeResponsePayloads ? [] : null
        let clientClosed = false
        const replyClosed = () => {
          clientClosed = true
          debugLog('client connection closed before completion')
        }
        reply.raw.once('close', replyClosed)

        const nowSeconds = () => Math.floor(Date.now() / 1000)

        const selectMax = (candidates: Array<number | null>, current: number | null) =>
          candidates.reduce<number | null>((max, value) => {
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
              return max == null || value > max ? value : max
            }
            return max
          }, current)

        const applyUsagePayload = (usagePayload: any) => {
          if (!usagePayload || typeof usagePayload !== 'object') {
            return
          }
          usagePrompt = selectMax(
            [
              typeof usagePayload.input_tokens === 'number' ? usagePayload.input_tokens : null,
              typeof usagePayload.prompt_tokens === 'number' ? usagePayload.prompt_tokens : null,
              typeof usagePayload.total_tokens === 'number' && typeof usageCompletion === 'number'
                ? usagePayload.total_tokens - usageCompletion
                : null
            ],
            usagePrompt
          )
          usageCompletion = selectMax(
            [
              typeof usagePayload.output_tokens === 'number' ? usagePayload.output_tokens : null,
              typeof usagePayload.completion_tokens === 'number' ? usagePayload.completion_tokens : null
            ],
            usageCompletion
          )
          if (usageCached == null) {
            const candidate = resolveCachedTokens(usagePayload)
            usageCacheRead = candidate.read
            usageCacheCreation = candidate.creation
            usageCached = candidate.read + candidate.creation
          }
          lastUsagePayload = usagePayload
        }

        const sendChunk = (chunk: Record<string, unknown>) => {
          const serialized = JSON.stringify(chunk)
          if (!clientClosed) {
            reply.raw.write(`data: ${serialized}\n\n`)
          }
          if (capturedResponseChunks) {
            capturedResponseChunks.push(`data: ${serialized}\n\n`)
          }
        }

        let initialChunkSent = false
        const ensureInitialChunk = () => {
          if (initialChunkSent) return
          initialChunkSent = true
          sendChunk({
            id: responseId,
            object: 'chat.completion.chunk',
            created: nowSeconds(),
            model: target.modelId,
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant'
                },
                finish_reason: null
              }
            ]
          })
        }

        const updateToolState = (index: number, name: string, input: any) => {
          const existing = toolStates.get(index)
          if (existing) {
            existing.input = { ...(existing.input ?? {}), ...(input ?? {}) }
            const newSerialized = JSON.stringify(existing.input)
            const deltaText = newSerialized.startsWith(existing.serialized)
              ? newSerialized.slice(existing.serialized.length)
              : newSerialized
            existing.serialized = newSerialized
            if (deltaText) {
              ensureInitialChunk()
              sendChunk({
                id: responseId,
                object: 'chat.completion.chunk',
                created: nowSeconds(),
                model: target.modelId,
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index,
                          id: existing.id,
                          type: 'function',
                          function: {
                            name: existing.name,
                            arguments: deltaText
                          }
                        }
                      ]
                    },
                    finish_reason: null
                  }
                ]
              })
            }
            return existing
          }
          const id = generateId('call')
          const serialized = JSON.stringify(input ?? {})
          const initialName = name || 'tool'
          const state = {
            id,
            name: initialName,
            input: { ...(input ?? {}) },
            serialized
          }
          toolStates.set(index, state)
          ensureInitialChunk()
          sendChunk({
            id: responseId,
            object: 'chat.completion.chunk',
            created: nowSeconds(),
            model: target.modelId,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index,
                      id,
                      type: 'function',
                      function: {
                        name: initialName,
                        arguments: ''
                      }
                    }
                  ]
                },
                finish_reason: null
              }
            ]
          })
          if (serialized.length > 2) {
            sendChunk({
              id: responseId,
              object: 'chat.completion.chunk',
              created: nowSeconds(),
              model: target.modelId,
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index,
                        id,
                        type: 'function',
                        function: {
                          name: initialName,
                          arguments: serialized
                        }
                      }
                    ]
                  },
                  finish_reason: null
                }
              ]
            })
          }
          return state
        }

        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            if (!value) continue
            const chunk = decoder.decode(value, { stream: true })
            buffer += chunk

            let newlineIndex = buffer.indexOf('\n')
            while (newlineIndex !== -1) {
              const line = buffer.slice(0, newlineIndex + 1)
              buffer = buffer.slice(newlineIndex + 1)

              const trimmed = line.trim()
              if (!trimmed) {
                newlineIndex = buffer.indexOf('\n')
                continue
              }
              if (trimmed.startsWith('event:')) {
                currentEvent = trimmed.slice(6).trim()
                newlineIndex = buffer.indexOf('\n')
                continue
              }
              if (!trimmed.startsWith('data:')) {
                newlineIndex = buffer.indexOf('\n')
                continue
              }
              const dataStr = trimmed.slice(5).trim()
              if (dataStr === '[DONE]') {
                newlineIndex = buffer.indexOf('\n')
                continue
              }

              let dataPayload: any
              try {
                dataPayload = JSON.parse(dataStr)
              } catch {
                newlineIndex = buffer.indexOf('\n')
                continue
              }

              if (dataPayload?.usage) {
                applyUsagePayload(dataPayload.usage)
              }

              switch (currentEvent) {
                case 'message_start': {
                  const message = dataPayload?.message
                  if (message && typeof message === 'object') {
                    if (typeof message.id === 'string') {
                      claudeMessageId = message.id
                      responseId = message.id.replace(/^msg_/, 'chatcmpl_')
                    }
                    ensureInitialChunk()
                  }
                  break
                }
                case 'content_block_start': {
                  const index = typeof dataPayload?.index === 'number' ? dataPayload.index : null
                  const block = dataPayload?.content_block
                  if (index != null && block && typeof block === 'object') {
                    contentBlocks.set(index, block)
                    if (block.type === 'tool_use') {
                      updateToolState(index, block.name, block.input ?? {})
                    }
                  }
                  break
                }
                case 'content_block_delta': {
                  const index = typeof dataPayload?.index === 'number' ? dataPayload.index : null
                  if (index == null) break
                  const block = contentBlocks.get(index)
                  if (!block) break
                  if (block.type === 'text') {
                    const deltaValue = dataPayload?.delta
                    let deltaText = ''
                    if (typeof deltaValue?.text === 'string') {
                      deltaText = deltaValue.text
                    } else if (Array.isArray(deltaValue?.text)) {
                      deltaText = deltaValue.text.filter((item: any) => typeof item === 'string').join('')
                    }
                    if (deltaText) {
                      ensureInitialChunk()
                      if (!firstTokenAt) {
                        firstTokenAt = Date.now()
                      }
                      aggregatedText += deltaText
                      sendChunk({
                        id: responseId,
                        object: 'chat.completion.chunk',
                        created: nowSeconds(),
                        model: target.modelId,
                        choices: [
                          {
                            index: 0,
                            delta: {
                              content: deltaText
                            },
                            finish_reason: null
                          }
                        ]
                      })
                    }
                  } else if (block.type === 'tool_use') {
                    const deltaInput = dataPayload?.delta?.input
                    const name = typeof block.name === 'string' ? block.name : 'tool'
                    updateToolState(index, name, deltaInput ?? {})
                  }
                  break
                }
                case 'message_delta': {
                  if (dataPayload?.delta) {
                    if (dataPayload.delta.stop_reason) {
                      claudeStopReason = dataPayload.delta.stop_reason
                    }
                    if (dataPayload.delta.stop_sequence) {
                      claudeStopSequence = dataPayload.delta.stop_sequence
                    }
                  }
                  break
                }
                case 'message_stop': {
                  if (dataPayload?.usage) {
                    applyUsagePayload(dataPayload.usage)
                  }
                  break
                }
                default:
                  break
              }

              newlineIndex = buffer.indexOf('\n')
            }
          }
        } finally {
          reply.raw.removeListener('close', replyClosed)
        }

        if (buffer.trim().length > 0) {
          const trimmed = buffer.trim()
          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim()
            if (dataStr !== '[DONE]') {
              try {
                const payloadObj = JSON.parse(dataStr)
                if (payloadObj?.usage) {
                  applyUsagePayload(payloadObj.usage)
                }
                if (payloadObj?.delta?.stop_reason) {
                  claudeStopReason = payloadObj.delta.stop_reason
                }
                if (payloadObj?.delta?.stop_sequence) {
                  claudeStopSequence = payloadObj.delta.stop_sequence
                }
              } catch {
                // ignore
              }
            }
          }
        }

        const sortedBlocks = Array.from(contentBlocks.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([, block]) => block)

        const claudeMessage = {
          id: claudeMessageId ?? responseId.replace(/^chatcmpl_/, 'msg_'),
          role: 'assistant',
          content: sortedBlocks,
          stop_reason: claudeStopReason,
          stop_sequence: claudeStopSequence,
          usage: lastUsagePayload
        }

        const converted = convertAnthropicContent(claudeMessage.content)
        if (!aggregatedText && converted.aggregatedText) {
          aggregatedText = converted.aggregatedText
        }

        const finalPromptTokens =
          typeof usagePrompt === 'number' && usagePrompt > 0
            ? usagePrompt
            : target.tokenEstimate ?? estimateTokens(normalized, target.modelId)
        const finalCompletionTokens =
          typeof usageCompletion === 'number' && usageCompletion > 0
            ? usageCompletion
            : aggregatedText
            ? estimateTextTokens(aggregatedText, target.modelId)
            : 0
        const finalCachedResult = usageCached != null 
          ? { read: usageCacheRead, creation: usageCacheCreation }
          : resolveCachedTokens(lastUsagePayload)
        const finalCachedTokens = finalCachedResult.read + finalCachedResult.creation
        const totalLatencyMs = Date.now() - requestStart
        const ttftMs = firstTokenAt ? firstTokenAt - requestStart : null

        const finishReason = mapClaudeStopReasonToChatFinish(claudeStopReason) ?? 'stop'

        sendChunk({
          id: responseId,
          object: 'chat.completion.chunk',
          created: nowSeconds(),
          model: target.modelId,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: finishReason
            }
          ],
          usage: {
            prompt_tokens: finalPromptTokens,
            completion_tokens: finalCompletionTokens,
            total_tokens: finalPromptTokens + finalCompletionTokens
          }
        })
        if (capturedResponseChunks) {
          capturedResponseChunks.push('data: [DONE]\n\n')
        }
        if (!clientClosed) {
          reply.raw.write('data: [DONE]\n\n')
          reply.raw.end()
        }

        await updateLogTokens(logId, {
          inputTokens: finalPromptTokens,
          outputTokens: finalCompletionTokens,
          cachedTokens: finalCachedTokens ?? null,
          cacheReadTokens: finalCachedResult.read,
          cacheCreationTokens: finalCachedResult.creation,
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
          cacheReadTokens: finalCachedResult.read,
          cacheCreationTokens: finalCachedResult.creation,
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

    const addModel = (modelId: string | null | undefined, provider: typeof configSnapshot.providers[number], isDefault: boolean) => {
      if (!modelId || typeof modelId !== 'string') return
      const trimmed = modelId.trim()
      if (!trimmed) return

      const existing = models.get(trimmed)
      if (existing) {
        existing.providers.push({
          id: provider.id,
          label: provider.label,
          type: provider.type ?? 'custom',
          isDefault
        })
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
