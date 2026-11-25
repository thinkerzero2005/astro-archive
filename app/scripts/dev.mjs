import { spawn } from 'node:child_process'
import electronPath from 'electron'
import http from 'node:http'

const isWin = process.platform === 'win32'

function run(command, args, opts = {}) {
  return spawn(command, args, { stdio: 'inherit', shell: isWin, ...opts })
}

function waitForServer(url, timeoutMs = 30000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume()
        resolve()
      })
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) reject(new Error('Vite 启动超时'))
        else setTimeout(tick, 300)
      })
    }
    tick()
  })
}

console.log('› 编译主进程…')
const build = run(process.execPath, ['scripts/build-main.mjs'])
await new Promise((resolve, reject) => {
  build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`主进程编译失败：${code}`))))
})

console.log('› 启动 Vite…')
const vite = run(process.execPath, ['node_modules/vite/bin/vite.js'], { env: process.env })

await waitForServer('http://localhost:5173')

console.log('› 启动 Electron…')
const electron = run(String(electronPath), ['.'], {
  env: { ...process.env, VITE_DEV_SERVER_URL: 'http://localhost:5173' }
})

const shutdown = () => {
  try {
    vite.kill()
  } catch {
    /* ignore */
  }
}

electron.on('exit', (code) => {
  shutdown()
  process.exit(code ?? 0)
})

process.on('SIGINT', () => {
  electron.kill()
  shutdown()
  process.exit(0)
})
