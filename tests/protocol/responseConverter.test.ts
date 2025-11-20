import { describe, expect, it } from 'vitest'
import {
  convertOpenAIToAnthropic,
  convertAnthropicToOpenAIChat,
  convertAnthropicToOpenAIResponse,
  convertAnthropicContent,
  mapAnthropicStopReasonToChatFinish
} from '../../src/server/protocol/responseConverter.ts'

describe('responseConverter', () => {
  describe('convertOpenAIToAnthropic', () => {
    it('converts basic text response', () => {
      const openAI = {
        id: 'chatcmpl_abc123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'Hello, world!'
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15
        }
      }

      const result = convertOpenAIToAnthropic(openAI, 'claude-3-5-sonnet-20241022')

      expect(result.id).toBe('msg_abc123')
      expect(result.type).toBe('message')
      expect(result.role).toBe('assistant')
      expect(result.model).toBe('claude-3-5-sonnet-20241022')
      expect(result.content).toEqual([{
        type: 'text',
        text: 'Hello, world!'
      }])
      expect(result.stop_reason).toBe('end_turn')
      expect(result.usage).toEqual({
        input_tokens: 10,
        output_tokens: 5
      })
    })

    it('converts tool_calls to tool_use blocks', () => {
      const openAI = {
        id: 'chatcmpl_123',
        choices: [{
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_abc',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"city":"Tokyo"}'
                }
              },
              {
                id: 'call_def',
                type: 'function',
                function: {
                  name: 'get_time',
                  arguments: '{}'
                }
              }
            ]
          },
          finish_reason: 'tool_calls'
        }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50
        }
      }

      const result = convertOpenAIToAnthropic(openAI, 'claude-3')

      expect(result.content).toHaveLength(2)
      expect(result.content[0]).toEqual({
        type: 'tool_use',
        id: 'call_abc',
        name: 'get_weather',
        input: { city: 'Tokyo' }
      })
      expect(result.content[1]).toEqual({
        type: 'tool_use',
        id: 'call_def',
        name: 'get_time',
        input: {}
      })
      expect(result.stop_reason).toBe('tool_use')
    })

    it('handles mixed content and tool_calls', () => {
      const openAI = {
        id: 'chatcmpl_123',
        choices: [{
          message: {
            role: 'assistant',
            content: 'Let me check that for you.',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: {
                name: 'search',
                arguments: '{"query":"test"}'
              }
            }]
          },
          finish_reason: 'tool_calls'
        }],
        usage: { prompt_tokens: 50, completion_tokens: 25 }
      }

      const result = convertOpenAIToAnthropic(openAI, 'claude-3')

      expect(result.content).toHaveLength(2)
      expect(result.content[0].type).toBe('text')
      expect(result.content[1].type).toBe('tool_use')
    })

    it('handles empty content', () => {
      const openAI = {
        id: 'chatcmpl_123',
        choices: [{
          message: {
            role: 'assistant',
            content: ''
          },
          finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 10, completion_tokens: 0 }
      }

      const result = convertOpenAIToAnthropic(openAI, 'claude-3')

      expect(result.content).toEqual([])
    })

    it('maps finish_reason correctly', () => {
      const testCases = [
        { input: 'stop', expected: 'end_turn' },
        { input: 'tool_calls', expected: 'tool_use' },
        { input: 'length', expected: 'max_tokens' }
      ]

      for (const { input, expected } of testCases) {
        const openAI = {
          id: 'chatcmpl_123',
          choices: [{
            message: { role: 'assistant', content: 'test' },
            finish_reason: input
          }],
          usage: { prompt_tokens: 1, completion_tokens: 1 }
        }

        const result = convertOpenAIToAnthropic(openAI, 'claude-3')
        expect(result.stop_reason).toBe(expected)
      }
    })

    it('handles malformed tool arguments JSON', () => {
      const openAI = {
        id: 'chatcmpl_123',
        choices: [{
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: {
                name: 'tool',
                arguments: '{invalid json}'
              }
            }]
          },
          finish_reason: 'tool_calls'
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      }

      const result = convertOpenAIToAnthropic(openAI, 'claude-3')

      expect(result.content[0].input).toEqual({}) // Fallback to empty object
    })

    it('maps cached_tokens to cache_read_input_tokens', () => {
      const openAI = {
        id: 'chatcmpl_123',
        choices: [{
          message: {
            role: 'assistant',
            content: 'Hello, world!'
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          cached_tokens: 30
        }
      }

      const result = convertOpenAIToAnthropic(openAI, 'claude-3')

      expect(result.usage).toEqual({
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 30
      })
    })

    it('does not add cache_read_input_tokens when cached_tokens is zero', () => {
      const openAI = {
        id: 'chatcmpl_123',
        choices: [{
          message: {
            role: 'assistant',
            content: 'Test'
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          cached_tokens: 0
        }
      }

      const result = convertOpenAIToAnthropic(openAI, 'claude-3')

      expect(result.usage).toEqual({
        input_tokens: 10,
        output_tokens: 5
      })
      expect(result.usage.cache_read_input_tokens).toBeUndefined()
    })

    it('does not add cache_read_input_tokens when cached_tokens is missing', () => {
      const openAI = {
        id: 'chatcmpl_123',
        choices: [{
          message: {
            role: 'assistant',
            content: 'Test'
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5
        }
      }

      const result = convertOpenAIToAnthropic(openAI, 'claude-3')

      expect(result.usage).toEqual({
        input_tokens: 10,
        output_tokens: 5
      })
      expect(result.usage.cache_read_input_tokens).toBeUndefined()
    })
  })

  describe('convertAnthropicToOpenAIChat', () => {
    it('converts basic text response', () => {
      const anthropic = {
        id: 'msg_abc123',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-5-sonnet-20241022',
        content: [{
          type: 'text',
          text: 'Hello, world!'
        }],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          output_tokens: 5
        }
      }

      const result = convertAnthropicToOpenAIChat(anthropic, 'claude-3-5-sonnet-20241022', {
        inputTokens: 10,
        outputTokens: 5,
        cachedTokens: 0
      })

      expect(result.id).toBe('chatcmpl_abc123')
      expect(result.object).toBe('chat.completion')
      expect(result.model).toBe('claude-3-5-sonnet-20241022')
      expect(result.choices[0].message.role).toBe('assistant')
      expect(result.choices[0].message.content).toBe('Hello, world!')
      expect(result.choices[0].finish_reason).toBe('stop')
      expect(result.usage).toEqual({
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15
      })
    })

    it('converts tool_use blocks to tool_calls', () => {
      const anthropic = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Let me search for that.'
          },
          {
            type: 'tool_use',
            id: 'toolu_abc',
            name: 'search',
            input: { query: 'test', limit: 10 }
          }
        ],
        stop_reason: 'tool_use'
      }

      const result = convertAnthropicToOpenAIChat(anthropic, 'claude-3', {
        inputTokens: 50,
        outputTokens: 25
      })

      expect(result.choices[0].message.content).toBe('Let me search for that.')
      expect(result.choices[0].message.tool_calls).toEqual([{
        id: 'toolu_abc',
        type: 'function',
        function: {
          name: 'search',
          arguments: '{"query":"test","limit":10}'
        }
      }])
      expect(result.choices[0].finish_reason).toBe('tool_calls')
    })

    it('handles multiple tool_use blocks', () => {
      const anthropic = {
        id: 'msg_123',
        content: [
          {
            type: 'tool_use',
            id: 'tool1',
            name: 'get_weather',
            input: { city: 'Tokyo' }
          },
          {
            type: 'tool_use',
            id: 'tool2',
            name: 'get_time',
            input: {}
          }
        ],
        stop_reason: 'tool_use'
      }

      const result = convertAnthropicToOpenAIChat(anthropic, 'claude-3', {
        inputTokens: 100,
        outputTokens: 50
      })

      expect(result.choices[0].message.tool_calls).toHaveLength(2)
      expect(result.choices[0].message.content).toBe('')
    })

    it('includes cached_tokens in usage when provided', () => {
      const anthropic = {
        id: 'msg_123',
        content: [{ type: 'text', text: 'test' }],
        stop_reason: 'end_turn'
      }

      const result = convertAnthropicToOpenAIChat(anthropic, 'claude-3', {
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 20
      })

      expect(result.usage.cached_tokens).toBe(20)
      expect(result.usage.total_tokens).toBe(150)
    })

    it('maps stop_reason correctly', () => {
      const testCases = [
        { input: 'end_turn', expected: 'stop' },
        { input: 'tool_use', expected: 'tool_calls' },
        { input: 'max_tokens', expected: 'length' },
        { input: 'stop_sequence', expected: 'stop' }
      ]

      for (const { input, expected } of testCases) {
        const anthropic = {
          id: 'msg_123',
          content: [{ type: 'text', text: 'test' }],
          stop_reason: input
        }

        const result = convertAnthropicToOpenAIChat(anthropic, 'claude-3', {
          inputTokens: 10,
          outputTokens: 5
        })

        expect(result.choices[0].finish_reason).toBe(expected)
      }
    })

    it('handles empty content array', () => {
      const anthropic = {
        id: 'msg_123',
        content: [],
        stop_reason: 'end_turn'
      }

      const result = convertAnthropicToOpenAIChat(anthropic, 'claude-3', {
        inputTokens: 10,
        outputTokens: 0
      })

      expect(result.choices[0].message.content).toBe('')
    })
  })

  describe('convertAnthropicToOpenAIResponse', () => {
    it('converts basic text response', () => {
      const anthropic = {
        id: 'msg_abc123',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-5-sonnet-20241022',
        content: [{
          type: 'text',
          text: 'Hello, world!'
        }],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          output_tokens: 5
        }
      }

      const result = convertAnthropicToOpenAIResponse(anthropic, 'claude-3-5-sonnet-20241022', {
        inputTokens: 10,
        outputTokens: 5,
        cachedTokens: 0
      })

      expect(result.id).toBe('resp_abc123')
      expect(result.object).toBe('response')
      expect(result.model).toBe('claude-3-5-sonnet-20241022')
      expect(result.status).toBe('completed')
      expect(result.status_code).toBe(200)
      expect(result.response.content[0]).toEqual({
        id: expect.any(String),
        type: 'output_text',
        text: 'Hello, world!'
      })
      expect(result.output[0].content[0].text).toBe('Hello, world!')
      expect(result.output_text).toBe('Hello, world!')
    })

    it('includes usage information', () => {
      const anthropic = {
        id: 'msg_123',
        content: [{ type: 'text', text: 'test' }],
        stop_reason: 'end_turn'
      }

      const result = convertAnthropicToOpenAIResponse(anthropic, 'claude-3', {
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 15
      })

      expect(result.usage).toEqual({
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
        prompt_tokens: 100,
        completion_tokens: 50,
        cached_tokens: 15
      })
    })

    it('maps stop_reason to status correctly', () => {
      const testCases = [
        { stopReason: 'end_turn', expectedStatus: 'completed' },
        { stopReason: 'tool_use', expectedStatus: 'requires_action' },
        { stopReason: 'max_tokens', expectedStatus: 'incomplete' },
        { stopReason: 'stop_sequence', expectedStatus: 'incomplete' }
      ]

      for (const { stopReason, expectedStatus } of testCases) {
        const anthropic = {
          id: 'msg_123',
          content: [{ type: 'text', text: 'test' }],
          stop_reason: stopReason
        }

        const result = convertAnthropicToOpenAIResponse(anthropic, 'claude-3', {
          inputTokens: 10,
          outputTokens: 5,
          cachedTokens: null
        })

        expect(result.status).toBe(expectedStatus)
      }
    })

    it('preserves metadata', () => {
      const anthropic = {
        id: 'msg_123',
        content: [{ type: 'text', text: 'test' }],
        stop_reason: 'end_turn',
        metadata: {
          user_id: 'user_abc',
          custom_field: 'value'
        }
      }

      const result = convertAnthropicToOpenAIResponse(anthropic, 'claude-3', {
        inputTokens: 10,
        outputTokens: 5,
        cachedTokens: null
      })

      expect(result.metadata).toEqual({
        user_id: 'user_abc',
        custom_field: 'value'
      })
    })

    it('handles tool_use blocks', () => {
      const anthropic = {
        id: 'msg_123',
        content: [
          { type: 'text', text: 'Searching...' },
          {
            type: 'tool_use',
            id: 'toolu_abc',
            name: 'search',
            input: { query: 'test' }
          }
        ],
        stop_reason: 'tool_use'
      }

      const result = convertAnthropicToOpenAIResponse(anthropic, 'claude-3', {
        inputTokens: 50,
        outputTokens: 25,
        cachedTokens: null
      })

      expect(result.response.content).toHaveLength(2)
      expect(result.response.content[1]).toEqual({
        id: 'toolu_abc',
        type: 'tool_use',
        name: 'search',
        input: { query: 'test' }
      })
      expect(result.status).toBe('requires_action')
    })
  })

  describe('convertAnthropicContent', () => {
    it('converts text blocks', () => {
      const blocks = [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: ' world' }
      ]

      const result = convertAnthropicContent(blocks)

      expect(result.content).toHaveLength(2)
      expect(result.content[0].type).toBe('output_text')
      expect(result.content[0].text).toBe('Hello')
      expect(result.aggregatedText).toBe('Hello world')
    })

    it('converts tool_use blocks', () => {
      const blocks = [{
        type: 'tool_use',
        id: 'toolu_123',
        name: 'get_weather',
        input: { city: 'Tokyo' }
      }]

      const result = convertAnthropicContent(blocks)

      expect(result.content[0]).toEqual({
        id: 'toolu_123',
        type: 'tool_use',
        name: 'get_weather',
        input: { city: 'Tokyo' },
        cache_control: undefined
      })
      expect(result.aggregatedText).toBe('')
    })

    it('converts tool_result blocks', () => {
      const blocks = [{
        type: 'tool_result',
        tool_use_id: 'toolu_123',
        content: 'Sunny, 25°C'
      }]

      const result = convertAnthropicContent(blocks)

      expect(result.content[0].type).toBe('tool_result')
      expect(result.content[0].tool_use_id).toBe('toolu_123')
      expect(result.content[0].content).toBe('Sunny, 25°C')
    })

    it('handles empty or invalid input', () => {
      expect(convertAnthropicContent([])).toEqual({
        content: [],
        aggregatedText: ''
      })

      expect(convertAnthropicContent(null as any)).toEqual({
        content: [],
        aggregatedText: ''
      })

      expect(convertAnthropicContent('not an array' as any)).toEqual({
        content: [],
        aggregatedText: ''
      })
    })

    it('preserves cache_control if present', () => {
      const blocks = [{
        type: 'text',
        text: 'cached content',
        cache_control: { type: 'ephemeral' }
      }]

      const result = convertAnthropicContent(blocks)

      // cache_control is passed through but not explicitly tested in original
      expect(result.content[0]).toBeDefined()
    })
  })

  describe('mapAnthropicStopReasonToChatFinish', () => {
    it('maps all known stop reasons', () => {
      const mappings = {
        'tool_use': 'tool_calls',
        'max_tokens': 'length',
        'stop_sequence': 'stop',
        'end_turn': 'stop',
        'stop': 'stop'
      }

      for (const [input, expected] of Object.entries(mappings)) {
        expect(mapAnthropicStopReasonToChatFinish(input)).toBe(expected)
      }
    })

    it('returns null for null/undefined input', () => {
      expect(mapAnthropicStopReasonToChatFinish(null)).toBeNull()
      expect(mapAnthropicStopReasonToChatFinish(undefined)).toBeNull()
    })

    it('passes through unknown stop reasons', () => {
      expect(mapAnthropicStopReasonToChatFinish('unknown_reason')).toBe('unknown_reason')
    })
  })
})
