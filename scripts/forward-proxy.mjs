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
 *
 * Environment variables mirror the CLI flags (e.g. FORWARD_TARGET, FORWARD_STRIP_PREFIX, etc.).
 */

import http from 'node:http'
import { TextDecoder } from 'node:util'
import { Readable } from 'node:stream'

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
    headers: {}
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

async function forwardRequest(options) {
  const server = http.createServer(async (req, res) => {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const targetUrl = buildTargetUrl(options, req.url ?? '/')

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

      const fetchInit = {
        method: req.method,
        headers: {
          ...outgoingHeaders,
          'content-length': String(bodyBuffer.length)
        },
        body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : bodyBuffer
      }

      const upstreamResponse = await fetch(targetUrl, fetchInit)

      if (options.verbose) {
        console.log(`[forward-proxy] ${requestId} upstream status: ${upstreamResponse.status}`)
      }

      res.writeHead(upstreamResponse.status, Object.fromEntries(upstreamResponse.headers.entries()))

      if (!upstreamResponse.body) {
        res.end()
        return
      }

      const reader = Readable.fromWeb(upstreamResponse.body)

      reader.on('data', (chunk) => {
        logChunk(`[forward-proxy] ${requestId} upstream chunk:`, chunk, options)
        res.write(chunk)
      })

      reader.on('end', () => res.end())
      reader.on('error', (error) => {
        console.error(`[forward-proxy] ${requestId} upstream stream error:`, error)
        res.destroy(error)
      })
    } catch (error) {
      console.error(`[forward-proxy] ${requestId} error:`, error)
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: String(error) }))
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
  })
}

const options = parseArgs()
forwardRequest(options).catch((error) => {
  console.error('[forward-proxy] Failed to start proxy:', error)
  process.exit(1)
})
