import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const distRoot = path.join(root, 'dist')
const releaseDir = path.join(distRoot, 'release')

const paths = {
  server: path.join(root, 'src/server/dist'),
  cli: path.join(root, 'src/cli/dist'),
  web: path.join(root, 'src/web/dist')
}

function assertExists(label, target) {
  if (!fs.existsSync(target)) {
    throw new Error(`Missing ${label} at ${target}. 请先执行 pnpm build:all。`)
  }
}

function copyDir(source, destination) {
  fs.cpSync(source, destination, { recursive: true })
}

function main() {
  assertExists('server dist', paths.server)
  assertExists('cli dist', paths.cli)
  assertExists('web dist', paths.web)

  fs.rmSync(releaseDir, { recursive: true, force: true })
  fs.mkdirSync(releaseDir, { recursive: true })

  copyDir(paths.server, path.join(releaseDir, 'server'))
  copyDir(paths.cli, path.join(releaseDir, 'cli'))
  copyDir(paths.web, path.join(releaseDir, 'web'))

  const artifacts = [
    'package.json',
    'pnpm-workspace.yaml',
    'README.md',
    'docs/发布指南.md',
    'docs/开发计划.md'
  ]

  for (const item of artifacts) {
    const source = path.join(root, item)
    if (fs.existsSync(source)) {
      const destination = path.join(releaseDir, item)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.copyFileSync(source, destination)
    }
  }

  console.log(`Release bundle created at ${releaseDir}`)
}

main()
