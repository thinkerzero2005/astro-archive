import { build } from 'esbuild'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const testsDir = path.join(appDir, 'tests')
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-tests-'))

const CASES = [
  { name: 'library', file: 'library.test.ts' },
  { name: 'sync', file: 'sync.test.ts' },
  { name: 'inbox-import', file: 'inbox-import.test.ts' },
  { name: 'search', file: 'search.test.ts' },
  { name: 'night-record', file: 'night-record.test.ts' },
  { name: 'scanner', file: 'scanner.test.ts' },
  { name: 'fits', file: 'fits.test.ts' },
  { name: 'incremental', file: 'incremental.test.ts' },
  { name: 'appearance', file: 'appearance.test.ts' },
  { name: 'backup', file: 'backup.test.ts' },
  { name: 'watermark', file: 'watermark.test.ts' },
  { name: 'real-copy', file: 'real-copy.test.ts', device: true },
  { name: 'real-mosaic', file: 'real-mosaic.test.ts', device: true }
]

const device = (process.env.ASTRO_REAL_DEVICE || '').trim()
const deviceReady = !!device && fs.existsSync(device)

async function bundle(testCase) {
  const outfile = path.join(outDir, `${testCase.name}.cjs`)
  await build({
    entryPoints: [path.join(testsDir, testCase.file)],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['sharp', 'exifr', 'tesseract.js'],
    alias: { electron: path.join(testsDir, 'electron-stub.js') },
    logLevel: 'silent'
  })
  return outfile
}

function runTest(file, env) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [file], { cwd: appDir, env, maxBuffer: 32 * 1024 * 1024 })
    const timer = setTimeout(() => {
      console.error('超时 180s，已终止')
      child.kill()
    }, 180000)
    child.stdout?.on('data', (chunk) => process.stdout.write(chunk))
    child.stderr?.on('data', (chunk) => process.stderr.write(chunk))
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve(code ?? 1)
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      console.error(err.message)
      resolve(1)
    })
  })
}

const result = { passed: 0, failed: 0, skipped: 0 }

for (const testCase of CASES) {
  console.log(`\n=== ${testCase.name} ===`)
  if (testCase.device && !deviceReady) {
    console.log(`skip - 未检测到真机目录（设置 ASTRO_REAL_DEVICE，例如 F:\\）`)
    result.skipped++
    continue
  }
  try {
    const outfile = await bundle(testCase)
    const code = await runTest(outfile, {
      ...process.env,
      NODE_PATH: path.join(appDir, 'node_modules'),
      TESTBASE: path.join(outDir, testCase.name)
    })
    if (code === 0) result.passed++
    else result.failed++
  } catch (err) {
    console.error(err)
    result.failed++
  }
}

fs.rmSync(outDir, { recursive: true, force: true })

console.log(`\n通过 ${result.passed} / 失败 ${result.failed} / 跳过 ${result.skipped}`)
process.exit(result.failed > 0 ? 1 : 0)
