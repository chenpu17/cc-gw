#!/usr/bin/env node
/**
 * Simple forward proxy that logs requests/responses while relaying them to an upstream endpoint.
 *
 * Usage:
 *   node scripts/forward-proxy.mjs [--port 4101] [--target https://api.example.com] [--verbose]
 *                                  [--set-header Authorization:"Bearer ..."] [--dump-body]
 *
 * Environment overrides:
 *   FORWARD_PORT          Listening port (default: 4101)
 *   FORWARD_HOST          Listening host (default: 127.0.0.1)
 *   FORWARD_TARGET        Target base URL (default required)
 *   FORWARD_VERBOSE       If "1", enable verbose logging
 *   FORWARD_DUMP_BODY     If "1", always print full request/response body (warning: may be large)
 */

import http from 'node:http'
import { TextDecoder } from 'node:util'
import { Readable } from 'node:stream'

function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    port: Number(process.env.FORWARD_PORT ?? 4101),
    host: process.env.FORWARD_HOST ?? '127.0.0.1',
    target: process.env.FORWARD_TARGET,
    verbose: process.env.FORWARD_VERBOSE === '1',
    dumpBody: process.env.FORWARD_DUMP_BODY === '1',
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
      case '--set-header': {
        const header = args[++i]
        if (header) {
          const separatorIndex = header.indexOf(':')
          if (separatorIndex === -1) {
            console.warn(`[forward-proxy] Invalid header format: ${header} (expected key:value)`)
          } else {
            const keyPart = header.slice(0, separatorIndex).trim()
            const valuePart = header.slice(separatorIndex + 1).trim()
            if (keyPart) {
              options.headers[keyPart.toLowerCase()] = valuePart
            }
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

  return options
}

function buildTargetUrl(base, rawPath) {
  try {
    return new URL(rawPath, base).toString()
  } catch (error) {
    console.error(`[forward-proxy] Failed to construct target URL for path ${rawPath}:`, error)
    throw error
  }
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function logChunk(prefix, chunk, options) {
  if (!options.verbose && !options.dumpBody) return
  const decoder = new TextDecoder()
  const text = decoder.decode(chunk)
  if (options.dumpBody) {
    console.log(prefix, text)
  } else {
    const truncated = text.length > 500 ? `${text.slice(0, 500)}…` : text
    console.log(prefix, truncated)
  }
}

async function forwardRequest(options) {
  const server = http.createServer(async (req, res) => {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const targetUrl = buildTargetUrl(options.target, req.url ?? '/')

    try {
      const bodyBuffer = await collectBody(req)
      if (options.verbose) {
        console.log(`[forward-proxy] ${requestId} ${req.method} ${req.url}`)
        if (bodyBuffer.length > 0) logChunk(`[forward-proxy] ${requestId} request body:`, bodyBuffer, options)
      }

      const outgoingHeaders = { ...req.headers }
      for (const [key, value] of Object.entries(options.headers)) {
        outgoingHeaders[key] = value
      }
      // Remove hop-by-hop headers that should not be forwarded
      delete outgoingHeaders['content-length']
      delete outgoingHeaders['host']
      delete outgoingHeaders['connection']
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
    console.log(`[forward-proxy] Listening on http://${options.host}:${options.port}, forwarding to ${options.target}`)
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
