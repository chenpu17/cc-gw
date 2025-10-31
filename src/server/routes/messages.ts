import type { FastifyInstance } from 'fastify'
import { normalizeClaudePayload } from '../protocol/normalize.js'
import { resolveRoute } from '../router/index.js'
import { buildProviderBody } from '../protocol/toProvider.js'
import { getConnector } from '../providers/registry.js'
import { finalizeLog, recordLog, updateLogTokens, updateMetrics, upsertLogPayload } from '../logging/logger.js'
import { estimateTokens, estimateTextTokens } from '../protocol/tokenizer.js'
import { decrementActiveRequests, incrementActiveRequests } from '../metrics/activity.js'
import { getConfig } from '../config/manager.js'
import type { NormalizedPayload } from '../protocol/types.js'
import { resolveApiKey, ApiKeyError, recordApiKeyUsage } from '../api-keys/service.js'
import { encryptSecret } from '../security/encryption.js'

function mapStopReason(reason: string | null | undefined): string | null {
  switch (reason) {
    case 'stop':
      return 'end_turn'
    case 'tool_calls':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    default:
      return reason ?? null
  }
}

function stringifyToolContent(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function mergeText(base: string | undefined, extraParts: string[]): string {
  const parts: string[] = []
  if (base && base.trim().length > 0) {
    parts.push(base)
  }
  for (const part of extraParts) {
    if (part && part.trim().length > 0) {
      parts.push(part)
    }
  }
  return parts.join('\n\n')
}

function stripTooling(payload: NormalizedPayload): NormalizedPayload {
  const messages = payload.messages.map((message) => {
    if (message.role === 'user') {
      const extras = (message.toolResults ?? []).map((result) => {
        const label = result.name || result.id
        const content = stringifyToolContent(result.content)
        return label ? `${label}${content ? `\n${content}` : ''}` : content
      })
      return {
        role: message.role,
        text: mergeText(message.text, extras)
      }
    }

    if (message.role === 'assistant') {
      const extras = (message.toolCalls ?? []).map((call) => {
        const label = call.name || call.id
        const args = stringifyToolContent(call.arguments)
        return label ? `Requested tool ${label}${args ? `\n${args}` : ''}` : args
      })
      return {
        role: message.role,
        text: mergeText(message.text, extras)
      }
    }

    return {
      role: message.role,
      text: message.text
    }
  })

  return {
    ...payload,
    messages,
    tools: []
  }
}

function stripMetadata(payload: NormalizedPayload): NormalizedPayload {
  const original = payload.original
  if (!original || typeof original !== 'object') {
    return payload
  }
  const { metadata, ...rest } = original as Record<string, unknown>
  return {
    ...payload,
    original: rest
  }
}

const roundTwoDecimals = (value: number): number => Math.round(value * 100) / 100

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

function cloneOriginalPayload<T>(value: T): T {
  const structuredCloneFn = (globalThis as any).structuredClone as (<U>(input: U) => U) | undefined
  if (structuredCloneFn) {
    return structuredCloneFn(value)
  }
  return JSON.parse(JSON.stringify(value)) as T
}

function buildClaudeResponse(openAI: any, model: string) {
  const choice = openAI.choices?.[0]
  const message = choice?.message ?? {}
  const contentBlocks: any[] = []
  if (typeof message.content === 'string' && message.content.length > 0) {
    contentBlocks.push({ type: 'text', text: message.content })
  }
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      contentBlocks.push({
        type: 'tool_use',
        id: call.id || `tool_${Math.random().toString(36).slice(2)}`,
        name: call.function?.name,
        input: (() => {
          try {
            return call.function?.arguments ? JSON.parse(call.function.arguments) : {}
          } catch {
            return {}
          }
        })()
      })
    }
  }
  return {
    id: openAI.id ? openAI.id.replace('chatcmpl', 'msg') : `msg_${Math.random().toString(36).slice(2)}`,
    type: 'message',
    role: 'assistant',
    model,
    content: contentBlocks,
    stop_reason: mapStopReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: openAI.usage?.prompt_tokens ?? 0,
      output_tokens: openAI.usage?.completion_tokens ?? 0
    }
  }
}

export async function registerMessagesRoute(app: FastifyInstance): Promise<void> {
  const handler = async (request: any, reply: any) => {
    const payload = request.body
    if (!payload || typeof payload !== 'object') {
      reply.code(400)
      return { error: 'Invalid request body' }
    }

    const resolveHeaderValue = (value: string | string[] | undefined): string | undefined => {
      if (!value) return undefined
      if (typeof value === 'string') return value
      if (Array.isArray(value)) {
        const found = value.find((item) => typeof item === 'string' && item.trim().length > 0)
        return found
      }
      return undefined
    }

    let providedApiKey = resolveHeaderValue(request.headers['x-api-key'] as any)
    if (!providedApiKey) {
      const authHeader = resolveHeaderValue(request.headers['authorization'] as any)
      if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
        providedApiKey = authHeader.slice(7)
      }
    }

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

    request.log.info(
      {
        event: 'anthropic.inbound_request',
        rawUrl,
        query: querySuffix,
        headers: request.headers
      },
      'received anthropic message request'
    )

    const normalized = normalizeClaudePayload(payload)

    const requestedModel = typeof payload.model === 'string' ? payload.model : undefined
    const target = resolveRoute({
      payload: normalized,
      requestedModel
    })

    const providerType = target.provider.type ?? 'custom'
    const supportsTools = (target.provider.type ?? 'custom') !== 'custom'
    const supportsMetadata = providerType !== 'custom'

    let normalizedForProvider = supportsTools ? normalized : stripTooling(normalized)
    if (!supportsMetadata) {
      normalizedForProvider = stripMetadata(normalizedForProvider)
    }
    const maxTokensOverride = payload.max_tokens ?? undefined
    const toolChoice = supportsTools ? payload.tool_choice : undefined
    const overrideTools = supportsTools ? payload.tools : undefined

    let providerBody: any
    let providerHeaders: Record<string, string> | undefined
    if (providerType === 'anthropic') {
      providerBody = cloneOriginalPayload(payload)
      providerBody.model = target.modelId
      if (normalized.stream !== undefined) {
        providerBody.stream = normalized.stream
      }
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
        providerHeaders = collected
      }
    } else {
      providerBody = buildProviderBody(normalizedForProvider, {
        maxTokens: maxTokensOverride,
        temperature: payload.temperature,
        toolChoice,
        overrideTools
      })
    }

    const connector = getConnector(target.providerId)
    const requestStart = Date.now()
    const configSnapshot = getConfig()
    const storeRequestPayloads = configSnapshot.storeRequestPayloads !== false
    const storeResponsePayloads = configSnapshot.storeResponsePayloads !== false

    const logId = await recordLog({
      timestamp: requestStart,
      endpoint: 'anthropic',
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

    const logUsage = (
      stage: string,
      usage: { input: number; output: number; cached: number | null }
    ) => {
      request.log.info(
        {
          event: 'usage.metrics',
          stage,
          provider: target.providerId,
          model: target.modelId,
          stream: normalized.stream,
          tokens: usage
        },
        'upstream usage summary'
      )
      console.info('[cc-gw][usage]', stage, {
        provider: target.providerId,
        model: target.modelId,
        stream: normalized.stream,
        tokens: usage
      })
    }

    try {
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
        console.warn(
          `[cc-gw][provider:${target.providerId}] upstream error status=${upstream.status} body=${bodyText || '<empty>'}`
        )
        if (storeResponsePayloads) {
          await upsertLogPayload(logId, { response: bodyText || null })
        }
        await commitUsage(0, 0)
        await finalize(upstream.status, errorText)
        return { error: errorText }
      }

      if (!normalized.stream) {
        const json = await new Response(upstream.body!).json()
        if (providerType === 'anthropic') {
          let inputTokens = json.usage?.input_tokens ?? 0
          let outputTokens = json.usage?.output_tokens ?? 0
          const cached = resolveCachedTokens(json.usage)
          const cachedTokens = cached.read + cached.creation
          if (!inputTokens) {
            inputTokens = target.tokenEstimate || estimateTokens(normalized, target.modelId)
          }
          if (!outputTokens) {
            const textBlocks = Array.isArray(json.content)
              ? json.content
                  .filter((block: any) => block?.type === 'text')
                  .map((block: any) => block.text ?? '')
                  .join('\n')
              : ''
            outputTokens = estimateTextTokens(textBlocks, target.modelId)
          }
          logUsage('non_stream.anthropic', {
            input: inputTokens,
            output: outputTokens,
            cached: cachedTokens
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
          await updateMetrics(new Date().toISOString().slice(0, 10), 'anthropic', {
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
          return json
        }

        const claudeResponse = buildClaudeResponse(json, target.modelId)
        let inputTokens = json.usage?.prompt_tokens ?? 0
        let outputTokens = json.usage?.completion_tokens ?? 0
        const cached = resolveCachedTokens(json.usage)
        const cachedTokens = cached.read + cached.creation
        if (!inputTokens) {
          inputTokens = target.tokenEstimate || estimateTokens(normalized, target.modelId)
        }
        if (!outputTokens) {
          const text = claudeResponse.content
            .filter((block: any) => block?.type === 'text')
            .map((block: any) => block.text ?? '')
            .join('\n')
          outputTokens = estimateTextTokens(text, target.modelId)
        }
        logUsage('non_stream.openai', {
          input: inputTokens,
          output: outputTokens,
          cached: cachedTokens
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
        await updateMetrics(new Date().toISOString().slice(0, 10), 'anthropic', {
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
                return JSON.stringify(claudeResponse)
              } catch {
                return null
              }
            })()
          })
        }
        await finalize(200, null)
        reply.header('content-type', 'application/json')
        return claudeResponse
      }

      if (!upstream.body) {
        reply.code(500)
        await commitUsage(0, 0)
        await finalize(500, 'Upstream returned empty body')
        return { error: 'Upstream returned empty body' }
      }

      reply.header('content-type', 'text/event-stream; charset=utf-8')
      reply.header('cache-control', 'no-cache, no-store, must-revalidate')
      reply.header('connection', 'keep-alive')
      reply.hijack()
      reply.raw.writeHead(200)

      if (providerType === 'anthropic') {
        type StreamedContentBlockState = {
          type: string
          text?: string
          thinking?: string
          id?: string
          name?: string
          input?: Record<string, unknown>
          inputBuffer?: string
          tool_use_id?: string
          content?: unknown
          cache_control?: unknown
        }

        const reader = upstream.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let currentEvent: string | null = null
        let usagePrompt = 0
        let usageCompletion = 0
        let usageCached: number | null = null
        let usageCacheRead = 0
        let usageCacheCreation = 0
        let accumulatedContent = ''
        let firstTokenAt: number | null = null
        let lastUsagePayload: any = null
        let stopReason: string | null = null
        let stopSequence: string | null = null
        const contentBlocks = new Map<number, StreamedContentBlockState>()

        const coerceText = (value: unknown): string => {
          if (typeof value === 'string') {
            return value
          }
          if (Array.isArray(value)) {
            return value
              .map((item) => (typeof item === 'string' ? item : typeof item?.text === 'string' ? item.text : ''))
              .filter((item) => item.length > 0)
              .join('')
          }
          if (value && typeof value === 'object' && typeof (value as any).text === 'string') {
            return (value as any).text
          }
          return ''
        }

        const ensureTextBlock = (): StreamedContentBlockState => {
          let block = contentBlocks.get(0)
          if (!block || block.type !== 'text') {
            block = { type: 'text', text: '' }
            contentBlocks.set(0, block)
          }
          return block
        }

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
            if (trimmed.startsWith('event:')) {
              currentEvent = trimmed.slice(6).trim()
            } else if (trimmed.startsWith('data:')) {
              const dataStr = trimmed.slice(5).trim()
              if (dataStr !== '[DONE]' && currentEvent) {
                try {
                  const payload = JSON.parse(dataStr)
                  switch (currentEvent) {
                    case 'content_block_start': {
                      const index = typeof payload?.index === 'number' ? payload.index : null
                      const block = payload?.content_block
                      if (index != null && block && typeof block === 'object') {
                        const base: StreamedContentBlockState = {
                          type: typeof block.type === 'string' ? block.type : 'text'
                        }
                        if (typeof block.id === 'string') {
                          base.id = block.id
                        }
                        if (typeof block.name === 'string') {
                          base.name = block.name
                        }
                        if (block.cache_control !== undefined) {
                          base.cache_control = block.cache_control
                        }
                        if (base.type === 'text') {
                          const initialText = coerceText(block.text ?? block.content)
                          if (initialText) {
                            base.text = initialText
                            accumulatedContent += initialText
                            if (!firstTokenAt && initialText.trim().length > 0) {
                              firstTokenAt = Date.now()
                            }
                          } else {
                            base.text = ''
                          }
                        } else if (base.type === 'thinking') {
                          base.thinking = coerceText(block.thinking ?? block.text)
                        } else if (base.type === 'tool_use') {
                          base.input =
                            block.input && typeof block.input === 'object'
                              ? { ...(block.input as Record<string, unknown>) }
                              : {}
                          base.inputBuffer = ''
                          if (!base.id) {
                            base.id = `tool_${Date.now()}_${index}`
                          }
                        } else if (base.type === 'tool_result') {
                          base.tool_use_id = typeof block.tool_use_id === 'string' ? block.tool_use_id : undefined
                          base.content = block.content ?? null
                        }
                        contentBlocks.set(index, base)
                      }
                      break
                    }
                    case 'content_block_delta': {
                      const index = typeof payload?.index === 'number' ? payload.index : null
                      const block = index != null ? contentBlocks.get(index) : undefined
                      if (!block || typeof payload?.delta !== 'object') {
                        break
                      }
                      if (block.type === 'text') {
                        const deltaText = coerceText((payload.delta as any).text)
                        if (deltaText) {
                          block.text = (block.text ?? '') + deltaText
                          accumulatedContent += deltaText
                          if (!firstTokenAt) {
                            firstTokenAt = Date.now()
                          }
                        }
                      } else if (block.type === 'thinking') {
                        const thinkingDelta = coerceText((payload.delta as any).thinking ?? (payload.delta as any).text)
                        if (thinkingDelta) {
                          block.thinking = (block.thinking ?? '') + thinkingDelta
                        }
                      } else if (block.type === 'tool_use') {
                        const deltaInput = (payload.delta as any).input
                        if (deltaInput && typeof deltaInput === 'object') {
                          block.input = {
                            ...(block.input ?? {}),
                            ...(deltaInput as Record<string, unknown>)
                          }
                        }
                        const partialJson = (payload.delta as any).partial_json ?? (payload.delta as any).input_json
                        if (typeof partialJson === 'string' && partialJson.length > 0) {
                          block.inputBuffer = (block.inputBuffer ?? '') + partialJson
                        }
                      } else if (block.type === 'tool_result') {
                        const deltaContent = (payload.delta as any).content
                        if (deltaContent !== undefined) {
                          block.content = deltaContent
                        }
                      }
                      break
                    }
                    case 'message_delta': {
                      if (payload?.usage) {
                        usagePrompt = payload.usage.input_tokens ?? usagePrompt
                        usageCompletion = payload.usage.output_tokens ?? usageCompletion
                        const maybeCached = resolveCachedTokens(payload.usage)
                        usageCacheRead = maybeCached.read
                        usageCacheCreation = maybeCached.creation
                        usageCached = maybeCached.read + maybeCached.creation
                        lastUsagePayload = payload.usage
                      }
                      if (payload?.delta) {
                        if (payload.delta.stop_reason) {
                          stopReason = payload.delta.stop_reason
                        }
                        if (payload.delta.stop_sequence) {
                          stopSequence = payload.delta.stop_sequence
                        }
                        const deltaText = coerceText(payload.delta.text)
                        if (deltaText) {
                          const block = ensureTextBlock()
                          block.text = (block.text ?? '') + deltaText
                          accumulatedContent += deltaText
                          if (!firstTokenAt) {
                            firstTokenAt = Date.now()
                          }
                        }
                      }
                      break
                    }
                    case 'message_stop': {
                      if (payload?.usage) {
                        usagePrompt = payload.usage.input_tokens ?? usagePrompt
                        usageCompletion = payload.usage.output_tokens ?? usageCompletion
                        const maybeCached = resolveCachedTokens(payload.usage)
                        usageCacheRead = maybeCached.read
                        usageCacheCreation = maybeCached.creation
                        usageCached = maybeCached.read + maybeCached.creation
                        lastUsagePayload = payload.usage
                      }
                      if (payload?.stop_reason) {
                        stopReason = payload.stop_reason
                      }
                      if (payload?.stop_sequence) {
                        stopSequence = payload.stop_sequence
                      }
                      break
                    }
                    case 'content_block_stop': {
                      const index = typeof payload?.index === 'number' ? payload.index : null
                      const block = index != null ? contentBlocks.get(index) : undefined
                      if (block?.type === 'tool_use' && block.inputBuffer) {
                        const buffered = block.inputBuffer
                        delete block.inputBuffer
                        try {
                          block.input = JSON.parse(buffered)
                        } catch {
                          block.input = { raw_arguments: buffered }
                        }
                      }
                      break
                    }
                    default:
                      break
                  }
                } catch (error) {
                  request.log.warn({ error }, 'Failed to parse Anthropic SSE data')
                }
              }
            }

            reply.raw.write(line)
            newlineIndex = buffer.indexOf('\n')
          }
        }

        if (buffer.length > 0) {
          reply.raw.write(buffer)
        }

        reply.raw.end()

        if (!usagePrompt) {
          usagePrompt = target.tokenEstimate || estimateTokens(normalized, target.modelId)
        }
        if (!usageCompletion) {
          usageCompletion = accumulatedContent
            ? estimateTextTokens(accumulatedContent, target.modelId)
            : estimateTextTokens('', target.modelId)
        }

        if (!firstTokenAt) {
          firstTokenAt = requestStart
        }

        const totalLatencyMs = Date.now() - requestStart
        const ttftMs = firstTokenAt ? firstTokenAt - requestStart : null
        // Use accumulated cache values, or fall back to lastUsagePayload
        if (usageCached === null) {
          const cached = resolveCachedTokens(lastUsagePayload)
          usageCacheRead = cached.read
          usageCacheCreation = cached.creation
          usageCached = cached.read + cached.creation
        }
        logUsage('stream.anthropic.final', {
          input: usagePrompt,
          output: usageCompletion,
          cached: usageCached
        })
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
        await updateMetrics(new Date().toISOString().slice(0, 10), 'anthropic', {
          requests: 1,
          inputTokens: usagePrompt,
          outputTokens: usageCompletion,
          cachedTokens: usageCached,
          cacheReadTokens: usageCacheRead,
          cacheCreationTokens: usageCacheCreation,
          latencyMs: totalLatencyMs
        })
        if (storeResponsePayloads) {
          try {
            for (const block of contentBlocks.values()) {
              if (block.type === 'tool_use' && block.inputBuffer) {
                const buffered = block.inputBuffer
                delete block.inputBuffer
                try {
                  block.input = JSON.parse(buffered)
                } catch {
                  block.input = { raw_arguments: buffered }
                }
              }
            }

            const blocksSummary = Array.from(contentBlocks.entries())
              .sort((a, b) => a[0] - b[0])
              .map(([, block]) => {
                const entry: Record<string, unknown> = {
                  type: block.type
                }
                if (block.id) {
                  entry.id = block.id
                }
                if (block.name) {
                  entry.name = block.name
                }
                if (block.text !== undefined) {
                  entry.text = block.text
                }
                if (block.thinking !== undefined) {
                  entry.thinking = block.thinking
                }
                if (block.input && Object.keys(block.input).length > 0) {
                  entry.input = block.input
                }
                if (block.tool_use_id) {
                  entry.tool_use_id = block.tool_use_id
                }
                if (block.content !== undefined) {
                  entry.content = block.content
                }
                if (block.cache_control !== undefined) {
                  entry.cache_control = block.cache_control
                }
                return entry
              })

            const responseSummary: Record<string, unknown> = {
              content: accumulatedContent,
              blocks: blocksSummary,
              usage: {
                input_tokens: usagePrompt,
                output_tokens: usageCompletion,
                cache_read_input_tokens: usageCached
              },
              stop_reason: stopReason ?? 'end_turn',
              stop_sequence: stopSequence ?? null,
              model: target.modelId
            }

            await upsertLogPayload(logId, {
              response: JSON.stringify(responseSummary)
            })
          } catch (error) {
            request.log.warn({ error }, 'Failed to persist Anthropic streamed response summary')
          }
        }
        await finalize(200, null)

        return reply
      }

      const reader = upstream.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let textBlockStarted = false
      let encounteredToolCall = false
      const toolAccum: Record<number, string> = {}
      let usagePrompt = 0
      let usageCompletion = 0
      let usageCached: number | null = null
      let usageCacheRead = 0
      let usageCacheCreation = 0
      let accumulatedContent = ''
      let completed = false
      let firstTokenAt: number | null = null

      const encode = (event: string, data: any) => {
        const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        reply.raw.write(chunk)
      }

      encode('message_start', {
        type: 'message_start',
        message: {
          id: `msg_${Math.random().toString(36).slice(2)}`,
          type: 'message',
          role: 'assistant',
          model: target.modelId,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 }
        }
      })

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (!value) continue
        const chunk = decoder.decode(value, { stream: true })
        buffer += chunk
        const lines = buffer.split('\n')
        if (!buffer.endsWith('\n')) {
          buffer = lines.pop() ?? ''
        } else {
          buffer = ''
        }
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const dataStr = trimmed.slice(5).trim()
          if (dataStr === '[DONE]') {
            if (encounteredToolCall) {
              for (const idx of Object.keys(toolAccum)) {
                encode('content_block_stop', {
                  type: 'content_block_stop',
                  index: Number(idx)
                })
              }
            } else if (textBlockStarted) {
              encode('content_block_stop', {
                type: 'content_block_stop',
                index: 0
              })
            }
            const finalPromptTokens = usagePrompt || target.tokenEstimate || estimateTokens(normalized, target.modelId)
            const finalCompletionTokens = usageCompletion || estimateTextTokens(accumulatedContent, target.modelId)

            encode('message_delta', {
              type: 'message_delta',
              delta: {
                stop_reason: encounteredToolCall ? 'tool_use' : 'end_turn',
                stop_sequence: null
              },
              usage: {
                input_tokens: finalPromptTokens,
                output_tokens: finalCompletionTokens
              }
            })
            encode('message_stop', { type: 'message_stop' })
            reply.raw.write('\n')
            reply.raw.end()
            const totalLatencyMs = Date.now() - requestStart
            const ttftMs = firstTokenAt ? firstTokenAt - requestStart : null
            logUsage('stream.openai.final', {
              input: finalPromptTokens,
              output: finalCompletionTokens,
              cached: usageCached
            })
            await updateLogTokens(logId, {
              inputTokens: finalPromptTokens,
              outputTokens: finalCompletionTokens,
              cachedTokens: usageCached,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              ttftMs,
              tpotMs: computeTpot(totalLatencyMs, finalCompletionTokens, {
                streaming: true,
                ttftMs
              })
            })
            await commitUsage(finalPromptTokens, finalCompletionTokens)
            await updateMetrics(new Date().toISOString().slice(0, 10), 'anthropic', {
              requests: 1,
              inputTokens: finalPromptTokens,
              outputTokens: finalCompletionTokens,
              cachedTokens: usageCached ?? 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              latencyMs: totalLatencyMs
            })
            if (storeResponsePayloads) {
              try {
                await upsertLogPayload(logId, {
                  response: JSON.stringify({
                    content: accumulatedContent,
                    tool_calls: Object.keys(toolAccum).length > 0 ? Object.values(toolAccum).map((args, idx) => ({
                      index: idx,
                      arguments: args
                    })) : undefined,
                    usage: {
                      input_tokens: finalPromptTokens,
                      output_tokens: finalCompletionTokens,
                      cache_read_input_tokens: usageCached
                    },
                    stop_reason: encounteredToolCall ? 'tool_use' : 'end_turn',
                    model: target.modelId
                  })
                })
              } catch (error) {
                request.log.warn({ error }, 'Failed to persist OpenAI streamed response summary')
              }
            }
            await finalize(200, null)
            completed = true
            return reply
          }
          let parsed: any
          try {
            parsed = JSON.parse(dataStr)
          } catch {
            continue
          }
          const choice = parsed.choices?.[0]
          if (!choice) continue

          const usagePayload =
            parsed.usage ||
            choice.usage ||
            (choice.delta && (choice.delta as any).usage) ||
            null
          if (usagePayload) {
            usagePrompt = usagePayload.prompt_tokens ?? usagePrompt
            usageCompletion = usagePayload.completion_tokens ?? usageCompletion
            const maybeCached = resolveCachedTokens(usagePayload)
            usageCacheRead = maybeCached.read
            usageCacheCreation = maybeCached.creation
            usageCached = maybeCached.read + maybeCached.creation
          }

          if (choice.delta?.tool_calls) {
            request.log.debug({ event: 'debug.tool_call_delta', delta: choice.delta?.tool_calls }, 'tool call delta received')
            if (!firstTokenAt) {
              firstTokenAt = Date.now()
            }
            encounteredToolCall = true
            for (const toolCall of choice.delta.tool_calls) {
              const idx = toolCall.index ?? 0
              if (toolAccum[idx] === undefined) {
                toolAccum[idx] = ''
                encode('content_block_start', {
                  type: 'content_block_start',
                  index: idx,
                  content_block: {
                    type: 'tool_use',
                    id: toolCall.id || `tool_${Date.now()}_${idx}`,
                    name: toolCall.function?.name,
                    input: {}
                  }
                })
              }
              const deltaArgs = toolCall.function?.arguments || ''
              if (deltaArgs) {
                toolAccum[idx] += deltaArgs
                encode('content_block_delta', {
                  type: 'content_block_delta',
                  index: idx,
                  delta: {
                    type: 'input_json_delta',
                    partial_json: deltaArgs
                  }
                })
              }
            }
            continue
          }

          if (choice.delta?.content) {
            if (!firstTokenAt && choice.delta.content.length > 0) {
              firstTokenAt = Date.now()
            }
            if (!textBlockStarted) {
              textBlockStarted = true
              encode('content_block_start', {
                type: 'content_block_start',
                index: 0,
                content_block: {
                  type: 'text',
                  text: ''
                }
              })
            }
            encode('content_block_delta', {
              type: 'content_block_delta',
              index: 0,
              delta: {
                type: 'text_delta',
                text: choice.delta.content
              }
            })
            accumulatedContent += choice.delta.content ?? ''
          }

          if (choice.delta?.reasoning) {
            if (!firstTokenAt) {
              firstTokenAt = Date.now()
            }
            if (!textBlockStarted) {
              textBlockStarted = true
              encode('content_block_start', {
                type: 'content_block_start',
                index: 0,
                content_block: {
                  type: 'text',
                  text: ''
                }
              })
            }
            encode('content_block_delta', {
              type: 'content_block_delta',
              index: 0,
              delta: {
                type: 'thinking_delta',
                thinking: choice.delta.reasoning
              }
            })
          }
        }
      }

      if (!completed) {
        reply.raw.end()
        if (!firstTokenAt) {
          firstTokenAt = requestStart
        }
        const totalLatencyMs = Date.now() - requestStart
        const fallbackPrompt = usagePrompt || target.tokenEstimate || estimateTokens(normalized, target.modelId)
        const fallbackCompletion = usageCompletion || estimateTextTokens(accumulatedContent, target.modelId)
        const ttftMs = firstTokenAt ? firstTokenAt - requestStart : null
        logUsage('stream.openai.fallback', {
          input: fallbackPrompt,
          output: fallbackCompletion,
          cached: usageCached
        })
        await updateLogTokens(logId, {
          inputTokens: fallbackPrompt,
          outputTokens: fallbackCompletion,
          cachedTokens: usageCached,
          cacheReadTokens: usageCacheRead,
          cacheCreationTokens: usageCacheCreation,
          ttftMs,
          tpotMs: computeTpot(totalLatencyMs, fallbackCompletion, {
            streaming: true,
            ttftMs
          })
        })
        await commitUsage(fallbackPrompt, fallbackCompletion)
        await updateMetrics(new Date().toISOString().slice(0, 10), 'anthropic', {
          requests: 1,
          inputTokens: fallbackPrompt,
          outputTokens: fallbackCompletion,
          cachedTokens: usageCached ?? 0,
          cacheReadTokens: usageCacheRead,
          cacheCreationTokens: usageCacheCreation,
          latencyMs: totalLatencyMs
        })
        if (storeResponsePayloads) {
          try {
            await upsertLogPayload(logId, {
              response: JSON.stringify({
                content: accumulatedContent,
                usage: {
                  input_tokens: fallbackPrompt,
                  output_tokens: fallbackCompletion,
                  cache_read_input_tokens: usageCached
                },
                stop_reason: 'end_turn',
                model: target.modelId
              })
            })
          } catch (error) {
            request.log.warn({ error }, 'Failed to persist OpenAI streamed response summary (fallback)')
          }
        }
        await finalize(200, null)
        return reply
      }
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

  app.post('/v1/messages', handler)
  app.post('/anthropic/v1/messages', handler)
  app.post('/anthropic/v1/v1/messages', handler)
}
