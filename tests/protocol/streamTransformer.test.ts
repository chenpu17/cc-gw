import { describe, expect, it, beforeEach } from 'vitest'
import { StreamTransformer } from '../../src/server/protocol/streamTransformer.ts'

describe('StreamTransformer', () => {
  describe('Anthropic → OpenAI Chat', () => {
    let transformer: StreamTransformer

    beforeEach(() => {
      transformer = new StreamTransformer('anthropic', 'openai-chat', 'claude-3-5-sonnet-20241022')
    })

    it('converts message_start to nothing (OpenAI has no equivalent)', () => {
      const chunk = 'data: {"type":"message_start","message":{"id":"msg_123","role":"assistant"}}\n\n'
      const result = transformer.transform(chunk)

      // message_start should not generate output for OpenAI Chat (returns newline from split)
      expect(result.transformedChunk).toBe('\n')
    })

    it('converts text content_block_delta to OpenAI Chat delta', () => {
      const chunk = 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n'
      const result = transformer.transform(chunk)

      expect(result.transformedChunk).toContain('"object":"chat.completion.chunk"')
      expect(result.transformedChunk).toContain('"delta":{"content":"Hello"}')
      expect(result.transformedChunk).toContain('"finish_reason":null')
    })

    it('converts message_stop to OpenAI Chat finish chunk', () => {
      const chunk = 'data: {"type":"message_stop","delta":{"stop_reason":"end_turn"}}\n\n'
      const result = transformer.transform(chunk)

      expect(result.transformedChunk).toContain('"finish_reason":"stop"')
      expect(result.transformedChunk).toContain('"delta":{}')
    })

    it('extracts usage from message_delta event', () => {
      const chunk = 'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":20,"cache_creation_input_tokens":10}}\n\n'
      const result = transformer.transform(chunk)

      expect(result.metadata.usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 20,
        cacheCreationTokens: 10
      })
    })

    it('detects first content token for TTFT', () => {
      const chunk = 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n'
      const result = transformer.transform(chunk)

      expect(result.metadata.ttft).toBe(true)

      // Second chunk should not trigger ttft
      const chunk2 = 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" there"}}\n\n'
      const result2 = transformer.transform(chunk2)
      expect(result2.metadata.ttft).toBeUndefined()
    })

    it('handles tool_use content blocks', () => {
      // Start tool use
      const startChunk = 'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_123","name":"get_weather"}}\n\n'
      const startResult = transformer.transform(startChunk)
      expect(startResult.transformedChunk).toBe('\n') // content_block_start returns null for OpenAI

      // Tool arguments delta
      const deltaChunk = 'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\""}}\n\n'
      const deltaResult = transformer.transform(deltaChunk)
      expect(deltaResult.transformedChunk).toContain('"tool_calls"')
      expect(deltaResult.transformedChunk).toContain('"name":"get_weather"')
      expect(deltaResult.transformedChunk).toContain('city') // Check for city in the arguments
    })

    it('handles multiple incremental tool arguments', () => {
      // Start tool use
      transformer.transform('data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_abc","name":"search"}}\n\n')

      // First fragment
      const delta1 = 'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"query\\""}}\n\n'
      const result1 = transformer.transform(delta1)
      expect(result1.transformedChunk).toContain('"tool_calls"')
      expect(result1.transformedChunk).toContain('query')

      // Second fragment
      const delta2 = 'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":":\\"test\\""}}\n\n'
      const result2 = transformer.transform(delta2)
      expect(result2.transformedChunk).toContain('test')
    })

    it('maps stop_reason correctly', () => {
      const testCases = [
        { input: 'end_turn', expected: 'stop' },
        { input: 'tool_use', expected: 'tool_calls' },
        { input: 'max_tokens', expected: 'length' },
        { input: 'stop_sequence', expected: 'stop' }
      ]

      for (const { input, expected } of testCases) {
        const t = new StreamTransformer('anthropic', 'openai-chat', 'claude-3')
        const chunk = `data: {"type":"message_stop","delta":{"stop_reason":"${input}"}}\n\n`
        const result = t.transform(chunk)
        expect(result.transformedChunk).toContain(`"finish_reason":"${expected}"`)
      }
    })

    it('accumulates usage across multiple events', () => {
      const chunk1 = 'data: {"type":"message_delta","usage":{"input_tokens":100,"output_tokens":50}}\n\n'
      transformer.transform(chunk1)

      const chunk2 = 'data: {"type":"message_stop","usage":{"input_tokens":100,"output_tokens":75,"cache_read_input_tokens":10}}\n\n'
      transformer.transform(chunk2)

      const finalUsage = transformer.getFinalUsage()
      expect(finalUsage.inputTokens).toBe(100)
      expect(finalUsage.outputTokens).toBe(75) // Last value
      expect(finalUsage.cacheReadTokens).toBe(10)
    })

    it('passes through [DONE] marker', () => {
      const chunk = 'data: [DONE]\n\n'
      const result = transformer.transform(chunk)
      expect(result.transformedChunk).toBe('data: [DONE]\n\n')
    })

    it('handles partial SSE chunks across multiple transform calls', () => {
      const chunk1 = 'data: {"type":"content_block_delta","index":0,'
      const chunk2 = '"delta":{"type":"text_delta","text":"Hello"}}\n\n'

      const result1 = transformer.transform(chunk1)
      expect(result1.transformedChunk).toBe('') // Incomplete line buffered

      const result2 = transformer.transform(chunk2)
      expect(result2.transformedChunk).toContain('"content":"Hello"')
    })
  })

  describe('OpenAI Chat → Anthropic', () => {
    let transformer: StreamTransformer

    beforeEach(() => {
      transformer = new StreamTransformer('openai-chat', 'anthropic', 'gpt-4')
    })

    it('sends message_start on first event', () => {
      const chunk = 'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n\n'
      const result = transformer.transform(chunk)

      expect(result.transformedChunk).toContain('"type":"message_start"')
      expect(result.transformedChunk).toContain('"id":"msg_123"')
      expect(result.transformedChunk).toContain('"role":"assistant"')
    })

    it('sends content_block_start before first content', () => {
      const chunk1 = 'data: {"id":"chatcmpl_123","choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n\n'
      const result1 = transformer.transform(chunk1)

      // First event with content triggers both message_start AND content_block_start
      expect(result1.transformedChunk).toContain('"type":"message_start"')
      expect(result1.transformedChunk).toContain('"type":"content_block_start"')
      expect(result1.transformedChunk).toContain('"type":"content_block_delta"')

      const chunk2 = 'data: {"id":"chatcmpl_123","choices":[{"delta":{"content":" there"},"finish_reason":null}]}\n\n'
      const result2 = transformer.transform(chunk2)

      // Second content should only have delta (no start)
      expect(result2.transformedChunk).not.toContain('"type":"content_block_start"')
      expect(result2.transformedChunk).toContain('"type":"content_block_delta"')
    })

    it('converts content delta to Anthropic text_delta', () => {
      // First event (triggers message_start)
      transformer.transform('data: {"id":"chatcmpl_123","choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n\n')

      // Second event (content delta)
      const chunk = 'data: {"id":"chatcmpl_123","choices":[{"delta":{"content":" there"},"finish_reason":null}]}\n\n'
      const result = transformer.transform(chunk)

      expect(result.transformedChunk).toContain('"type":"content_block_delta"')
      expect(result.transformedChunk).toContain('"delta":{"type":"text_delta","text":" there"}')
    })

    it('converts finish_reason to message_stop', () => {
      // First send a content delta to trigger message_start
      transformer.transform('data: {"id":"chatcmpl_123","choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n\n')

      const chunk = 'data: {"id":"chatcmpl_123","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
      const result = transformer.transform(chunk)

      expect(result.transformedChunk).toContain('"type":"message_stop"')
      expect(result.transformedChunk).toContain('"stop_reason":"end_turn"')
    })

    it('maps finish_reason correctly', () => {
      const testCases = [
        { input: 'stop', expected: 'end_turn' },
        { input: 'tool_calls', expected: 'tool_use' },
        { input: 'length', expected: 'max_tokens' }
      ]

      for (const { input, expected } of testCases) {
        const t = new StreamTransformer('openai-chat', 'anthropic', 'gpt-4')
        // First send a delta to trigger message_start
        t.transform('data: {"id":"chatcmpl_123","choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n\n')

        const chunk = `data: {"id":"chatcmpl_123","choices":[{"delta":{},"finish_reason":"${input}"}]}\n\n`
        const result = t.transform(chunk)
        expect(result.transformedChunk).toContain(`"stop_reason":"${expected}"`)
      }
    })

    it('emits message_delta with usage before final message_stop', () => {
      const chunkUsage = 'data: {"id":"chatcmpl_123","usage":{"prompt_tokens":12,"completion_tokens":3,"cached_tokens":2}}\n\n'
      transformer.transform(chunkUsage)
      const chunkFinish = 'data: {"id":"chatcmpl_123","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
      const result = transformer.transform(chunkFinish)

      expect(result.transformedChunk).toContain('"type":"message_delta"')
      expect(result.transformedChunk).toContain('"usage"')
      expect(result.transformedChunk).toContain('"input_tokens":12')
      expect(result.transformedChunk).toContain('"output_tokens":3')
      expect(result.transformedChunk).toMatch(/event: message_stop/m)
    })

    it('extracts usage from OpenAI events', () => {
      const chunk = 'data: {"id":"chatcmpl_123","usage":{"prompt_tokens":100,"completion_tokens":50,"cached_tokens":10}}\n\n'
      const result = transformer.transform(chunk)

      expect(result.metadata.usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 10,
        cacheCreationTokens: 0
      })
    })

    it('filters [DONE] chunks (Anthropic target should not receive them)', () => {
      const doneChunk = 'data: [DONE]\n\n'
      const result = transformer.transform(doneChunk)

      expect(result.transformedChunk).toBe('')
      expect(result.metadata).toEqual({})
    })

    it('detects TTFT from first content delta', () => {
      const chunk = 'data: {"id":"chatcmpl_123","choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n\n'
      const result = transformer.transform(chunk)

      expect(result.metadata.ttft).toBe(true)
    })

    it('converts OpenAI tool_calls to Anthropic content blocks', () => {
      // First event - new tool call with ID
      const chunk1 = 'data: {"id":"chatcmpl_123","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}\n\n'
      const result1 = transformer.transform(chunk1)

      // Should send message_start + content_block_start for tool_use
      expect(result1.transformedChunk).toContain('"type":"message_start"')
      expect(result1.transformedChunk).toContain('"type":"content_block_start"')
      expect(result1.transformedChunk).toContain('"type":"tool_use"')
      expect(result1.transformedChunk).toContain('"id":"call_abc"')
      expect(result1.transformedChunk).toContain('"name":"get_weather"')

      // Second event - tool arguments delta
      const chunk2 = 'data: {"id":"chatcmpl_123","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":"}}]},"finish_reason":null}]}\n\n'
      const result2 = transformer.transform(chunk2)

      // Should send content_block_delta with input_json_delta
      expect(result2.transformedChunk).toContain('"type":"content_block_delta"')
      expect(result2.transformedChunk).toContain('"type":"input_json_delta"')
      expect(result2.transformedChunk).toContain('city')

      // Third event - more arguments
      const chunk3 = 'data: {"id":"chatcmpl_123","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"NYC\\"}"}}]},"finish_reason":null}]}\n\n'
      const result3 = transformer.transform(chunk3)

      expect(result3.transformedChunk).toContain('NYC')
    })

    it('includes event: headers for Anthropic format', () => {
      // Send a content delta
      const chunk = 'data: {"id":"chatcmpl_123","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n'
      const result = transformer.transform(chunk)

      // Should include event: headers for all Anthropic events
      expect(result.transformedChunk).toContain('event: message_start')
      expect(result.transformedChunk).toContain('event: content_block_start')
      expect(result.transformedChunk).toContain('event: content_block_delta')

      // Each event line should be followed by data line
      const lines = result.transformedChunk.split('\n')
      let foundEventLine = false
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('event:')) {
          foundEventLine = true
          // Next non-empty line should be data:
          expect(lines[i + 1]).toMatch(/^data:/)
        }
      }
      expect(foundEventLine).toBe(true)
    })
  })

  describe('Anthropic → OpenAI Responses', () => {
    let transformer: StreamTransformer

    beforeEach(() => {
      transformer = new StreamTransformer('anthropic', 'openai-responses', 'claude-3-5-sonnet-20241022')
    })

    it('converts message_start to response.created event', () => {
      const chunk = 'data: {"type":"message_start","message":{"id":"msg_abc123","role":"assistant"}}\n\n'
      const result = transformer.transform(chunk)

      expect(result.transformedChunk).toContain('"type":"response.created"')
      expect(result.transformedChunk).toContain('"object":"response"')
      expect(result.transformedChunk).toContain('"id":"resp_abc123"')
    })

    it('converts content_block_start to output_item.added event', () => {
      // First send message_start
      transformer.transform('data: {"type":"message_start","message":{"id":"msg_123"}}\n\n')

      const chunk = 'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n'
      const result = transformer.transform(chunk)

      expect(result.transformedChunk).toContain('"type":"response.output_item.added"')
      expect(result.transformedChunk).toContain('"type":"output_text"')
    })

    it('converts text_delta to output_item.content_part.delta event', () => {
      // Setup
      transformer.transform('data: {"type":"message_start","message":{"id":"msg_123"}}\n\n')
      transformer.transform('data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n')

      const chunk = 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n'
      const result = transformer.transform(chunk)

      expect(result.transformedChunk).toContain('"type":"response.output_item.content_part.delta"')
      expect(result.transformedChunk).toContain('"delta":{"type":"text_delta","text":"Hello"}')
    })

    it('converts message_stop to response.completed event', () => {
      const chunk = 'data: {"type":"message_stop","delta":{"stop_reason":"end_turn"}}\n\n'
      const result = transformer.transform(chunk)

      expect(result.transformedChunk).toContain('"type":"response.completed"')
      expect(result.transformedChunk).toContain('"status":"completed"')
      expect(result.transformedChunk).toContain('"stop_reason":"end_turn"')
    })

    it('maps stop_reason to status correctly', () => {
      const testCases = [
        { stopReason: 'end_turn', expectedStatus: 'completed' },
        { stopReason: 'tool_use', expectedStatus: 'requires_action' },
        { stopReason: 'max_tokens', expectedStatus: 'incomplete' },
        { stopReason: 'stop_sequence', expectedStatus: 'incomplete' }
      ]

      for (const { stopReason, expectedStatus } of testCases) {
        const t = new StreamTransformer('anthropic', 'openai-responses', 'claude-3')
        const chunk = `data: {"type":"message_stop","delta":{"stop_reason":"${stopReason}"}}\n\n`
        const result = t.transform(chunk)
        expect(result.transformedChunk).toContain(`"status":"${expectedStatus}"`)
      }
    })

    it('extracts usage from Anthropic events', () => {
      const chunk = 'data: {"type":"message_delta","usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":15,"cache_creation_input_tokens":5}}\n\n'
      const result = transformer.transform(chunk)

      expect(result.metadata.usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 15,
        cacheCreationTokens: 5
      })
    })

    it('maintains consistent IDs across events', () => {
      const chunk1 = 'data: {"type":"message_start","message":{"id":"msg_xyz"}}\n\n'
      const result1 = transformer.transform(chunk1)
      expect(result1.transformedChunk).toContain('"id":"resp_xyz"')

      const chunk2 = 'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n'
      const result2 = transformer.transform(chunk2)
      expect(result2.transformedChunk).toContain('"id":"resp_xyz"')

      const chunk3 = 'data: {"type":"message_stop","delta":{"stop_reason":"end_turn"}}\n\n'
      const result3 = transformer.transform(chunk3)
      expect(result3.transformedChunk).toContain('"id":"resp_xyz"')
    })

    it('sends complete response structure in message_stop', () => {
      // Setup: send message_start, content_block_start, some deltas, and message_delta with usage
      transformer.transform('data: {"type":"message_start","message":{"id":"msg_test"}}\n\n')
      transformer.transform('data: {"type":"content_block_start","index":0,"content_block":{"type":"text","id":"block_1"}}\n\n')
      transformer.transform('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n')
      transformer.transform('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n\n')
      transformer.transform('data: {"type":"message_delta","usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":10,"cache_creation_input_tokens":5}}\n\n')

      // Send message_stop
      const stopChunk = 'data: {"type":"message_stop","delta":{"stop_reason":"end_turn"}}\n\n'
      const result = transformer.transform(stopChunk)

      // Verify complete response structure
      expect(result.transformedChunk).toContain('"type":"response.completed"')
      expect(result.transformedChunk).toContain('"status":"completed"')

      // Verify usage is included
      expect(result.transformedChunk).toContain('"input_tokens":100')
      expect(result.transformedChunk).toContain('"output_tokens":50')
      expect(result.transformedChunk).toContain('"cached_tokens":15') // 10 + 5

      // Verify response.content array
      expect(result.transformedChunk).toContain('"response":')
      expect(result.transformedChunk).toContain('"content":')

      // Verify output array
      expect(result.transformedChunk).toContain('"output":')

      // Verify accumulated text
      expect(result.transformedChunk).toContain('"output_text":"Hello world"')
    })

    it('accumulates tool_use input from input_json_delta events', () => {
      // Setup: message_start
      transformer.transform('data: {"type":"message_start","message":{"id":"msg_tool"}}\n\n')

      // Start tool_use block
      transformer.transform('data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_123","name":"search"}}\n\n')

      // Send incremental JSON fragments
      transformer.transform('data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"query\\":"}}\n\n')
      transformer.transform('data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"test\\","}}\n\n')
      transformer.transform('data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"limit\\":10}"}}\n\n')

      transformer.transform('data: {"type":"content_block_stop","index":0}\n\n')
      transformer.transform('data: {"type":"message_delta","usage":{"input_tokens":50,"output_tokens":25}}\n\n')

      // Send message_stop and verify complete input is parsed
      const stopChunk = 'data: {"type":"message_stop","delta":{"stop_reason":"tool_use"}}\n\n'
      const result = transformer.transform(stopChunk)

      // Parse the response to check tool_use input
      const parsed = JSON.parse(result.transformedChunk.replace(/^data: /, '').trim())

      // Verify tool_use block has complete parsed input
      expect(parsed.response.content).toHaveLength(1)
      expect(parsed.response.content[0].type).toBe('tool_use')
      expect(parsed.response.content[0].name).toBe('search')
      expect(parsed.response.content[0].input).toEqual({
        query: 'test',
        limit: 10
      })

      // Verify output array also has the parsed input
      expect(parsed.output[0].content[0].input).toEqual({
        query: 'test',
        limit: 10
      })
    })
  })

  describe('getFinalUsage', () => {
    it('returns accumulated usage statistics', () => {
      const transformer = new StreamTransformer('anthropic', 'openai-chat', 'claude-3')

      transformer.transform('data: {"type":"message_delta","usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":10,"cache_creation_input_tokens":5}}\n\n')
      transformer.transform('data: {"type":"message_stop","usage":{"input_tokens":100,"output_tokens":75,"cache_read_input_tokens":10,"cache_creation_input_tokens":5}}\n\n')

      const usage = transformer.getFinalUsage()
      expect(usage).toEqual({
        inputTokens: 100,
        outputTokens: 75,
        cacheReadTokens: 10,
        cacheCreationTokens: 5
      })
    })

    it('returns zeros when no usage data received', () => {
      const transformer = new StreamTransformer('anthropic', 'openai-chat', 'claude-3')

      const usage = transformer.getFinalUsage()
      expect(usage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0
      })
    })
  })

  describe('Edge cases', () => {
    it('handles malformed JSON gracefully', () => {
      const transformer = new StreamTransformer('anthropic', 'openai-chat', 'claude-3')
      const chunk = 'data: {invalid json}\n\n'

      const result = transformer.transform(chunk)
      // Should pass through unparseable lines
      expect(result.transformedChunk).toContain('{invalid json}')
    })

    it('handles empty chunks', () => {
      const transformer = new StreamTransformer('anthropic', 'openai-chat', 'claude-3')
      const result = transformer.transform('')

      expect(result.transformedChunk).toBe('')
      expect(result.metadata).toEqual({})
    })

    it('handles events without required fields', () => {
      const transformer = new StreamTransformer('anthropic', 'openai-chat', 'claude-3')
      const chunk = 'data: {"type":"content_block_delta"}\n\n'

      const result = transformer.transform(chunk)
      // Should not crash, may return null/empty
      expect(result).toBeDefined()
    })

    it('filters out event: lines when converting Anthropic to OpenAI', () => {
      const transformer = new StreamTransformer('anthropic', 'openai-chat', 'claude-3')
      const chunk = 'event: ping\nid: 123\nretry: 5000\n\n'

      const result = transformer.transform(chunk)
      // Should NOT contain event: (filtered out)
      expect(result.transformedChunk).not.toContain('event:')
      // But should preserve id: and retry:
      expect(result.transformedChunk).toContain('id: 123')
      expect(result.transformedChunk).toContain('retry: 5000')
    })
  })
})
