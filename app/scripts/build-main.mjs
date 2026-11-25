import { build } from 'esbuild'

const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
// 软件信息里展示的构建日期，随每次构建写入主进程
const BUILD_DATE = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: false,
  define: { __BUILD_DATE__: JSON.stringify(BUILD_DATE) },
  external: ['electron', 'sharp', 'tesseract.js', 'node:sqlite', 'node:fs', 'node:path', 'node:os', 'node:url', 'node:crypto', 'node:child_process'],
  logLevel: 'info'
}

await build({
  ...shared,
  entryPoints: ['src/main/index.ts'],
  outfile: 'dist-electron/main.js'
})

await build({
  ...shared,
  entryPoints: ['src/preload/index.ts'],
  outfile: 'dist-electron/preload.js'
})
