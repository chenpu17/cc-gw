/**
 * Streaming Parity Tests
 *
 * Validates that StreamTransformer produces correct output for various format conversions.
 * These tests actually run the transformer and verify the output, unlike placeholder tests.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { StreamTransformer } from '../../src/server/protocol/streamTransformer.ts'

describe('Streaming Parity: Real Integration Tests', () => {
  describe('Anthropic → OpenAI Chat', () => {
    let transformer: StreamTransformer

    beforeEach(() => {
      transformer = new StreamTransformer('anthropic', 'openai-chat', 'claude-3-5-sonnet-20241022')
    })

    it('filters out Anthropic event: headers', () => {
      // Input: Anthropic SSE with event: headers
      const chunk = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n'
      const result = transformer.transform(chunk)

      // Output should NOT contain "event: content_block_delta"
      expect(result.transformedChunk).not.toContain('event: content_block_delta')
      expect(result.transformedChunk).not.toContain('event:')

      // But should contain transformed OpenAI data
      expect(result.transformedChunk).toContain('"object":"chat.completion.chunk"')
      expect(result.transformedChunk).toContain('"delta":{"content":"Hello"}')
    })

    it('produces valid OpenAI Chat SSE format', () => {
      const chunk = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Test"}}\n\n'
      const result = transformer.transform(chunk)

      // OpenAI Chat format should have only data: lines (no event: lines)
      const lines = result.transformedChunk.split('\n').filter(l => l.trim())
      for (const line of lines) {
        if (line.startsWith('data:')) {
          // Valid
          const jsonStr = line.slice(5).trim()
          expect(() => JSON.parse(jsonStr)).not.toThrow()
        } else {
          // Should not have event: lines
          expect(line).not.toMatch(/^event:/)
        }
      }
    })

    it('extracts usage from Anthropic message_delta', () => {
      const usageChunk = 'event: message_delta\ndata: {"type":"message_delta","usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":20,"cache_creation_input_tokens":10}}\n\n'
      const result = transformer.transform(usageChunk)

      expect(result.metadata.usage).toBeDefined()
      expect(result.metadata.usage?.inputTokens).toBe(100)
      expect(result.metadata.usage?.outputTokens).toBe(50)
      expect(result.metadata.usage?.cacheReadTokens).toBe(20)
      expect(result.metadata.usage?.cacheCreationTokens).toBe(10)
    })

    it('maps stop_reason to finish_reason', () => {
      const stopChunk = 'event: message_stop\ndata: {"type":"message_stop","delta":{"stop_reason":"tool_use"}}\n\n'
      const result = transformer.transform(stopChunk)

      expect(result.transformedChunk).toContain('"finish_reason":"tool_calls"')
      expect(result.transformedChunk).not.toContain('event:')
    })

    it('accumulates tool call arguments', () => {
      // Start tool use
      transformer.transform('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_123","name":"search"}}\n\n')

      // First argument fragment
      const delta1 = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"query\\""}}\n\n'
      const result1 = transformer.transform(delta1)
      expect(result1.transformedChunk).toContain('"tool_calls"')
      expect(result1.transformedChunk).toContain('"name":"search"')

      // Second argument fragment
      const delta2 = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":":\\"test\\"}"}}\n\n'
      const result2 = transformer.transform(delta2)
      expect(result2.transformedChunk).toContain('test')
      expect(result2.transformedChunk).not.toContain('event:')
    })
  })

  describe('Anthropic → OpenAI Responses', () => {
    let transformer: StreamTransformer

    beforeEach(() => {
      transformer = new StreamTransformer('anthropic', 'openai-responses', 'claude-3-5-sonnet-20241022')
    })

    it('filters out Anthropic event: headers', () => {
      const chunk = 'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123"}}\n\n'
      const result = transformer.transform(chunk)

      // Should NOT contain source event: line
      expect(result.transformedChunk).not.toContain('event: message_start')

      // Should contain transformed data
      expect(result.transformedChunk).toContain('"type":"response.created"')
    })

    it('produces valid OpenAI Responses SSE format', () => {
      transformer.transform('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_test"}}\n\n')

      const deltaChunk = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n'
      const result = transformer.transform(deltaChunk)

      // Should have data: lines, no event: lines
      const lines = result.transformedChunk.split('\n').filter(l => l.trim())
      for (const line of lines) {
        expect(line).not.toMatch(/^event:/)
      }

      expect(result.transformedChunk).toContain('"type":"response.output_item.content_part.delta"')
    })

    it('accumulates tool_use input correctly', () => {
      transformer.transform('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_tool"}}\n\n')
      transformer.transform('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_abc","name":"calc"}}\n\n')

      // Send JSON fragments
      transformer.transform('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"x\\""}}\n\n')
      transformer.transform('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":":42}"}}\n\n')
      transformer.transform('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n')
      transformer.transform('event: message_delta\ndata: {"type":"message_delta","usage":{"input_tokens":50,"output_tokens":25}}\n\n')

      // Final stop event
      const stopChunk = 'event: message_stop\ndata: {"type":"message_stop","delta":{"stop_reason":"tool_use"}}\n\n'
      const result = transformer.transform(stopChunk)

      // Parse final response
      const dataLine = result.transformedChunk.split('\n').find(l => l.startsWith('data:'))
      expect(dataLine).toBeDefined()
      const parsed = JSON.parse(dataLine!.slice(5).trim())

      // Verify tool input is parsed
      expect(parsed.response.content[0].input).toEqual({ x: 42 })
      expect(parsed.output[0].content[0].input).toEqual({ x: 42 })
    })

    it('maps stop_reason to status', () => {
      transformer.transform('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n')

      const stopChunk = 'event: message_stop\ndata: {"type":"message_stop","delta":{"stop_reason":"tool_use"}}\n\n'
      const result = transformer.transform(stopChunk)

      expect(result.transformedChunk).toContain('"status":"requires_action"')
      expect(result.transformedChunk).not.toContain('event:')
    })
  })

  describe('OpenAI Chat → Anthropic', () => {
    let transformer: StreamTransformer

    beforeEach(() => {
      transformer = new StreamTransformer('openai-chat', 'anthropic', 'gpt-4')
    })

    it('adds event: headers to Anthropic output', () => {
      const chunk = 'data: {"id":"chatcmpl_123","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n'
      const result = transformer.transform(chunk)

      // Should have event: headers
      expect(result.transformedChunk).toContain('event: message_start')
      expect(result.transformedChunk).toContain('event: content_block_start')
      expect(result.transformedChunk).toContain('event: content_block_delta')

      // Each event should be followed by data
      const lines = result.transformedChunk.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('event:')) {
          expect(lines[i + 1]).toMatch(/^data:/)
        }
      }
    })

    it('produces valid Anthropic SSE format', () => {
      const chunk = 'data: {"id":"chatcmpl_123","choices":[{"delta":{"content":"Test"},"finish_reason":null}]}\n\n'
      const result = transformer.transform(chunk)

      // Should have proper event: + data: pairs
      expect(result.transformedChunk).toMatch(/event: \w+\ndata: \{.*\}\n\n/)

      // Verify JSON is valid
      const dataLines = result.transformedChunk.split('\n').filter(l => l.startsWith('data:'))
      for (const line of dataLines) {
        const jsonStr = line.slice(5).trim()
        const parsed = JSON.parse(jsonStr)
        expect(parsed.type).toBeDefined()
      }
    })

    it('converts tool_calls to tool_use blocks', () => {
      const toolChunk = 'data: {"id":"chatcmpl_t","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"search","arguments":""}}]},"finish_reason":null}]}\n\n'
      const result = transformer.transform(toolChunk)

      // Should have event: headers
      expect(result.transformedChunk).toContain('event: content_block_start')

      // Should contain tool_use structure
      expect(result.transformedChunk).toContain('"type":"tool_use"')
      expect(result.transformedChunk).toContain('"id":"call_1"')
      expect(result.transformedChunk).toContain('"name":"search"')
    })

    it('maps finish_reason to stop_reason', () => {
      // First send content to trigger message_start
      transformer.transform('data: {"id":"chatcmpl_123","choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n\n')

      const stopChunk = 'data: {"id":"chatcmpl_123","choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n'
      const result = transformer.transform(stopChunk)

      expect(result.transformedChunk).toContain('event: message_stop')
      expect(result.transformedChunk).toContain('"stop_reason":"tool_use"')
    })

    it('extracts usage from OpenAI events', () => {
      const usageChunk = 'data: {"id":"chatcmpl_123","usage":{"prompt_tokens":100,"completion_tokens":50,"cached_tokens":20}}\n\n'
      const result = transformer.transform(usageChunk)

      expect(result.metadata.usage).toBeDefined()
      expect(result.metadata.usage?.inputTokens).toBe(100)
      expect(result.metadata.usage?.outputTokens).toBe(50)
      expect(result.metadata.usage?.cacheReadTokens).toBe(20)
    })
  })

  describe('Event Filtering Edge Cases', () => {
    it('preserves id: and retry: lines when converting to OpenAI', () => {
      const transformer = new StreamTransformer('anthropic', 'openai-chat', 'claude-3')
      const chunk = 'id: 123\nretry: 5000\nevent: ping\ndata: {"type":"ping"}\n\n'
      const result = transformer.transform(chunk)

      // Should preserve id: and retry:, but NOT event:
      expect(result.transformedChunk).toContain('id: 123')
      expect(result.transformedChunk).toContain('retry: 5000')
      expect(result.transformedChunk).not.toContain('event: ping')
    })

    it('does not filter event: lines when target is Anthropic', () => {
      const transformer = new StreamTransformer('openai-chat', 'anthropic', 'gpt-4')
      // OpenAI source doesn't have event: lines, so this tests the logic doesn't break
      const chunk = 'data: {"id":"chatcmpl_1","choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n\n'
      const result = transformer.transform(chunk)

      // Should ADD event: lines (target is Anthropic)
      expect(result.transformedChunk).toContain('event:')
    })
  })

  describe('Usage Accumulation', () => {
    it('getFinalUsage returns cumulative statistics', () => {
      const transformer = new StreamTransformer('anthropic', 'openai-chat', 'claude-3')

      transformer.transform('event: message_delta\ndata: {"type":"message_delta","usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":10,"cache_creation_input_tokens":5}}\n\n')
      transformer.transform('event: message_stop\ndata: {"type":"message_stop","usage":{"input_tokens":100,"output_tokens":75,"cache_read_input_tokens":10,"cache_creation_input_tokens":5}}\n\n')

      const finalUsage = transformer.getFinalUsage()
      expect(finalUsage.inputTokens).toBe(100)
      expect(finalUsage.outputTokens).toBe(75) // Last value
      expect(finalUsage.cacheReadTokens).toBe(10)
      expect(finalUsage.cacheCreationTokens).toBe(5)
    })
  })
})
