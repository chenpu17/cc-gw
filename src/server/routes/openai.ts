import type { FastifyInstance } from 'fastify'
import { normalizeOpenAIResponsesPayload } from '../protocol/normalize-openai.js'
import { resolveRoute } from '../router/index.js'
import { getConnector } from '../providers/registry.js'
import { createOpenAIConnector } from '../providers/openai.js'
import type { ProviderConnector } from '../providers/types.js'
import { recordLog, finalizeLog, updateLogTokens, updateMetrics, upsertLogPayload } from '../logging/logger.js'
import { resolveApiKey, ApiKeyError, recordApiKeyUsage } from '../api-keys/service.js'
import { encryptSecret } from '../security/encryption.js'
import { estimateTokens } from '../protocol/tokenizer.js'
const OPENAI_DEBUG = process.env.CC_GW_DEBUG_OPENAI === '1'
const debugLog = (...args: unknown[]) => {
  if (OPENAI_DEBUG) {
    console.info('[cc-gw][openai]', ...args)
  }
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

function resolveCachedTokens(usage: any): number | null {
  if (!usage || typeof usage !== 'object') {
    return null
  }
  if (typeof usage.cached_tokens === 'number') {
    return usage.cached_tokens
  }
  const promptDetails = usage.prompt_tokens_details
  if (promptDetails && typeof promptDetails.cached_tokens === 'number') {
    return promptDetails.cached_tokens
  }
  const inputDetails = usage.input_tokens_details
  if (inputDetails && typeof inputDetails.cached_tokens === 'number') {
    return inputDetails.cached_tokens
  }
  if (typeof usage.cache_read_input_tokens === 'number') {
    return usage.cache_read_input_tokens
  }
  if (typeof usage.cache_creation_input_tokens === 'number') {
    return usage.cache_creation_input_tokens
  }
  return null
}

export async function registerOpenAiRoutes(app: FastifyInstance): Promise<void> {
  const handleResponses = async (request: any, reply: any) => {
    const payload = request.body
    if (!payload || typeof payload !== 'object') {
      reply.code(400)
      return { error: 'Invalid request body' }
    }

    debugLog('incoming request', {
      stream: Boolean(payload.stream),
      model: payload.model,
      hasToolChoice: Boolean(payload.tool_choice),
      toolsCount: Array.isArray(payload.tools) ? payload.tools.length : 0
    })

    const resolveHeaderValue = (value: string | string[] | undefined): string | undefined => {
      if (!value) return undefined
      if (typeof value === 'string') return value
      if (Array.isArray(value)) {
        const found = value.find((item) => typeof item === 'string' && item.trim().length > 0)
        return found
      }
      return undefined
    }

    let providedApiKey = resolveHeaderValue(request.headers['authorization'] as any)
    if (providedApiKey && providedApiKey.toLowerCase().startsWith('bearer ')) {
      providedApiKey = providedApiKey.slice(7)
    }
    if (!providedApiKey) {
      providedApiKey = resolveHeaderValue(request.headers['x-api-key'] as any)
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

    const normalized = normalizeOpenAIResponsesPayload(payload)
    const requestedModel = typeof payload.model === 'string' ? payload.model : undefined
    const target = resolveRoute({
      payload: normalized,
      requestedModel,
      endpoint: 'openai'
    })

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
      const providerBody: Record<string, any> = { ...payload }

      providerBody.model = target.modelId
      providerBody.stream = normalized.stream

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

      const upstream = await connector.send({
        model: target.modelId,
        body: providerBody,
        stream: normalized.stream
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
        if (storeResponsePayloads) {
          await upsertLogPayload(logId, { response: rawBody })
        }
        let parsed: any = null
        try {
          parsed = rawBody ? JSON.parse(rawBody) : {}
        } catch (error) {
          await commitUsage(0, 0)
          await finalize(200, null)
          reply.header('content-type', 'application/json')
          return rawBody
        }

        const usagePayload = parsed?.usage ?? null
        const inputTokens = usagePayload?.input_tokens ?? usagePayload?.prompt_tokens ?? target.tokenEstimate ?? estimateTokens(normalized, target.modelId)
        const baseOutputTokens = usagePayload?.output_tokens ?? usagePayload?.completion_tokens ?? (typeof parsed?.content === 'string' ? estimateTokens(normalized, target.modelId) : 0)
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
        const cachedTokens = resolveCachedTokens(usagePayload)
        const latencyMs = Date.now() - requestStart

        await updateLogTokens(logId, {
          inputTokens,
          outputTokens,
          cachedTokens,
          ttftMs: usagePayload?.first_token_latency_ms ?? latencyMs,
          tpotMs: usagePayload?.tokens_per_second ? computeTpot(latencyMs, outputTokens, { streaming: false, reasoningTokens }) : null
        })
        await commitUsage(inputTokens, outputTokens)
        await updateMetrics(new Date().toISOString().slice(0, 10), 'openai', {
          requests: 1,
          inputTokens,
          outputTokens,
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

      const reader = upstream.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let usagePrompt: number | null = null
      let usageCompletion: number | null = null
      let usageReasoning: number | null = null
      let usageCached: number | null = null
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
            usageCached = resolveCachedTokens(usagePayload)
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

      await updateLogTokens(logId, {
        inputTokens,
        outputTokens,
        cachedTokens: usageCached,
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

  app.post('/openai/v1/responses', handleResponses)
  app.post('/openai/responses', handleResponses)
}
