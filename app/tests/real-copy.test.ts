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
const SESSION = 'DWARF_RAW_TELE_M 45_EXP_60_GAIN_60_2026-02-19-19-49-11-901'

function ok(cond: unknown, message: string) {
  if (!cond) {
    console.error('FAIL: ' + message)
    process.exit(1)
  }
  console.log('ok - ' + message)
}

async function main() {
  fs.rmSync(base, { recursive: true, force: true })
  fs.mkdirSync(lib, { recursive: true })
  const db = openDatabase(dataDir)
  setSetting(db, 'library_root', lib)

  const preview = previewSync(db, lib, SOURCE)
  ok(preview.ok, `实机预览成功（${preview.error ?? ''}）`)
  ok(preview.astronomyPath === path.join(path.resolve(SOURCE), 'Astronomy'), `定位到 ${preview.astronomyPath}`)
  ok((preview.sessions ?? []).length > 25, `识别 ${(preview.sessions ?? []).length} 个会话`)

  const session = (preview.sessions ?? []).find((s) => s.sessionName === SESSION)
  ok(!!session, '找到目标测试会话')
  ok(session?.status === 'new', `会话状态为新增（${session?.status}）`)
  ok(session?.targetCatalog === 'M45', `目标归一为 M45（实际 ${session?.targetCatalog}）`)
  ok(session?.frameCount === 59, `光帧 59 张（实际 ${session?.frameCount}）`)
  ok(session?.fileCount === 61, `文件 61 个（实际 ${session?.fileCount}）`)

  const bias = (preview.calibrations ?? []).find((c) => c.key === 'bias')
  ok(bias?.fileCount === 22, `bias 文件 22 个（实际 ${bias?.fileCount}）`)

  const started = Date.now()
  const result = await runSync(
    db,
    lib,
    SOURCE,
    { sessions: [SESSION], calibrations: ['bias'], makeDeleteList: true },
    (p) => {
      if (p.phase === 'copy' && p.done % 20 === 0) console.log(`  progress ${p.done}/${p.total}`)
    }
  )
  ok(result.ok, `实机同步成功（errors: ${result.errors.join(' / ')}）`)
  ok(result.copied === 83, `拷贝 83 个文件（61 会话 + 22 bias，实际 ${result.copied}）`)
  console.log(`  elapsed ${((Date.now() - started) / 1000).toFixed(1)}s, ${(result.bytes / 1024 ** 2).toFixed(1)}MB`)

  const destDir = path.join(lib, '01_深空/M45_昴星团/原始', SESSION)
  ok(fs.existsSync(path.join(destDir, 'stacked.jpg')), 'stacked.jpg 已归档')
  ok(fs.existsSync(path.join(destDir, 'shotsInfo.json')), 'shotsInfo.json 已归档')
  const fits = fs.readdirSync(destDir).filter((f) => f.toLowerCase().endsWith('.fits'))
  ok(fits.length === 59, `原始目录 59 个 FITS（实际 ${fits.length}）`)
  ok(!fits.some((f) => f.toLowerCase().startsWith('stacked')), '堆栈产物 FITS 未被当作光帧')

  const biasDest = path.join(lib, '_dwarf mini校准场/bias')
  ok(fs.existsSync(path.join(biasDest, 'cam_0')), 'bias 保留 cam_0 子目录')
  ok(fs.existsSync(path.join(biasDest, 'cam_1')), 'bias 保留 cam_1 子目录')

  const csv = fs.readFileSync(path.join(lib, '_历史记录/素材库历史记录.csv'), 'utf8')
  ok(csv.split('\r\n').filter(Boolean).length === 84, '历史 CSV 83 行明细')
  ok(!!result.deleteListPath && fs.existsSync(result.deleteListPath), '生成可安全删除清单')

  const after = previewSync(db, lib, SOURCE)
  const re = (after.sessions ?? []).find((s) => s.sessionName === SESSION)
  ok(re?.status === 'synced', `二次预览显示已同步（${re?.status}）`)
  const biasRe = (after.calibrations ?? []).find((c) => c.key === 'bias')
  ok(biasRe?.status === 'synced', `bias 二次预览已同步（${biasRe?.status}）`)

  const undo = undoLastChange(db, lib, path.join(dataDir, 'thumbs'))
  ok(undo.ok && undo.kind === 'sync', `撤销成功（${undo.error ?? ''}）`)
  ok(!fs.existsSync(destDir), '会话目录与副本已删除')
  ok(!fs.existsSync(path.join(biasDest, 'cam_0')), 'bias 子目录已清理')
  const left = Number((db.prepare('SELECT COUNT(*) AS c FROM synced_files').get() as { c: number }).c)
  ok(left === 0, `同步记录已清空（实际 ${left}）`)

  const third = previewSync(db, lib, SOURCE)
  const re2 = (third.sessions ?? []).find((s) => s.sessionName === SESSION)
  ok(re2?.status === 'new', `撤销后恢复为新增（${re2?.status}）`)

  console.log('\nALL PASSED')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
