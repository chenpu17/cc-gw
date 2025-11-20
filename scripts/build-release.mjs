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

  // 修改 package.json 以适配 npm 发布
  const pkgPath = path.join(releaseDir, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))

  // 修正 bin 路径
  pkg.bin = {
    'cc-gw': 'cli/index.js'
  }

  // 修正 files 字段
  pkg.files = [
    'cli',
    'server',
    'web',
    'README.md',
    'LICENSE'
  ]

  // 删除不需要的 scripts
  delete pkg.scripts.prepack
  delete pkg.scripts.dev
  delete pkg.scripts['build:server']
  delete pkg.scripts['build:cli']
  delete pkg.scripts['build:web']
  delete pkg.scripts['build:all']
  delete pkg.scripts['release:bundle']
  delete pkg.scripts.lint
  delete pkg.scripts.format
  delete pkg.scripts['format:write']
  delete pkg.scripts.typecheck
  delete pkg.scripts.test
  delete pkg.scripts['test:playwright']

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')

  console.log(`Release bundle created at ${releaseDir}`)
}

main()
