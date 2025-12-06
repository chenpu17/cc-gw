import { test, expect } from '@playwright/test'
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
      const responsePayload = {
        id: 'chatcmpl-stub',
        choices: [
          {
            message: { content: 'Stub response' },
            finish_reason: 'stop'
          }
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
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
    CC_GW_UI_ROOT: path.join(process.cwd(), 'src/web/dist'),
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

  return child
}

test.beforeAll(async () => {
  ctx.stubPort = await findFreePort()
  ctx.gatewayPort = await findFreePort()
  ctx.tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-gw-pages-'))
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

// Single comprehensive test that validates all pages in one run
test('All pages load and render correctly', async ({ page }) => {
  const baseURL = `http://127.0.0.1:${ctx.gatewayPort}`

  // 1. Dashboard page
  await page.goto(baseURL)
  await expect(page.getByRole('heading', { name: '仪表盘', level: 1 })).toBeVisible({ timeout: 10000 })
  await expect(page.getByText('今日请求数')).toBeVisible()
  await expect(page.getByRole('link', { name: '仪表盘' })).toBeVisible()

  // 2. Logs page
  await page.getByRole('link', { name: '请求日志' }).click()
  await expect(page).toHaveURL(/\/logs/)
  await expect(page.getByRole('heading', { name: '请求日志', level: 1 })).toBeVisible({ timeout: 10000 })
  await expect(page.locator('table')).toBeVisible()

  // 3. Models page
  await page.getByRole('link', { name: '模型与路由管理' }).click()
  await expect(page).toHaveURL(/\/models/)
  await expect(page.getByRole('heading', { name: '模型与路由管理', level: 1 })).toBeVisible({ timeout: 10000 })
  await expect(page.getByRole('heading', { name: '模型提供商' })).toBeVisible()

  // 4. Events page
  await page.getByRole('link', { name: '事件' }).click()
  await expect(page).toHaveURL(/\/events/)
  await expect(page.getByRole('heading', { level: 1 }).filter({ hasText: /事件/ })).toBeVisible({ timeout: 10000 })

  // 5. API Keys page
  await page.getByRole('link', { name: 'API 密钥' }).click()
  await expect(page).toHaveURL(/\/api-keys/)
  await expect(page.getByRole('heading', { name: 'API 密钥管理', level: 1 })).toBeVisible({ timeout: 10000 })
  await expect(page.getByText('密钥列表')).toBeVisible()

  // 6. Settings page
  await page.getByRole('link', { name: '设置' }).click()
  await expect(page).toHaveURL(/\/settings/)
  await expect(page.getByRole('heading', { level: 1 }).filter({ hasText: /设置/ })).toBeVisible({ timeout: 10000 })

  // 7. Help page
  await page.getByRole('link', { name: '使用指南' }).click()
  await expect(page).toHaveURL(/\/help/)
  await expect(page.getByRole('heading', { level: 1 }).filter({ hasText: /使用指南/ })).toBeVisible({ timeout: 10000 })

  // 8. About page
  await page.getByRole('link', { name: '关于' }).click()
  await expect(page).toHaveURL(/\/about/)
  await expect(page.getByRole('heading', { level: 1 }).filter({ hasText: /关于/ })).toBeVisible({ timeout: 10000 })

  // Navigate back to Dashboard
  await page.getByRole('link', { name: '仪表盘' }).click()
  await expect(page.getByRole('heading', { name: '仪表盘', level: 1 })).toBeVisible()
})

test('Theme switcher dropdown works', async ({ page }) => {
  const baseURL = `http://127.0.0.1:${ctx.gatewayPort}`
  await page.goto(baseURL)

  await expect(page.getByRole('heading', { name: '仪表盘', level: 1 })).toBeVisible({ timeout: 10000 })

  // Click theme switcher
  const themeSwitcher = page.getByRole('button', { name: '主题' })
  await expect(themeSwitcher).toBeVisible()
  await themeSwitcher.click()

  // Verify dropdown menu appears with options
  await expect(page.getByRole('menuitem').first()).toBeVisible()
})

test('Language switcher dropdown works', async ({ page }) => {
  const baseURL = `http://127.0.0.1:${ctx.gatewayPort}`
  await page.goto(baseURL)

  await expect(page.getByRole('heading', { name: '仪表盘', level: 1 })).toBeVisible({ timeout: 10000 })

  // Click language switcher
  const langSwitcher = page.getByRole('button', { name: '语言选择' })
  await expect(langSwitcher).toBeVisible()
  await langSwitcher.click()

  // Verify dropdown menu appears
  await expect(page.getByRole('menuitem').first()).toBeVisible()
})
