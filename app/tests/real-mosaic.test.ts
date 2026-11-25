import fs from 'node:fs'
import path from 'node:path'
import { openDatabase, setSetting } from '../src/main/db'
import { previewSync, runSync } from '../src/main/sync'
import { undoLastChange } from '../src/main/files'

const base = process.env.TESTBASE!
const lib = path.join(base, 'library')
const dataDir = path.join(base, 'data')
// 真机路径：需显式设置 ASTRO_REAL_DEVICE 才会运行
const SOURCE = process.env.ASTRO_REAL_DEVICE || ''
const SESSION = 'DWARF_RAW_TELE_MOSAIC_M 45_EXP_60_GAIN_60_2026-10-06-23-12-30-313'

function ok(cond: unknown, message: string) {
  if (!cond) {
    console.error('FAIL: ' + message)
    process.exit(1)
  }
  console.log('ok - ' + message)
}

function countFits(dir: string): number {
  let n = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) n += countFits(abs)
    else if (e.name.toLowerCase().endsWith('.fits')) n++
  }
  return n
}

async function main() {
  fs.rmSync(base, { recursive: true, force: true })
  fs.mkdirSync(lib, { recursive: true })
  const db = openDatabase(dataDir)
  setSetting(db, 'library_root', lib)

  const preview = previewSync(db, lib, SOURCE)
  const session = (preview.sessions ?? []).find((s) => s.sessionName === SESSION)
  ok(!!session, '找到拼图会话')
  ok(session?.status === 'new', `状态为新增（${session?.status}）`)
  ok(session?.targetCatalog === 'M45', `目标归一为 M45（实际 ${session?.targetCatalog}）`)
  ok(session?.frameCount === 317, `光帧 317 张（实际 ${session?.frameCount}）`)
  ok(session?.fileCount === 323, `文件 323 个（实际 ${session?.fileCount}）`)

  const started = Date.now()
  const result = await runSync(db, lib, SOURCE, { sessions: [SESSION], calibrations: [], makeDeleteList: false })
  ok(result.ok, `同步成功（${result.errors.join(' / ')}）`)
  ok(result.copied === 323, `拷贝 323 个文件（实际 ${result.copied}）`)
  console.log(`  elapsed ${((Date.now() - started) / 1000).toFixed(1)}s, ${(result.bytes / 1024 ** 2).toFixed(1)}MB`)

  const sessDir = path.join(lib, '01_深空/M45_昴星团/原始', SESSION)
  ok(fs.existsSync(path.join(sessDir, 'stacked.jpg')), '主会话 stacked.jpg 已归档')
  const panels = fs.readdirSync(sessDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  ok(panels.length === 2, `保留 2 个面板子目录（实际 ${panels.length}）`)
  for (const p of panels) {
    ok(fs.existsSync(path.join(sessDir, p, 'shotsInfo.json')), `${p} 内 shotsInfo.json 已归档`)
  }
  ok(countFits(sessDir) === 317, `递归 FITS 共 317 个（实际 ${countFits(sessDir)}）`)
  ok(!fs.existsSync(path.join(sessDir, 'stacked_thumbnail.jpg')), 'stacked_thumbnail.jpg 未归档')

  const after = previewSync(db, lib, SOURCE)
  ok((after.sessions ?? []).find((s) => s.sessionName === SESSION)?.status === 'synced', '二次预览显示已同步')

  const undo = undoLastChange(db, lib, path.join(dataDir, 'thumbs'))
  ok(undo.ok && undo.kind === 'sync', `撤销成功（${undo.error ?? ''}）`)
  ok(!fs.existsSync(sessDir), '拼图会话副本已删除')

  console.log('\nMOSAIC PASSED')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
