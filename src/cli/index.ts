#!/usr/bin/env node
import { Command } from 'commander'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { green, yellow } from 'colorette'

const program = new Command()

const DEFAULT_PORT = 4100
const HOME_DIR = path.join(os.homedir(), '.cc-gw')
const PID_FILE = path.join(HOME_DIR, 'cc-gw.pid')
const LOG_DIR = path.join(HOME_DIR, 'logs')
const LOG_FILE = path.join(LOG_DIR, 'cc-gw.log')
const CONFIG_FILE = path.join(HOME_DIR, 'config.json')

async function readConfiguredPort(): Promise<number | null> {
  try {
    const raw = await fsp.readFile(CONFIG_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.port === 'number' && Number.isFinite(parsed.port)) {
      return parsed.port
    }
  } catch {}
  return null
}

function resolveServerEntry(): string {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const candidates = [
    path.resolve(__dirname, '../../server/dist/index.js'),
    path.resolve(__dirname, '../server/dist/index.js'),
    path.resolve(__dirname, '../../../src/server/dist/index.js')
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  throw new Error('Server bundle not found. 请先构建 @cc-gw/server (pnpm --filter @cc-gw/server build)')
}

function resolveWebDist(): string | null {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)

  const candidates = [
    path.resolve(__dirname, '../web/dist'),
    path.resolve(__dirname, '../../web/dist'),
    path.resolve(__dirname, '../../../src/web/dist'),
    path.resolve(process.cwd(), 'src/web/dist')
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

async function ensureHomeDir(): Promise<void> {
  await fsp.mkdir(LOG_DIR, { recursive: true })
}

async function ensureConfigTemplate(port?: string): Promise<boolean> {
  try {
    await fsp.access(CONFIG_FILE)
    return false
  } catch {
    const selectedPort = port ? Number.parseInt(port, 10) || DEFAULT_PORT : DEFAULT_PORT
    const baseDefaults = {
      completion: null,
      reasoning: null,
      background: null,
      longContextThreshold: 60000
    }
    const template = {
      host: '127.0.0.1',
      port: selectedPort,
      providers: [],
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
      storePayloads: true,
      logLevel: 'info',
      requestLogging: true,
      responseLogging: true
    }
    await fsp.mkdir(path.dirname(CONFIG_FILE), { recursive: true })
    await fsp.writeFile(CONFIG_FILE, JSON.stringify(template, null, 2), 'utf-8')
    return true
  }
}

async function readPid(): Promise<number | null> {
  try {
    const raw = await fsp.readFile(PID_FILE, 'utf-8')
    const pid = Number.parseInt(raw.trim(), 10)
    return Number.isNaN(pid) ? null : pid
  } catch {
    return null
  }
}

async function writePid(pid: number | undefined): Promise<void> {
  if (pid == null) return
  await fsp.writeFile(PID_FILE, String(pid), 'utf-8')
}

async function removePid(): Promise<void> {
  try {
    await fsp.unlink(PID_FILE)
  } catch {}
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function isServiceRunning(): Promise<{ running: boolean; pid?: number }> {
  const pid = await readPid()
  if (!pid) return { running: false }
  if (isProcessAlive(pid)) {
    return { running: true, pid }
  }
  await removePid()
  return { running: false }
}

async function handleStart(options: { daemon?: boolean; port?: string; foreground?: boolean }): Promise<void> {
  await ensureHomeDir()
  const { running, pid } = await isServiceRunning()
  if (running && pid) {
    console.log(yellow(`cc-gw 已在运行 (pid: ${pid})`))
    return
  }

  const configCreated = await ensureConfigTemplate(options.port)
  const serverEntry = resolveServerEntry()

  const env = { ...process.env }
  if (options.port) {
    env.PORT = options.port
  }

  if (!env.CC_GW_UI_ROOT) {
    const uiRoot = resolveWebDist()
    if (uiRoot) {
      env.CC_GW_UI_ROOT = uiRoot
    }
  }

  const daemonMode = options.foreground ? false : options.daemon !== false

  const spawnOptions: any = {
    env,
    detached: daemonMode,
    stdio: daemonMode
      ? [
          'ignore',
          fs.openSync(LOG_FILE, 'a'),
          fs.openSync(LOG_FILE, 'a')
        ]
      : 'inherit'
  }

  const child = spawn(process.execPath, [serverEntry], spawnOptions)
  child.on('error', (err) => {
    console.error('启动 cc-gw 失败:', err)
  })

  await writePid(child.pid)

  if (daemonMode) {
    child.unref()
    console.log(green(`cc-gw 已以守护进程方式启动 (pid: ${child.pid})`))
  }

  let effectivePort: number
  if (options.port) {
    const parsed = Number.parseInt(options.port, 10)
    effectivePort = Number.isFinite(parsed) ? parsed : DEFAULT_PORT
  } else {
    const configured = await readConfiguredPort()
    effectivePort = configured ?? DEFAULT_PORT
  }

  if (configCreated) {
    console.log(green(`已在 ${CONFIG_FILE} 生成默认配置`))
    console.log(yellow(`首次启动：待服务就绪后，请在浏览器访问 http://127.0.0.1:${effectivePort}/ui 进行配置。`))
  }

  if (daemonMode) {
    console.log(green(`Web UI 已就绪: http://127.0.0.1:${effectivePort}/ui`))
  }

  if (!daemonMode) {
    const forwardSignal = (signal: NodeJS.Signals) => {
      if (!child.killed) {
        try {
          child.kill(signal)
        } catch {}
      }
    }

    process.on('SIGINT', forwardSignal)
    process.on('SIGTERM', forwardSignal)

    await new Promise<void>((resolve) => {
      child.on('exit', () => resolve())
      child.on('close', () => resolve())
    })

    process.off('SIGINT', forwardSignal)
    process.off('SIGTERM', forwardSignal)

    await removePid()

    if (child.exitCode && child.exitCode !== 0) {
      process.exitCode = child.exitCode
    }
  }
}

async function handleStop(): Promise<void> {
  const pid = await readPid()
  if (!pid) {
    console.log(yellow('cc-gw 未在运行。'))
    return
  }
  if (!isProcessAlive(pid)) {
    console.log(yellow('检测到陈旧的 PID 文件，已清理。'))
    await removePid()
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
    console.log(green(`已向进程 ${pid} 发送 SIGTERM`))
  } catch (err) {
    console.error(`停止 cc-gw 失败: ${(err as Error).message}`)
  } finally {
    await removePid()
  }
}

async function handleStatus(): Promise<void> {
  const { running, pid } = await isServiceRunning()
  if (running && pid) {
    console.log(green(`cc-gw 正在运行 (pid: ${pid})`))
  } else {
    console.log(yellow('cc-gw 未在运行。'))
  }
  console.log(`PID 文件: ${PID_FILE}`)
  console.log(`日志目录: ${LOG_DIR}`)
  console.log(`配置文件: ${CONFIG_FILE}`)
}

program
  .name('cc-gw')
  .description('Claude Code Gateway CLI')
  .version('0.1.0')

program
  .command('start')
  .description('启动 cc-gw 服务')
  .option('--daemon', '以守护进程方式运行（默认）')
  .option('--foreground', '以前台模式运行并保持控制台输出')
  .option('--port <port>', '指定服务监听端口')
  .action(async (options) => {
    try {
      await handleStart(options)
    } catch (err) {
      console.error((err as Error).message)
      process.exitCode = 1
    }
  })

program
  .command('stop')
  .description('停止 cc-gw 服务')
  .action(async () => {
    await handleStop()
  })

program
  .command('restart')
  .description('重启 cc-gw 服务')
  .option('--daemon', '以守护进程方式运行')
  .option('--port <port>', '指定服务监听端口')
  .action(async (options) => {
    await handleStop()
    await handleStart(options)
  })

program
  .command('status')
  .description('查看 cc-gw 运行状态')
  .action(async () => {
    await handleStatus()
  })

program.parseAsync(process.argv)
