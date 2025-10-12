import { test, expect, request as playwrightRequest } from '@playwright/test'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

async function findFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = http.createServer()
    server.listen(0, () => {
      const address = server.address()
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        if (typeof address === 'object' && address) {
          resolve(address.port)
        } else {
          reject(new Error('Unable to determine port'))
        }
      })
    })
  })
}

interface TestContext {
  tempHome: string
  gatewayPort: number
  stubPort: number
  gatewayProcess: ChildProcessWithoutNullStreams | null
  stubServer: http.Server | null
}

const ctx: TestContext = {
  tempHome: '',
  gatewayPort: 0,
  stubPort: 0,
  gatewayProcess: null,
  stubServer: null
}

async function startStubProvider(port: number): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end()
      return
    }

    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      let body: any = {}
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        body = {}
      }

      const responsePayload = {
        id: 'chatcmpl-stub',
        choices: [
          {
            message: { content: 'Stub response from gateway' },
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4
        }
      }

      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(responsePayload))
    })
  })

  await new Promise<void>((resolve) => {
    server.listen(port, resolve)
  })
  return server
}

async function waitForServer(port: number): Promise<void> {
  const url = `http://127.0.0.1:${port}/health`
  for (let attempt = 0; attempt < 320; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {
      // retry
    }
    await delay(250)
  }
  throw new Error('Gateway did not become ready in time')
}

function writeConfig(tempHome: string, gatewayPort: number, stubPort: number): void {
  const configDir = path.join(tempHome, '.cc-gw')
  fs.mkdirSync(configDir, { recursive: true })
  const configPath = path.join(configDir, 'config.json')
  const baseDefaults = {
    completion: 'stub:stub-model',
    reasoning: null,
    background: null,
    longContextThreshold: 60000
  }

  const config = {
    host: '127.0.0.1',
    port: gatewayPort,
    providers: [
      {
        id: 'stub',
        label: 'Stub Provider',
        type: 'openai',
        baseUrl: `http://127.0.0.1:${stubPort}`,
        apiKey: 'stub-key',
        defaultModel: 'stub-model',
        models: [
          { id: 'stub-model', label: 'Stub Model' }
        ]
      }
    ],
    defaults: { ...baseDefaults },
    endpointRouting: {
      anthropic: {
        defaults: { ...baseDefaults },
        modelRoutes: {}
      },
      openai: {
        defaults: { ...baseDefaults },
        modelRoutes: {}
      }
    },
    logRetentionDays: 30,
    modelRoutes: {},
    storeRequestPayloads: true,
    storeResponsePayloads: true,
    logLevel: 'error',
    requestLogging: false
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
}

async function startGateway(tempHome: string, gatewayPort: number): Promise<ChildProcessWithoutNullStreams> {
  const env = {
    ...process.env,
    HOME: tempHome,
    CC_GW_HOME: path.join(tempHome, '.cc-gw'),
    PORT: String(gatewayPort),
    NODE_ENV: 'test'
  }

  const child = spawn('pnpm', ['--filter', '@cc-gw/server', 'exec', 'tsx', 'index.ts'], {
    cwd: path.join(process.cwd(), 'src/server'),
    env,
    stdio: 'pipe'
  })

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[gateway] ${chunk}`)
  })
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[gateway-err] ${chunk}`)
  })

  child.on('exit', (code, signal) => {
    process.stdout.write(`[gateway-exit] code=${code} signal=${signal ?? 'null'}\n`)
  })

  child.on('error', (error) => {
    process.stderr.write(`[gateway-error] ${error?.message ?? error}\n`)
  })

  return child
}

test.beforeAll(async () => {
  ctx.stubPort = await findFreePort()
  ctx.gatewayPort = await findFreePort()
  ctx.tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-gw-e2e-'))
  ctx.stubServer = await startStubProvider(ctx.stubPort)
  writeConfig(ctx.tempHome, ctx.gatewayPort, ctx.stubPort)
  ctx.gatewayProcess = await startGateway(ctx.tempHome, ctx.gatewayPort)
  await waitForServer(ctx.gatewayPort)
})

test.afterAll(async () => {
  if (ctx.gatewayProcess) {
    ctx.gatewayProcess.kill('SIGTERM')
    await delay(200)
    if (!ctx.gatewayProcess.killed) {
      ctx.gatewayProcess.kill('SIGKILL')
    }
  }
  if (ctx.stubServer) {
    await new Promise<void>((resolve) => ctx.stubServer!.close(() => resolve()))
  }
  if (ctx.tempHome && fs.existsSync(ctx.tempHome)) {
    fs.rmSync(ctx.tempHome, { recursive: true, force: true })
  }
})

const messagePayload = {
  model: 'stub-model',
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Hello from Playwright'
        }
      ]
    }
  ]
}

async function disableWildcard(baseURL: string) {
  const context = await playwrightRequest.newContext({ baseURL })
  const list = await context.get('/api/keys')
  const keys: any[] = await list.json()
  const wildcard = keys.find((item) => item.isWildcard)
  if (wildcard) {
    await context.patch(`/api/keys/${wildcard.id}`, {
      data: { enabled: false }
    })
  }
  await context.dispose()
}

async function pollForLogs(baseURL: string, keyId: number): Promise<any> {
  const context = await playwrightRequest.newContext({ baseURL })
  try {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await context.get('/api/logs', { params: { limit: 5 } })
      const body = await response.json() as { items: any[] }
      if (body.items?.length) {
        const match = body.items.find((item) => item.api_key_id === keyId)
        if (match) {
          return match
        }
      }
      await delay(250)
    }
  } finally {
    await context.dispose()
  }
  throw new Error('Log entry not found in time')
}

test('API key lifecycle and request logging', async ({ request }) => {
  const baseURL = `http://127.0.0.1:${ctx.gatewayPort}`
  await disableWildcard(baseURL)

  const missing = await request.post(`${baseURL}/v1/messages`, {
    data: messagePayload,
    headers: { 'content-type': 'application/json' }
  })
  expect(missing.status(), 'missing API key should be rejected').toBe(401)
  const missingBody = await missing.json()
  expect(missingBody.error.code).toBe('invalid_api_key')

  const createRes = await request.post(`${baseURL}/api/keys`, {
    data: { name: 'Playwright Test Key' }
  })
  expect(createRes.status()).toBe(200)
  const created: { id: number; key: string } = await createRes.json()
  const apiKeyId = created.id
  const apiKeyValue = created.key

  const invalid = await request.post(`${baseURL}/v1/messages`, {
    data: messagePayload,
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'invalid-key'
    }
  })
  expect(invalid.status(), 'invalid API key should return 401').toBe(401)

  const valid = await request.post(`${baseURL}/v1/messages`, {
    data: messagePayload,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKeyValue
    }
  })
  expect(valid.status()).toBe(200)
  const responseJson = await valid.json()
  expect(Array.isArray(responseJson.content)).toBeTruthy()

  const logEntry = await pollForLogs(baseURL, apiKeyId)
  expect(logEntry.api_key_name).toBe('Playwright Test Key')

  const detail = await request.get(`${baseURL}/api/logs/${logEntry.id}`)
  expect(detail.status()).toBe(200)
  const detailJson = await detail.json()
  expect(detailJson.api_key_value).toBe(apiKeyValue)

  const filtered = await request.get(`${baseURL}/api/logs`, {
    params: { apiKeys: String(apiKeyId) }
  })
  expect(filtered.status()).toBe(200)
  const filteredJson = await filtered.json()
  expect(filteredJson.items.length).toBeGreaterThan(0)

  const overview = await request.get(`${baseURL}/api/stats/api-keys/overview`)
  expect(overview.status()).toBe(200)
  const overviewJson = await overview.json()
  expect(overviewJson.totalKeys).toBeGreaterThan(0)
  expect(overviewJson.enabledKeys).toBeGreaterThan(0)
  expect(overviewJson.activeKeys).toBeGreaterThan(0)

  const usage = await request.get(`${baseURL}/api/stats/api-keys/usage`, {
    params: { days: '7', limit: '10' }
  })
  expect(usage.status()).toBe(200)
  const usageJson = await usage.json()
  expect(Array.isArray(usageJson)).toBeTruthy()
  expect(usageJson.some((item: any) => item.apiKeyId === apiKeyId)).toBeTruthy()

  const keysAfter = await request.get(`${baseURL}/api/keys`)
  const keysList: any[] = await keysAfter.json()
  const summary = keysList.find((item) => item.id === apiKeyId)
  expect(summary.requestCount).toBeGreaterThan(0)
})
