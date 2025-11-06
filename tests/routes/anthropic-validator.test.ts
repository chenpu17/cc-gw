import { describe, expect, it } from 'vitest'
import { validateAnthropicRequest } from '../../src/server/routes/anthropic-validator.ts'

const buildBasePayload = () => ({
  model: 'claude-haiku-4-5-20251001',
  system: [
    {
      type: 'text',
      text: 'You are Claude Code, Anthropic的本地开发助手。'
    }
  ],
  metadata: {
    user_id: 'user-123'
  },
  max_tokens: 32000,
  stream: true,
  tools: [
    {
      name: 'execute',
      description: 'Run shell commands',
      input_schema: {
        type: 'object',
        properties: {
          cmd: { type: 'string' }
        }
      }
    }
  ],
  tool_choice: {
    type: 'auto'
  },
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'hello world'
        }
      ]
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'call-1',
          name: 'execute',
          input: {
            cmd: 'ls'
          }
        }
      ]
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call-1',
          content: [
            {
              type: 'text',
              text: 'README.md\npackage.json'
            }
          ]
        }
      ]
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'Listing ready. Anything else?'
        }
      ]
    }
  ]
})

const buildClaudeCodeHeaders = () => ({
  'content-type': 'application/json',
  'anthropic-version': '2023-06-01',
  'user-agent': 'claude-cli/2.0.14 (external, cli)',
  'x-api-key': 'sk-test-key'
})

describe('validateAnthropicRequest', () => {
  describe('Payload validation', () => {
    it('accepts a valid Claude Code style payload', () => {
      const payload = buildBasePayload()
      const result = validateAnthropicRequest(payload)
      expect(result.ok).toBe(true)
    })

    it('rejects when messages is not an array', () => {
      const payload = { ...buildBasePayload(), messages: null as any }
      const result = validateAnthropicRequest(payload)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.path).toBe('messages')
      }
    })

    it('rejects invalid message roles', () => {
      const payload = buildBasePayload()
      ;(payload.messages[0] as any).role = 'system'
      const result = validateAnthropicRequest(payload)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.path).toBe('messages[0].role')
      }
    })

    it('rejects tool_use blocks without id', () => {
      const payload = buildBasePayload()
      const assistant = payload.messages[1] as any
      assistant.content[0].id = ''
      const result = validateAnthropicRequest(payload)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.path).toBe('messages[1].content[0].id')
      }
    })

    it('rejects assistant messages containing tool_result blocks', () => {
      const payload = buildBasePayload()
      const assistant = payload.messages[3] as any
      assistant.content = [
        {
          type: 'tool_result',
          tool_use_id: 'call-1',
          content: 'should-not-appear'
        }
      ]
      const result = validateAnthropicRequest(payload)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.path).toBe('messages[3].content[0]')
      }
    })

    it('rejects system field with invalid type', () => {
      const payload = buildBasePayload()
      ;(payload as any).system = 42
      const result = validateAnthropicRequest(payload)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.path).toBe('system')
      }
    })

    it('rejects claude-code payload without metadata.user_id', () => {
      const payload = buildBasePayload()
      delete (payload as any).metadata
      const result = validateAnthropicRequest(payload)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.path).toBe('metadata')
      }
    })

    it('allows missing metadata when mode is anthropic-strict', () => {
      const payload = buildBasePayload()
      delete (payload as any).metadata
      const result = validateAnthropicRequest(payload, { mode: 'anthropic-strict' })
      expect(result.ok).toBe(true)
    })
  })

  describe('HTTP request validation', () => {
    it('accepts valid Claude Code HTTP request', () => {
      const payload = buildBasePayload()
      const result = validateAnthropicRequest(payload, {
        mode: 'claude-code',
        request: {
          headers: buildClaudeCodeHeaders(),
          method: 'POST',
          query: null
        }
      })
      expect(result.ok).toBe(true)
    })

    it('rejects non-POST methods', () => {
      const payload = buildBasePayload()
      const result = validateAnthropicRequest(payload, {
        request: {
          headers: buildClaudeCodeHeaders(),
          method: 'GET',
          query: null
        }
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('POST')
      }
    })

    it('allows beta query parameter', () => {
      const payload = buildBasePayload()
      const result = validateAnthropicRequest(payload, {
        request: {
          headers: buildClaudeCodeHeaders(),
          method: 'POST',
          query: 'beta=true'
        }
      })
      expect(result.ok).toBe(true)
    })

    it('rejects unsupported query parameters', () => {
      const payload = buildBasePayload()
      const result = validateAnthropicRequest(payload, {
        request: {
          headers: buildClaudeCodeHeaders(),
          method: 'POST',
          query: 'foo=bar'
        }
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('foo')
      }
    })

    it('rejects missing Content-Type header', () => {
      const payload = buildBasePayload()
      const headers = { ...buildClaudeCodeHeaders() }
      delete headers['content-type']
      const result = validateAnthropicRequest(payload, {
        request: { headers, method: 'POST', query: null }
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Content-Type')
      }
    })

    it('rejects wrong Content-Type', () => {
      const payload = buildBasePayload()
      const headers = { ...buildClaudeCodeHeaders(), 'content-type': 'text/plain' }
      const result = validateAnthropicRequest(payload, {
        request: { headers, method: 'POST', query: null }
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('application/json')
      }
    })

    it('rejects missing anthropic-version header', () => {
      const payload = buildBasePayload()
      const headers = { ...buildClaudeCodeHeaders() }
      delete headers['anthropic-version']
      const result = validateAnthropicRequest(payload, {
        request: { headers, method: 'POST', query: null }
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('anthropic-version')
      }
    })

    it('rejects missing User-Agent in claude-code mode', () => {
      const payload = buildBasePayload()
      const headers = { ...buildClaudeCodeHeaders() }
      delete headers['user-agent']
      const result = validateAnthropicRequest(payload, {
        mode: 'claude-code',
        request: { headers, method: 'POST', query: null }
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('User-Agent')
      }
    })

    it('rejects non-Claude-Code User-Agent', () => {
      const payload = buildBasePayload()
      const headers = { ...buildClaudeCodeHeaders(), 'user-agent': 'curl/7.64.0' }
      const result = validateAnthropicRequest(payload, {
        mode: 'claude-code',
        request: { headers, method: 'POST', query: null }
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('User-Agent')
        expect(result.message).toContain('curl')
      }
    })

    it('allows any User-Agent in anthropic-strict mode', () => {
      const payload = buildBasePayload()
      delete (payload as any).metadata
      const headers = { ...buildClaudeCodeHeaders(), 'user-agent': 'curl/7.64.0' }
      const result = validateAnthropicRequest(payload, {
        mode: 'anthropic-strict',
        request: { headers, method: 'POST', query: null }
      })
      expect(result.ok).toBe(true)
    })
  })
})
