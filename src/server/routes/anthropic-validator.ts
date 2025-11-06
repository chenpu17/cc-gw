export interface AnthropicValidationResultOk {
  ok: true
}

export interface AnthropicValidationResultError {
  ok: false
  message: string
  path?: string
  code: string
}

export type AnthropicValidationResult = AnthropicValidationResultOk | AnthropicValidationResultError

export type AnthropicValidationMode = 'claude-code' | 'anthropic-strict'

export interface AnthropicRequestContext {
  headers?: Record<string, string | string[] | undefined>
  method?: string
  query?: string | null
}

export interface AnthropicValidationContext {
  mode?: AnthropicValidationMode
  allowExperimentalBlocks?: boolean
  request?: AnthropicRequestContext
}

const ALLOWED_ROLES = new Set(['user', 'assistant'])
const KNOWN_BLOCK_TYPES = new Set(['text', 'tool_use', 'tool_result', 'thinking', 'output_text', 'input_text', 'image'])
const ALLOWED_TYPE_PREFIXES = ['input_', 'output_', 'data_', 'media_']

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function appendPath(base: string | undefined, segment: string): string {
  if (!base) return segment
  if (segment.startsWith('[')) return `${base}${segment}`
  return `${base}.${segment}`
}

function fail(message: string, path?: string, code = 'invalid_payload'): AnthropicValidationResultError {
  return { ok: false, message, path, code }
}

function isSupportedBlockType(type: string, allowExperimental?: boolean): boolean {
  if (KNOWN_BLOCK_TYPES.has(type)) {
    return true
  }
  if (allowExperimental) {
    return ALLOWED_TYPE_PREFIXES.some((prefix) => type.startsWith(prefix))
  }
  return false
}

function validateCacheControl(value: unknown, path: string): AnthropicValidationResult | null {
  if (value === undefined) {
    return null
  }
  if (!isPlainObject(value)) {
    return fail('cache_control 必须是对象', path, 'invalid_cache_control')
  }
  if (value.type !== undefined && typeof value.type !== 'string') {
    return fail('cache_control.type 必须是字符串', appendPath(path, 'type'), 'invalid_cache_control')
  }
  return null
}

function validateToolInput(value: unknown, path: string): AnthropicValidationResult | null {
  if (value === undefined) {
    return fail('tool_use.input 为必填字段', path, 'invalid_tool_use')
  }
  if (isPlainObject(value)) {
    return null
  }
  if (typeof value === 'string') {
    return null
  }
  return fail('tool_use.input 必须是对象或字符串', path, 'invalid_tool_use')
}

function validateToolResultContent(value: unknown, path: string): AnthropicValidationResult | null {
  if (value === undefined) {
    return fail('tool_result.content 为必填字段', path, 'invalid_tool_result')
  }
  if (typeof value === 'string') {
    return null
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const entry = value[i]
      if (typeof entry === 'string') {
        continue
      }
      if (!isPlainObject(entry)) {
        return fail('tool_result.content[i] 必须是字符串或对象', appendPath(path, `[${i}]`), 'invalid_tool_result')
      }
      if (entry.type !== undefined && typeof entry.type !== 'string') {
        return fail('tool_result.content[i].type 必须是字符串', appendPath(path, `[${i}].type`), 'invalid_tool_result')
      }
      if (entry.text !== undefined && typeof entry.text !== 'string') {
        return fail('tool_result.content[i].text 必须是字符串', appendPath(path, `[${i}].text`), 'invalid_tool_result')
      }
    }
    return null
  }
  if (isPlainObject(value)) {
    if (typeof value.text !== 'string') {
      return fail('tool_result.content.text 必须是字符串', appendPath(path, 'text'), 'invalid_tool_result')
    }
    return null
  }
  return fail('tool_result.content 必须是字符串、数组或对象', path, 'invalid_tool_result')
}

function validateContentBlock(
  block: unknown,
  opts: { path: string; allowExperimental?: boolean; role: 'user' | 'assistant' }
): AnthropicValidationResult | null {
  if (!isPlainObject(block)) {
    return fail('content 块必须是对象', opts.path, 'invalid_content_block')
  }
  if (typeof block.type !== 'string' || block.type.trim().length === 0) {
    return fail('content 块缺少有效的 type 字段', appendPath(opts.path, 'type'), 'invalid_content_block')
  }

  const type = block.type
  if (!isSupportedBlockType(type, opts.allowExperimental)) {
    return fail(`不支持的内容块类型 ${type}`, appendPath(opts.path, 'type'), 'unsupported_content_block')
  }

  const cacheValidation = validateCacheControl(block.cache_control, appendPath(opts.path, 'cache_control'))
  if (cacheValidation) {
    return cacheValidation
  }

  switch (type) {
    case 'text':
    case 'thinking':
    case 'output_text':
    case 'input_text': {
      if (block.text !== undefined && typeof block.text !== 'string') {
        return fail(`${type} 块的 text 必须是字符串`, appendPath(opts.path, 'text'), 'invalid_content_block')
      }
      if (block.id !== undefined && typeof block.id !== 'string') {
        return fail(`${type} 块的 id 必须是字符串`, appendPath(opts.path, 'id'), 'invalid_content_block')
      }
      break
    }
    case 'image': {
      if (!block.source || !isPlainObject(block.source)) {
        return fail('image 块必须包含 source 对象', appendPath(opts.path, 'source'), 'invalid_content_block')
      }
      if (typeof block.source.type !== 'string') {
        return fail('image 块 source.type 必须是字符串', appendPath(opts.path, 'source.type'), 'invalid_content_block')
      }
      if (block.source.media_type !== undefined && typeof block.source.media_type !== 'string') {
        return fail('image 块 source.media_type 必须是字符串', appendPath(opts.path, 'source.media_type'), 'invalid_content_block')
      }
      break
    }
    case 'tool_use': {
      if (typeof block.id !== 'string' || block.id.trim().length === 0) {
    return fail('tool_use 块需要字符串类型的 id', appendPath(opts.path, 'id'), 'invalid_tool_use')
      }
      if (typeof block.name !== 'string' || block.name.trim().length === 0) {
    return fail('tool_use 块需要字符串类型的 name', appendPath(opts.path, 'name'), 'invalid_tool_use')
      }
      const inputValidation = validateToolInput(block.input, appendPath(opts.path, 'input'))
      if (inputValidation) {
        return inputValidation
      }
      break
    }
    case 'tool_result': {
      if (typeof block.tool_use_id !== 'string' || block.tool_use_id.trim().length === 0) {
        return fail('tool_result 块需要字符串类型的 tool_use_id', appendPath(opts.path, 'tool_use_id'))
      }
      const contentValidation = validateToolResultContent(block.content, appendPath(opts.path, 'content'))
      if (contentValidation) {
        return contentValidation
      }
      break
    }
    default:
      break
  }

  if (block.type === 'tool_use' && opts.role === 'user') {
    return fail('user 消息不能包含 tool_use 块', opts.path, 'invalid_user_message')
  }

  if (block.type === 'tool_result' && opts.role === 'assistant') {
    return fail('assistant 消息不能包含 tool_result 块', opts.path, 'invalid_assistant_message')
  }

  return null
}

function validateMessageContent(
  message: Record<string, unknown>,
  role: 'user' | 'assistant',
  path: string,
  allowExperimental?: boolean
): AnthropicValidationResult | null {
  if (!('content' in message)) {
    return fail('messages.content 为必填字段', path, 'invalid_message')
  }
  const content = message.content
  if (typeof content === 'string') {
    return null
  }
  if (Array.isArray(content)) {
    for (let i = 0; i < content.length; i += 1) {
      const block = content[i]
      const blockValidation = validateContentBlock(block, {
        path: appendPath(path, `[${i}]`),
        allowExperimental,
        role
      })
      if (blockValidation) {
        return blockValidation
      }
    }
    return null
  }
  if (content === null) {
    return null
  }
  return fail('messages.content 必须是字符串或内容块数组', path, 'invalid_message')
}

function validateMessages(
  messages: unknown,
  opts: { allowExperimental?: boolean }
): AnthropicValidationResult | null {
  if (!Array.isArray(messages) || messages.length === 0) {
    return fail('messages 必须是非空数组', 'messages', 'invalid_message')
  }

  for (let i = 0; i < messages.length; i += 1) {
    const entry = messages[i]
    const path = `messages[${i}]`
    if (!isPlainObject(entry)) {
    return fail('messages[i] 必须是对象', path, 'invalid_message')
    }
    if (typeof entry.role !== 'string' || !ALLOWED_ROLES.has(entry.role)) {
      return fail('messages[i].role 必须是 "user" 或 "assistant"', appendPath(path, 'role'), 'unsupported_role')
    }
    const role = entry.role as 'user' | 'assistant'

    const contentValidation = validateMessageContent(entry, role, appendPath(path, 'content'), opts.allowExperimental)
    if (contentValidation) {
      return contentValidation
    }

    if (entry.stop_reason !== undefined && typeof entry.stop_reason !== 'string' && entry.stop_reason !== null) {
      return fail('messages[i].stop_reason 必须是字符串或 null', appendPath(path, 'stop_reason'), 'invalid_stop_reason')
    }
  }
  return null
}

function validateSystemField(system: unknown): AnthropicValidationResult | null {
  if (system === undefined || system === null) {
    return null
  }
  if (typeof system === 'string') {
    return null
  }
  if (Array.isArray(system)) {
    for (let i = 0; i < system.length; i += 1) {
      const block = system[i]
      const path = `system[${i}]`
      if (!isPlainObject(block)) {
        return fail('system[i] 必须是对象', path, 'invalid_system')
      }
      if (block.type !== undefined && typeof block.type !== 'string') {
        return fail('system[i].type 必须是字符串', appendPath(path, 'type'), 'invalid_system')
      }
      if (block.type === 'text' && block.text !== undefined && typeof block.text !== 'string') {
        return fail('system[i].text 必须是字符串', appendPath(path, 'text'), 'invalid_system')
      }
    }
    return null
  }
  if (isPlainObject(system)) {
    if (typeof system.text === 'string' || Array.isArray(system.text)) {
      return null
    }
    if (system.type === 'text' && typeof system.text === 'string') {
      return null
    }
  }
  return fail('system 字段必须是字符串、对象或内容块数组', 'system', 'invalid_system')
}

function validateTools(tools: unknown): AnthropicValidationResult | null {
  if (tools === undefined) {
    return null
  }
  if (!Array.isArray(tools)) {
    return fail('tools 必须是数组', 'tools')
  }
  for (let i = 0; i < tools.length; i += 1) {
    const tool = tools[i]
    const path = `tools[${i}]`
    if (!isPlainObject(tool)) {
    return fail('tools[i] 必须是对象', path, 'invalid_tool')
    }
    if (typeof tool.name !== 'string' || tool.name.trim().length === 0) {
      return fail('tools[i].name 必须是非空字符串', appendPath(path, 'name'), 'invalid_tool')
    }
    if (tool.input_schema !== undefined && !isPlainObject(tool.input_schema)) {
      return fail('tools[i].input_schema 必须是对象', appendPath(path, 'input_schema'), 'invalid_tool')
    }
    if (tool.parameters !== undefined && !isPlainObject(tool.parameters)) {
      return fail('tools[i].parameters 必须是对象', appendPath(path, 'parameters'), 'invalid_tool')
    }
  }
  return null
}

function validateMetadata(metadata: unknown): AnthropicValidationResult | null {
  if (metadata === undefined) {
    return null
  }
  if (!isPlainObject(metadata)) {
  return fail('metadata 必须是对象', 'metadata', 'invalid_metadata')
  }
  return null
}

function validateToolChoice(toolChoice: unknown): AnthropicValidationResult | null {
  if (toolChoice === undefined) {
    return null
  }
  if (typeof toolChoice === 'string') {
    return null
  }
  if (isPlainObject(toolChoice)) {
    if (toolChoice.type !== undefined && typeof toolChoice.type !== 'string') {
      return fail('tool_choice.type 必须是字符串', 'tool_choice.type')
    }
    if (toolChoice.name !== undefined && typeof toolChoice.name !== 'string') {
      return fail('tool_choice.name 必须是字符串', 'tool_choice.name')
    }
    return null
  }
  return fail('tool_choice 必须是字符串或对象', 'tool_choice', 'invalid_tool_choice')
}

function validateMaxTokens(maxTokens: unknown): AnthropicValidationResult | null {
  if (maxTokens === undefined) {
    return null
  }
  if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens) || maxTokens <= 0) {
    return fail('max_tokens 必须是正数', 'max_tokens', 'invalid_max_tokens')
  }
  return null
}

function validateTemperature(value: unknown): AnthropicValidationResult | null {
  if (value === undefined) {
    return null
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
  return fail('temperature 必须是数字', 'temperature', 'invalid_temperature')
  }
  return null
}

function validateStream(value: unknown): AnthropicValidationResult | null {
  if (value === undefined) {
    return null
  }
  if (typeof value !== 'boolean') {
    return fail('stream 必须是布尔值', 'stream', 'invalid_stream_flag')
  }
  return null
}

function normalizeHeaderValue(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.length > 0) {
    return value.find((item) => typeof item === 'string' && item.trim().length > 0)
  }
  return undefined
}

function validateHttpRequest(ctx: AnthropicRequestContext, mode: AnthropicValidationMode): AnthropicValidationResult | null {
  // 1. 验证 HTTP 方法
  if (ctx.method && ctx.method.toUpperCase() !== 'POST') {
    return fail(`HTTP 方法必须是 POST,当前为 ${ctx.method}`, undefined, 'invalid_method')
  }

  // 2. 验证 query 参数（仅允许 claude beta 标记）
  if (ctx.query && ctx.query.trim().length > 0) {
    const raw = ctx.query.startsWith('?') ? ctx.query.slice(1) : ctx.query
    const params = new URLSearchParams(raw)
    const allowedKeys = new Set(['beta'])
    for (const key of params.keys()) {
      if (!allowedKeys.has(key)) {
        return fail(`存在不允许的 query 参数: ${key}`, undefined, 'invalid_query')
      }
    }
    // beta 参数可为空或等于 true，其他值仅提示但允许
    if (params.has('beta')) {
      const beta = params.getAll('beta')
      const invalid = beta.some((value) => value && value.toLowerCase() !== 'true')
      if (invalid && mode === 'anthropic-strict') {
        return fail('beta 参数仅支持 true 或留空', undefined, 'invalid_query')
      }
    }
  }

  if (!ctx.headers) {
    return null
  }

  // 3. 验证 Content-Type
  const contentType = normalizeHeaderValue(ctx.headers['content-type'])
  if (!contentType || !contentType.includes('application/json')) {
    return fail('Content-Type 必须是 application/json', undefined, 'invalid_headers')
  }

  // 4. 验证 anthropic-version (必填)
  const anthropicVersion = normalizeHeaderValue(ctx.headers['anthropic-version'])
  if (!anthropicVersion || anthropicVersion.trim().length === 0) {
    return fail('缺少必填 header: anthropic-version', undefined, 'invalid_headers')
  }

  // 5. Claude Code 专属: 验证 User-Agent
  if (mode === 'claude-code') {
    const userAgent = normalizeHeaderValue(ctx.headers['user-agent'])
    if (!userAgent) {
      return fail('Claude Code 请求必须包含 User-Agent header', undefined, 'invalid_headers')
    }

    // Claude Code 的 User-Agent 格式: claude-cli/x.x.x (external, cli)
    const isClaudeCode = userAgent.includes('claude-cli/') || userAgent.includes('Claude Code/')
    if (!isClaudeCode) {
      return fail(`User-Agent 不符合 Claude Code 规范: ${userAgent}`, undefined, 'invalid_headers')
    }
  }

  return null
}

export function validateAnthropicRequest(
  payload: unknown,
  ctx: AnthropicValidationContext = {}
): AnthropicValidationResult {
  if (!isPlainObject(payload)) {
    return fail('请求体必须是 JSON 对象')
  }

  if (typeof payload.model !== 'string' || payload.model.trim().length === 0) {
    return fail('model 必须是非空字符串', 'model')
  }

  const mode: AnthropicValidationMode = ctx.mode ?? 'claude-code'
  const allowExperimentalBlocks =
    ctx.allowExperimentalBlocks ?? (mode === 'claude-code')

  // HTTP 请求层面的校验
  if (ctx.request) {
    const httpValidation = validateHttpRequest(ctx.request, mode)
    if (httpValidation) {
      return httpValidation
    }
  }

  const messagesValidation = validateMessages(payload.messages, {
    allowExperimental: allowExperimentalBlocks
  })
  if (messagesValidation) {
    return messagesValidation
  }

  const systemValidation = validateSystemField(payload.system)
  if (systemValidation) {
    return systemValidation
  }

  const toolsValidation = validateTools(payload.tools)
  if (toolsValidation) {
    return toolsValidation
  }

  const metadataValidation = validateMetadata(payload.metadata)
  if (metadataValidation) {
    return metadataValidation
  }

  if (mode === 'claude-code') {
    if (!payload.metadata || !isPlainObject(payload.metadata)) {
      return fail('Claude Code 请求必须包含 metadata 对象', 'metadata')
    }
    const userId = (payload.metadata as Record<string, unknown>).user_id
    if (typeof userId !== 'string' || userId.trim().length === 0) {
      return fail('Claude Code 请求必须包含 metadata.user_id 字符串', 'metadata.user_id')
    }
  }

  const toolChoiceValidation = validateToolChoice(payload.tool_choice)
  if (toolChoiceValidation) {
    return toolChoiceValidation
  }

  const temperatureValidation = validateTemperature(payload.temperature)
  if (temperatureValidation) {
    return temperatureValidation
  }

  const maxTokensValidation = validateMaxTokens(payload.max_tokens)
  if (maxTokensValidation) {
    return maxTokensValidation
  }

  const streamValidation = validateStream(payload.stream)
  if (streamValidation) {
    return streamValidation
  }

  return { ok: true }
}
