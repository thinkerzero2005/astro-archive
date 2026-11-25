import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cli = path.join(appDir, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')

if (!fs.existsSync(cli)) {
  console.error('未找到 electron-builder，请先执行 npm install')
  process.exit(1)
}

const args = [cli, '--win', 'portable', '--x64', '--publish', 'never', ...process.argv.slice(2)]

const child = spawn(process.execPath, args, {
  cwd: appDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    // 国内镜像，避免下载 electron / builder 二进制超时
    ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
    ELECTRON_BUILDER_BINARIES_MIRROR:
      process.env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/'
  }
})

child.on('exit', (code) => process.exit(code ?? 1))
