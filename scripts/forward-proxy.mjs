#!/usr/bin/env node
/**
 * Transparent forward proxy that prints Claude Code traffic while relaying it to any upstream.
 *
 * Example (forward Anthropic traffic to GLM while logging bodies):
 *   node scripts/forward-proxy.mjs \
 *     --port 4101 \
 *     --target https://open.bigmodel.cn/api/anthropic \
 *     --strip-prefix /anthropic \
 *     --prepend-prefix /anthropic \
 *     --verbose --dump-body
 *
 * Supported options:
 *   --port <n>              Listening port (default $FORWARD_PORT or 4101)
 *   --host <host>           Listening host (default $FORWARD_HOST or 127.0.0.1)
 *   --target <url>          Upstream base URL (required)
 *   --strip-prefix <path>   Remove prefix from incoming request path before forwarding
 *   --prepend-prefix <path> Prepend prefix to outgoing path
 *   --set-header key:value  Inject/override header when forwarding (can repeat)
 *   --verbose               Log method/status and truncated payloads
 *   --dump-body             Print full request/response body (warning: may be large)
 *   --record-dir <path>     Persist captured requests/responses into the given directory
 *   --record-mode <mode>    Recording mode: headers|full|traces (default full)
 *   --record-limit <n>      Retain at most N recorded entries (oldest removed first)
 *   --record-tag <label>    Attach a custom tag to each recorded entry
 *   --record-gzip           Compress recorded payloads using gzip
 *   --redact-header <key>   Redact matching header when recording (repeatable)
 *   --redact-body-key <key> Redact matching JSON body field when recording (repeatable)
 *
 * Environment variables mirror the CLI flags (e.g. FORWARD_TARGET, FORWARD_STRIP_PREFIX, etc.).
 */

import http from 'node:http'
import { TextDecoder } from 'node:util'
import { Readable } from 'node:stream'
import fs from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'

const DEFAULT_RECORD_MODE = 'full'
const VALID_RECORD_MODES = new Set(['headers', 'full', 'traces'])
const DEFAULT_REDACT_HEADERS = new Set(['authorization', 'proxy-authorization', 'x-api-key'])

function normalizePath(value, { leadingSlash = true, trailingSlash = false } = {}) {
  if (!value) return ''
  let normalized = value.trim()
  if (normalized === '/') return leadingSlash ? '/' : ''
  if (normalized.endsWith('/')) normalized = normalized.slice(0, -1)
  if (leadingSlash && !normalized.startsWith('/')) normalized = `/${normalized}`
  if (!leadingSlash && normalized.startsWith('/')) normalized = normalized.slice(1)
  if (trailingSlash) normalized = `${normalized}/`
  return normalized
}

function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    port: Number(process.env.FORWARD_PORT ?? 4101),
    host: process.env.FORWARD_HOST ?? '127.0.0.1',
    target: process.env.FORWARD_TARGET,
    verbose: process.env.FORWARD_VERBOSE === '1',
    dumpBody: process.env.FORWARD_DUMP_BODY === '1',
    stripPrefix: process.env.FORWARD_STRIP_PREFIX,
    prependPrefix: process.env.FORWARD_PREPEND_PREFIX,
    headers: {},
    recordDir: process.env.FORWARD_RECORD_DIR,
    recordMode: process.env.FORWARD_RECORD_MODE,
    recordLimit: process.env.FORWARD_RECORD_LIMIT ? Number(process.env.FORWARD_RECORD_LIMIT) : null,
    recordTag: process.env.FORWARD_RECORD_TAG,
    recordGzip: process.env.FORWARD_RECORD_GZIP === '1',
    redactHeaders: new Set(DEFAULT_REDACT_HEADERS),
    redactBodyKeys: new Set()
  }

  const envRedactHeaders = (process.env.FORWARD_REDACT_HEADERS ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  for (const header of envRedactHeaders) {
    options.redactHeaders.add(header)
  }
  const envRedactBodyKeys = (process.env.FORWARD_REDACT_BODY_KEYS ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  for (const key of envRedactBodyKeys) {
    options.redactBodyKeys.add(key)
  }

  for (let i = 0; i < args.length; i += 1) {
    const key = args[i]
    switch (key) {
      case '--port':
        options.port = Number(args[++i])
        break
      case '--host':
        options.host = args[++i] ?? options.host
        break
      case '--target':
        options.target = args[++i] ?? options.target
        break
      case '--verbose':
        options.verbose = true
        break
      case '--dump-body':
        options.dumpBody = true
        break
      case '--strip-prefix':
        options.stripPrefix = args[++i] ?? options.stripPrefix
        break
      case '--prepend-prefix':
        options.prependPrefix = args[++i] ?? options.prependPrefix
        break
      case '--set-header': {
        const header = args[++i]
        if (header) {
          const separatorIndex = header.indexOf(':')
          if (separatorIndex === -1) {
            console.warn(`[forward-proxy] Invalid header format: ${header} (expected key:value)`)
          } else {
            const keyPart = header.slice(0, separatorIndex).trim().toLowerCase()
            const valuePart = header.slice(separatorIndex + 1).trim()
            if (keyPart) options.headers[keyPart] = valuePart
          }
        }
        break
      }
      case '--record-dir':
        options.recordDir = args[++i] ?? options.recordDir
        break
      case '--record-mode': {
        const mode = (args[++i] ?? '').toLowerCase()
        if (VALID_RECORD_MODES.has(mode)) {
          options.recordMode = mode
        } else if (mode) {
          console.warn(`[forward-proxy] Unknown record mode: ${mode}, expected headers|full|traces`)
        }
        break
      }
      case '--record-limit': {
        const raw = args[++i]
        const parsed = raw ? Number(raw) : NaN
        if (Number.isFinite(parsed) && parsed > 0) {
          options.recordLimit = parsed
        } else if (raw) {
          console.warn(`[forward-proxy] Invalid record limit: ${raw}`)
        }
        break
      }
      case '--record-tag':
        options.recordTag = args[++i] ?? options.recordTag
        break
      case '--record-gzip':
        options.recordGzip = true
        break
      case '--redact-header': {
        const header = args[++i]
        if (header) {
          options.redactHeaders.add(header.trim().toLowerCase())
        }
        break
      }
      case '--redact-body-key': {
        const key = args[++i]
        if (key) {
          options.redactBodyKeys.add(key.trim().toLowerCase())
        }
        break
      }
      default:
        console.warn(`[forward-proxy] Unknown argument: ${key}`)
        break
    }
  }

  if (!options.target) {
    console.error('[forward-proxy] Missing --target or FORWARD_TARGET')
    process.exit(1)
  }

  options.stripPrefix = normalizePath(options.stripPrefix)
  options.prependPrefix = normalizePath(options.prependPrefix)
  options.recordMode = options.recordMode
    ? options.recordMode.toLowerCase()
    : DEFAULT_RECORD_MODE
  if (!VALID_RECORD_MODES.has(options.recordMode)) {
    console.warn(`[forward-proxy] Unsupported record mode ${options.recordMode}, falling back to ${DEFAULT_RECORD_MODE}`)
    options.recordMode = DEFAULT_RECORD_MODE
  }

  return options
}

function buildTargetUrl(options, rawPath) {
  const baseUrl = new URL(options.target)
  const incomingUrl = new URL(rawPath ?? '/', 'http://local-proxy.example')

  let pathname = incomingUrl.pathname

  if (options.stripPrefix) {
    if (pathname === options.stripPrefix) {
      pathname = '/'
    } else if (pathname.startsWith(`${options.stripPrefix}/`)) {
      pathname = pathname.slice(options.stripPrefix.length)
      if (!pathname.startsWith('/')) pathname = `/${pathname}`
    }
  }

  if (options.prependPrefix) {
    pathname = `${options.prependPrefix}${pathname.startsWith('/') ? pathname : `/${pathname}`}`
  }

  const basePath = baseUrl.pathname.endsWith('/')
    ? baseUrl.pathname.slice(0, -1)
    : baseUrl.pathname

  const normalizedIncoming = pathname.startsWith('/') ? pathname : `/${pathname}`
  let combinedPath = `${basePath}${normalizedIncoming}`
  combinedPath = combinedPath.replace(/\/{2,}/g, '/')
  if (!combinedPath.startsWith('/')) combinedPath = `/${combinedPath}`

  baseUrl.pathname = combinedPath
  baseUrl.search = incomingUrl.search

  return baseUrl.toString()
}

function collectBody(stream) {
  return new Promise((resolve, reject) => {
    const chunks = []
    stream.on('data', (chunk) => chunks.push(chunk))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

function logChunk(prefix, chunk, options) {
  if (!options.verbose && !options.dumpBody) return
  const decoder = new TextDecoder()
  const text = decoder.decode(chunk)
  if (options.dumpBody) {
    console.log(prefix)
    console.log(text)
  } else {
    const truncated = text.length > 500 ? `${text.slice(0, 500)}…` : text
    console.log(prefix, truncated)
  }
}

const MAX_INLINE_TEXT_LENGTH = 8192

function sanitizeHeadersForRecording(source, redactSet) {
  const result = {}
  if (!source) return result
  const entries = Array.isArray(source)
    ? source
    : source instanceof Map
      ? Array.from(source.entries())
      : typeof source.raw === 'function'
        ? Object.entries(source.raw())
        : Object.entries(source)

  for (const [key, value] of entries) {
    if (!key) continue
    const lower = key.toLowerCase()
    const redact = redactSet.has(lower)
    const normalizeValue = (input) => {
      if (input == null) return undefined
      if (Array.isArray(input)) {
        return input.map((item) => (item == null ? '' : String(item))).join(', ')
      }
      return String(input)
    }

    const normalized = normalizeValue(value)
    if (normalized === undefined) continue
    result[lower] = redact ? '<redacted>' : normalized
  }
  return result
}

function redactJsonValue(value, redactKeys) {
  if (!redactKeys || redactKeys.size === 0) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactJsonValue(item, redactKeys))
  }

  if (value && typeof value === 'object') {
    const clone = Array.isArray(value) ? [] : {}
    for (const [key, val] of Object.entries(value)) {
      if (redactKeys.has(key.toLowerCase())) {
        clone[key] = '<redacted>'
      } else {
        clone[key] = redactJsonValue(val, redactKeys)
      }
    }
    return clone
  }

  return value
}

function serializeBodyForRecord(buffer, { redactBodyKeys, contentType } = {}) {
  if (!buffer || buffer.length === 0) {
    return null
  }

  const text = buffer.toString('utf8')
  const trimmed = text.trim()
  const looksJson =
    (contentType && /\bjson\b/i.test(contentType)) ||
    trimmed.startsWith('{') ||
    trimmed.startsWith('[')

  if (looksJson) {
    try {
      const parsed = JSON.parse(trimmed)
      const redacted = redactJsonValue(parsed, redactBodyKeys)
      return { type: 'json', value: redacted }
    } catch {
      // fall through to text/base64 handling
    }
  }

  if (buffer.length <= MAX_INLINE_TEXT_LENGTH) {
    return { type: 'text', value: text }
  }

  return { type: 'base64', value: buffer.toString('base64') }
}

class RecorderSession {
  constructor(recorder, meta) {
    this.recorder = recorder
    this.mode = recorder.mode
    this.id = meta.requestId
    this.startedAt = Date.now()
    this.targetBase = meta.targetBase
    this.responseChunks = []
    this.isSse = false
    this.sseBuffer = ''
    this.sseEvents = []
    this.currentSseEvent = { data: [] }
    this.requestBodySize = meta.requestBodySize
    this.contentType = null
    this.completed = false

    const sanitizedInbound = sanitizeHeadersForRecording(meta.inboundHeaders, recorder.redactHeaders)
    const sanitizedForward = sanitizeHeadersForRecording(meta.forwardHeaders, recorder.redactHeaders)
    const sanitizedInjected = sanitizeHeadersForRecording(meta.injectedHeaders, recorder.redactHeaders)

    const requestPayload =
      this.mode === 'headers'
        ? null
        : serializeBodyForRecord(meta.bodyBuffer, {
            redactBodyKeys: recorder.redactBodyKeys,
            contentType: meta.inboundHeaders?.['content-type']
          })

    this.entry = {
      id: this.id,
      timestamp: new Date().toISOString(),
      mode: this.mode,
      tag: recorder.tag ?? undefined,
      targetBase: this.targetBase,
      request: {
        method: meta.method ?? 'GET',
        originalUrl: meta.originalUrl,
        targetUrl: meta.targetUrl,
        headers: sanitizedInbound,
        forwardedHeaders: sanitizedForward,
        injectedHeaders: Object.keys(sanitizedInjected).length > 0 ? sanitizedInjected : undefined,
        body: requestPayload,
        bodySize: this.requestBodySize
      },
      response: null,
      error: null,
      durationMs: null
    }
  }

  markResponseStart(status, headers, contentType) {
    if (!this.entry.response) {
      const sanitized = sanitizeHeadersForRecording(headers, this.recorder.redactHeaders)
      this.contentType =
        typeof contentType === 'string' && contentType.length > 0 ? contentType : sanitized['content-type']
      this.isSse = this.contentType ? /\btext\/event-stream\b/i.test(this.contentType) : false
      this.entry.response = {
        status,
        headers: sanitized
      }
      if (this.mode === 'headers') {
        this.entry.response.body = null
      }
    }
  }

  handleChunk(chunk, context = {}) {
    const isSse = context.isSse ?? this.isSse
    if (this.mode === 'headers') {
      return
    }
    if (chunk && chunk.length) {
      this.responseChunks.push(Buffer.from(chunk))
      if (isSse && this.mode === 'traces') {
        this.consumeSseChunk(chunk)
      }
    }
  }

  consumeSseChunk(chunk) {
    const text = chunk.toString('utf8')
    this.sseBuffer += text

    let newlineIndex = this.sseBuffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = this.sseBuffer.slice(0, newlineIndex + 1)
      this.sseBuffer = this.sseBuffer.slice(newlineIndex + 1)
      this.processSseLine(line)
      newlineIndex = this.sseBuffer.indexOf('\n')
    }
  }

  processSseLine(line) {
    const trimmed = line.replace(/\r?\n$/, '')
    if (trimmed === '') {
      this.flushSseEvent()
      return
    }

    if (trimmed.startsWith(':')) {
      return
    }

    const separator = trimmed.indexOf(':')
    const field = separator === -1 ? trimmed : trimmed.slice(0, separator)
    let value = separator === -1 ? '' : trimmed.slice(separator + 1)
    if (value.startsWith(' ')) {
      value = value.slice(1)
    }

    switch (field) {
      case 'event':
        this.currentSseEvent.event = value || 'message'
        break
      case 'data':
        if (!this.currentSseEvent.data) {
          this.currentSseEvent.data = []
        }
        this.currentSseEvent.data.push(value)
        break
      case 'id':
        if (value !== undefined) {
          this.currentSseEvent.id = value
        }
        break
      case 'retry': {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) {
          this.currentSseEvent.retry = parsed
        }
        break
      }
      default: {
        if (!this.currentSseEvent.extensions) {
          this.currentSseEvent.extensions = {}
        }
        this.currentSseEvent.extensions[field] = value
        break
      }
    }
  }

  flushSseEvent() {
    if (!this.currentSseEvent) {
      this.currentSseEvent = { data: [] }
      return
    }
    const hasData =
      (this.currentSseEvent.data && this.currentSseEvent.data.length > 0) ||
      this.currentSseEvent.event ||
      this.currentSseEvent.id
    if (hasData) {
      const payload = {
        event: this.currentSseEvent.event ?? 'message',
        data: this.currentSseEvent.data ? this.currentSseEvent.data.join('\n') : '',
        id: this.currentSseEvent.id,
        retry: this.currentSseEvent.retry,
        extensions: this.currentSseEvent.extensions
      }
      if (payload.extensions && Object.keys(payload.extensions).length === 0) {
        delete payload.extensions
      }
      if (payload.id == null) delete payload.id
      if (payload.retry == null) delete payload.retry
      this.sseEvents.push(payload)
    }
    this.currentSseEvent = { data: [] }
  }

  async finalize({ error } = {}) {
    if (this.completed) {
      return
    }
    this.completed = true
    if (error) {
      this.entry.error = String(error)
    }
    this.entry.durationMs = Date.now() - this.startedAt
    if (this.mode !== 'headers' && this.responseChunks.length > 0 && this.entry.response) {
      const buffer = Buffer.concat(this.responseChunks)
      const serialized = serializeBodyForRecord(buffer, {
        redactBodyKeys: this.recorder.redactBodyKeys,
        contentType: this.contentType
      })
      this.entry.response.body = serialized
    }
    if (this.mode === 'traces' && this.entry.response) {
      this.flushSseEvent()
      if (this.sseEvents.length > 0) {
        this.entry.response.sse = this.sseEvents
      }
    }
    await this.recorder.persistEntry(this.entry).catch((persistError) => {
      console.error('[forward-proxy] Failed to persist recorded entry:', persistError)
    })
  }
}

class ForwardRecorder {
  constructor({
    dir,
    mode,
    limit,
    tag,
    gzip,
    redactHeaders,
    redactBodyKeys,
    targetBase
  }) {
    this.dir = dir
    this.mode = mode ?? DEFAULT_RECORD_MODE
    this.limit = limit && Number.isFinite(limit) && limit > 0 ? limit : null
    this.tag = tag
    this.gzip = Boolean(gzip)
    this.redactHeaders = new Set(redactHeaders ?? [])
    this.redactBodyKeys = new Set(redactBodyKeys ?? [])
    this.targetBase = targetBase
    this.entries = []
  }

  async init() {
    await fs.mkdir(this.dir, { recursive: true })
    const files = await fs.readdir(this.dir)
    const entryFiles = files.filter((file) => file.startsWith('entry-'))
    entryFiles.sort()
    this.entries = entryFiles
  }

  startSession(meta) {
    return new RecorderSession(this, meta)
  }

  buildFileName(entry) {
    const safeTimestamp = entry.timestamp.replace(/[:]/g, '-')
    const sanitizedId = entry.id.replace(/[^a-zA-Z0-9_-]/g, '')
    const baseName = `entry-${safeTimestamp}-${sanitizedId || 'unknown'}`
    return `${baseName}.json${this.gzip ? '.gz' : ''}`
  }

  async persistEntry(entry) {
    const fileName = this.buildFileName(entry)
    const filePath = path.join(this.dir, fileName)
    const payloadString = JSON.stringify(entry, null, 2)
    let buffer = Buffer.from(payloadString, 'utf8')
    if (this.gzip) {
      buffer = zlib.gzipSync(buffer)
    }
    await fs.writeFile(filePath, buffer)
    this.entries.push(fileName)
    await this.enforceLimit()
    await this.appendIndex(entry, fileName).catch((error) => {
      console.warn('[forward-proxy] Failed to append index entry:', error)
    })
  }

  async enforceLimit() {
    if (!this.limit || this.entries.length <= this.limit) {
      return
    }
    while (this.entries.length > this.limit) {
      const oldest = this.entries.shift()
      if (!oldest) break
      const filePath = path.join(this.dir, oldest)
      await fs.rm(filePath, { force: true }).catch(() => {})
    }
  }

  async appendIndex(entry, fileName) {
    const summary = {
      id: entry.id,
      timestamp: entry.timestamp,
      method: entry.request?.method,
      path: entry.request?.originalUrl,
      status: entry.response?.status ?? null,
      durationMs: entry.durationMs,
      file: fileName,
      mode: entry.mode,
      tag: entry.tag
    }
    const indexPath = path.join(this.dir, 'index.jsonl')
    await fs.appendFile(indexPath, `${JSON.stringify(summary)}\n`, 'utf8')
  }
}

async function forwardRequest(options) {
  let recorder = null
  if (options.recordDir) {
    recorder = new ForwardRecorder({
      dir: options.recordDir,
      mode: options.recordMode,
      limit: options.recordLimit,
      tag: options.recordTag,
      gzip: options.recordGzip,
      redactHeaders: options.redactHeaders,
      redactBodyKeys: options.redactBodyKeys,
      targetBase: options.target
    })
    try {
      await recorder.init()
    } catch (error) {
      console.error('[forward-proxy] Failed to initialise recorder:', error)
      process.exit(1)
    }
  }

  const server = http.createServer(async (req, res) => {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const targetUrl = buildTargetUrl(options, req.url ?? '/')

    let recorderSession = null

    try {
      const bodyBuffer = await collectBody(req)

      if (options.verbose) {
        console.log(`[forward-proxy] ${requestId} ${req.method} ${req.url}`)
        if (bodyBuffer.length > 0) {
          logChunk(`[forward-proxy] ${requestId} request body:`, bodyBuffer, options)
        }
      }

      const outgoingHeaders = { ...req.headers }
      for (const [key, value] of Object.entries(options.headers)) {
        outgoingHeaders[key] = value
      }

      delete outgoingHeaders.host
      delete outgoingHeaders.connection
      delete outgoingHeaders['content-length']
      delete outgoingHeaders['transfer-encoding']

      const forwardHeaders = {
        ...outgoingHeaders,
        'content-length': String(bodyBuffer.length)
      }

      const fetchInit = {
        method: req.method,
        headers: forwardHeaders,
        body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : bodyBuffer
      }

      if (recorder) {
        recorderSession = recorder.startSession({
          requestId,
          method: req.method ?? 'GET',
          originalUrl: req.url ?? '/',
          targetUrl,
          targetBase: options.target,
          inboundHeaders: req.headers,
          forwardHeaders,
          injectedHeaders: options.headers,
          bodyBuffer,
          requestBodySize: bodyBuffer.length
        })
      }

      const upstreamResponse = await fetch(targetUrl, fetchInit)

      if (options.verbose) {
        console.log(`[forward-proxy] ${requestId} upstream status: ${upstreamResponse.status}`)
      }

      const responseHeaders = Object.fromEntries(upstreamResponse.headers.entries())
      recorderSession?.markResponseStart(
        upstreamResponse.status,
        upstreamResponse.headers,
        upstreamResponse.headers.get('content-type')
      )

      res.writeHead(upstreamResponse.status, responseHeaders)

      if (!upstreamResponse.body) {
        await recorderSession?.finalize()
        res.end()
        return
      }

      const reader = Readable.fromWeb(upstreamResponse.body)
      const isSse = recorderSession?.isSse ?? /\btext\/event-stream\b/i.test(
        upstreamResponse.headers.get('content-type') ?? ''
      )

      reader.on('data', (chunk) => {
        logChunk(`[forward-proxy] ${requestId} upstream chunk:`, chunk, options)
        res.write(chunk)
        recorderSession?.handleChunk(chunk, { isSse })
      })

      reader.on('end', () => {
        res.end()
        recorderSession?.finalize().catch((error) => {
          console.error('[forward-proxy] Failed to finalise recorded entry:', error)
        })
      })
      reader.on('error', (error) => {
        console.error(`[forward-proxy] ${requestId} upstream stream error:`, error)
        res.destroy(error)
        recorderSession?.finalize({ error }).catch((persistError) => {
          console.error('[forward-proxy] Failed to finalise recorded entry after error:', persistError)
        })
      })
    } catch (error) {
      console.error(`[forward-proxy] ${requestId} error:`, error)
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: String(error) }))
      if (recorderSession) {
        recorderSession
          .finalize({ error })
          .catch((persistError) => console.error('[forward-proxy] Failed to record error entry:', persistError))
      }
    }
  })

  server.listen(options.port, options.host, () => {
    console.log(`[forward-proxy] Listening on http://${options.host}:${options.port}`)
    console.log(`[forward-proxy] Forwarding to ${options.target}`)
    if (options.stripPrefix) {
      console.log(`[forward-proxy] Stripping prefix: ${options.stripPrefix}`)
    }
    if (options.prependPrefix) {
      console.log(`[forward-proxy] Prepending prefix: ${options.prependPrefix}`)
    }
    if (Object.keys(options.headers).length > 0) {
      console.log('[forward-proxy] Injected headers:', options.headers)
    }
    if (recorder) {
      const details = [
        `mode=${recorder.mode}`,
        recorder.limit ? `limit=${recorder.limit}` : null,
        recorder.gzip ? 'gzip=on' : null,
        recorder.tag ? `tag=${recorder.tag}` : null
      ]
        .filter(Boolean)
        .join(', ')
      console.log(`[forward-proxy] Recording enabled → ${recorder.dir}${details ? ` (${details})` : ''}`)
      if (recorder.redactHeaders.size > 0) {
        console.log('[forward-proxy] Redacting headers:', Array.from(recorder.redactHeaders).join(', '))
      }
      if (recorder.redactBodyKeys.size > 0) {
        console.log('[forward-proxy] Redacting JSON keys:', Array.from(recorder.redactBodyKeys).join(', '))
      }
    }
  })
}

const options = parseArgs()
forwardRequest(options).catch((error) => {
  console.error('[forward-proxy] Failed to start proxy:', error)
  process.exit(1)
})
