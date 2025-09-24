import type { FastifyInstance } from 'fastify'
import { normalizeClaudePayload } from '../protocol/normalize.js'
import { resolveRoute } from '../router/index.js'
import { buildProviderBody, buildAnthropicBody } from '../protocol/toProvider.js'
import { getConnector } from '../providers/registry.js'
import { recordLog, updateLogTokens, updateMetrics } from '../logging/logger.js'
import { estimateTokens, estimateTextTokens } from '../protocol/tokenizer.js'

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
  app.post('/v1/messages', async (request, reply) => {
    const payload = request.body
    if (!payload || typeof payload !== 'object') {
      reply.code(400)
      return { error: 'Invalid request body' }
    }

    const normalized = normalizeClaudePayload(payload)

    const requestedModel = typeof payload.model === 'string' ? payload.model : undefined
    const target = resolveRoute({
      payload: normalized,
      requestedModel
    })

    const providerType = target.provider.type ?? 'custom'

    const providerBody = providerType === 'anthropic'
      ? buildAnthropicBody(normalized, {
          maxTokens:
            payload.max_tokens ?? target.provider.models?.find((m) => m.id === target.modelId)?.maxTokens,
          temperature: payload.temperature,
          toolChoice: payload.tool_choice,
          overrideTools: payload.tools
        })
      : buildProviderBody(normalized, {
          maxTokens:
            payload.max_tokens ?? target.provider.models?.find((m) => m.id === target.modelId)?.maxTokens,
          temperature: payload.temperature,
          toolChoice: payload.tool_choice,
          overrideTools: payload.tools
        })

    const connector = getConnector(target.providerId)
    const requestStart = Date.now()
    const logId = recordLog({
      timestamp: requestStart,
      provider: target.providerId,
      model: target.modelId,
      sessionId: payload.metadata?.user_id,
      prompt: normalized.stream ? undefined : JSON.stringify(payload),
      response: null
    })

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
        stream: normalized.stream
      })

      if (upstream.status >= 400) {
        reply.code(upstream.status)
        const bodyText = upstream.body ? await new Response(upstream.body).text() : ''
        return { error: bodyText || 'Upstream provider error' }
      }

      if (!normalized.stream) {
        const json = await new Response(upstream.body!).json()
        if (providerType === 'anthropic') {
          let inputTokens = json.usage?.input_tokens ?? 0
          let outputTokens = json.usage?.output_tokens ?? 0
          const cachedTokens = typeof json.usage?.cached_tokens === 'number' ? json.usage.cached_tokens : null
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
          updateLogTokens(logId, inputTokens, outputTokens, cachedTokens)
          updateMetrics(new Date().toISOString().slice(0, 10), {
            requests: 1,
            inputTokens,
            outputTokens,
            latencyMs: Date.now() - requestStart
          })
          reply.header('content-type', 'application/json')
          return json
        }

        const claudeResponse = buildClaudeResponse(json, target.modelId)
        let inputTokens = json.usage?.prompt_tokens ?? 0
        let outputTokens = json.usage?.completion_tokens ?? 0
        const cachedTokens = typeof json.usage?.cached_tokens === 'number' ? json.usage.cached_tokens : null
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
        updateLogTokens(logId, inputTokens, outputTokens, cachedTokens)
        updateMetrics(new Date().toISOString().slice(0, 10), {
          requests: 1,
          inputTokens,
          outputTokens,
          latencyMs: Date.now() - requestStart
        })
        reply.header('content-type', 'application/json')
        return claudeResponse
      }

      if (!upstream.body) {
        reply.code(500)
        return { error: 'Upstream returned empty body' }
      }

      reply.header('content-type', 'text/event-stream; charset=utf-8')
      reply.header('cache-control', 'no-cache, no-store, must-revalidate')
      reply.header('connection', 'keep-alive')
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
                    if (typeof data.usage.cached_tokens === 'number') {
                      usageCached = data.usage.cached_tokens
                    }
                  }
                  const deltaText = data?.delta?.text
                  if (typeof deltaText === 'string') {
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

        logUsage('stream.anthropic.final', {
          input: usagePrompt,
          output: usageCompletion,
          cached: usageCached
        })
        updateLogTokens(logId, usagePrompt, usageCompletion, usageCached)
        updateMetrics(new Date().toISOString().slice(0, 10), {
          requests: 1,
          inputTokens: usagePrompt,
          outputTokens: usageCompletion,
          latencyMs: Date.now() - requestStart
        })

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
            logUsage('stream.openai.final', {
              input: finalPromptTokens,
              output: finalCompletionTokens,
              cached: usageCached
            })
            updateLogTokens(logId, finalPromptTokens, finalCompletionTokens, usageCached)
            updateMetrics(new Date().toISOString().slice(0, 10), {
              requests: 1,
              inputTokens: finalPromptTokens,
              outputTokens: finalCompletionTokens,
              latencyMs: Date.now() - requestStart
            })
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
        const fallbackPrompt = usagePrompt || target.tokenEstimate || estimateTokens(normalized, target.modelId)
        const fallbackCompletion = usageCompletion || estimateTextTokens(accumulatedContent, target.modelId)
        logUsage('stream.openai.fallback', {
          input: fallbackPrompt,
          output: fallbackCompletion,
          cached: usageCached
        })
        updateLogTokens(logId, fallbackPrompt, fallbackCompletion, usageCached)
        updateMetrics(new Date().toISOString().slice(0, 10), {
          requests: 1,
          inputTokens: fallbackPrompt,
          outputTokens: fallbackCompletion,
          latencyMs: Date.now() - requestStart
        })
        return reply
      }
    } catch (err) {
      reply.code(500)
      return { error: (err as Error).message }
    }
  })
}
