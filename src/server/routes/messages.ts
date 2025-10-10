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
  if (typeof usage.cache_read_input_tokens === 'number') {
    return usage.cache_read_input_tokens
  }
  if (typeof usage.cache_creation_input_tokens === 'number') {
    return usage.cache_creation_input_tokens
  }
  return null
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
  app.addHook('onRequest', (request, _reply, done) => {
    const url = request.raw.url
    if (typeof url === 'string' && url.startsWith('/anthropic/v1/v1/')) {
      const normalized = url.replace('/anthropic/v1/v1/', '/anthropic/v1/')
      request.raw.url = normalized
      ;(request as any).url = normalized
    }
    done()
  })

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
    if (typeof rawUrl === 'string' && rawUrl.includes('?')) {
      querySuffix = rawUrl.slice(rawUrl.indexOf('?'))
    } else if (typeof (request as any).querystring === 'string' && (request as any).querystring.length > 0) {
      querySuffix = `?${(request as any).querystring}`
    }

    if (querySuffix) {
      console.info(`[cc-gw] inbound url ${rawUrl} query ${querySuffix}`)
    }

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
    const storePayloads = getConfig().storePayloads !== false

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

    if (storePayloads) {
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
        if (storePayloads) {
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
          const cachedTokens = resolveCachedTokens(json.usage)
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
            ttftMs: latencyMs,
            tpotMs: computeTpot(latencyMs, outputTokens, { streaming: false })
          })
          await commitUsage(inputTokens, outputTokens)
          await updateMetrics(new Date().toISOString().slice(0, 10), 'anthropic', {
            requests: 1,
            inputTokens,
            outputTokens,
            latencyMs
          })
          if (storePayloads) {
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
        const cachedTokens = resolveCachedTokens(json.usage)
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
          ttftMs: latencyMs,
          tpotMs: computeTpot(latencyMs, outputTokens, { streaming: false })
        })
        await commitUsage(inputTokens, outputTokens)
        await updateMetrics(new Date().toISOString().slice(0, 10), 'anthropic', {
          requests: 1,
          inputTokens,
          outputTokens,
          latencyMs
        })
        if (storePayloads) {
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
        const reader = upstream.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let currentEvent: string | null = null
        let usagePrompt = 0
        let usageCompletion = 0
        let usageCached: number | null = null
        let accumulatedContent = ''
        let firstTokenAt: number | null = null
        let lastUsagePayload: any = null

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
              if (currentEvent === 'message_delta' || currentEvent === 'message_stop') {
                try {
                  const data = JSON.parse(trimmed.slice(5).trim())
                  if (data?.usage) {
                    usagePrompt = data.usage.input_tokens ?? usagePrompt
                    usageCompletion = data.usage.output_tokens ?? usageCompletion
                    const maybeCached = resolveCachedTokens(data.usage)
                    if (maybeCached !== null) {
                      usageCached = maybeCached
                    }
                    lastUsagePayload = data.usage
                  }
                  const deltaText = data?.delta?.text
                  if (typeof deltaText === 'string') {
                    if (!firstTokenAt && deltaText.length > 0) {
                      firstTokenAt = Date.now()
                    }
                    accumulatedContent += deltaText
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
        if (usageCached === null) {
          usageCached = resolveCachedTokens(lastUsagePayload)
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
          latencyMs: totalLatencyMs
        })
        if (storePayloads) {
          await upsertLogPayload(logId, {
            response: (() => {
              try {
                return JSON.stringify({
                  content: accumulatedContent,
                  usage: {
                    input: usagePrompt,
                    output: usageCompletion,
                    cached: usageCached
                  }
                })
              } catch {
                return accumulatedContent
              }
            })()
          })
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
      let accumulatedContent = ''
      let completed = false
      let firstTokenAt: number | null = null

      const encode = (event: string, data: any) => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
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
              latencyMs: totalLatencyMs
            })
            if (storePayloads) {
              await upsertLogPayload(logId, {
                response: (() => {
                  try {
                    return JSON.stringify({
                      content: accumulatedContent,
                      toolCalls: Object.keys(toolAccum).length > 0 ? toolAccum : undefined,
                      usage: {
                        input: finalPromptTokens,
                        output: finalCompletionTokens,
                        cached: usageCached
                      }
                    })
                  } catch {
                    return accumulatedContent
                  }
                })()
              })
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
            if (typeof usagePayload.cached_tokens === 'number') {
              usageCached = usagePayload.cached_tokens
            }
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
          latencyMs: totalLatencyMs
        })
        if (storePayloads) {
          await upsertLogPayload(logId, {
            response: (() => {
              try {
                return JSON.stringify({
                  content: accumulatedContent,
                  usage: {
                    input: fallbackPrompt,
                    output: fallbackCompletion,
                    cached: usageCached
                  }
                })
              } catch {
                return accumulatedContent
              }
            })()
          })
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
