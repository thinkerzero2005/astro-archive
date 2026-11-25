import fs from 'node:fs'
import path from 'node:path'
import { openDatabase, setSetting } from '../src/main/db'
import { previewSync, runSync } from '../src/main/sync'
import { undoLastChange } from '../src/main/files'

const base = process.env.TESTBASE!
const src = path.join(base, 'device')
const astro = path.join(src, 'Astronomy')
const lib = path.join(base, 'library')
const dataDir = path.join(base, 'data')

function reset() {
  fs.rmSync(base, { recursive: true, force: true })
  fs.mkdirSync(base, { recursive: true })
}

function touch(rel: string, size = 100) {
  const abs = path.join(astro, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, Buffer.alloc(size, 7))
}

function ok(cond: unknown, message: string) {
  if (!cond) {
    console.error('FAIL: ' + message)
    process.exit(1)
  }
  console.log('ok - ' + message)
}

reset()

// 会话 1：普通单场
touch('IC1805_2026-11-20/shotsInfo.json', 120)
fs.writeFileSync(
  path.join(astro, 'IC1805_2026-11-20/shotsInfo.json'),
  JSON.stringify({ target: 'IC 1805 160', startTime: '2026-11-20T22:15:00', exp: 300 })
)
touch('IC1805_2026-11-20/IC1805_300s_0001.fits', 1000)
touch('IC1805_2026-11-20/IC1805_300s_0002.fits', 1000)
touch('IC1805_2026-11-20/IC1805_300s_0003.fits', 1000)
touch('IC1805_2026-11-20/stacked.jpg', 500)
touch('IC1805_2026-11-20/failed_0004.fits', 100)
touch('IC1805_2026-11-20/IC1805_300s_0001.jpg', 200)
touch('IC1805_2026-11-20/Thumbnail/th.jpg', 50)

// 会话 2：拼图面板 + 已有目标文件夹
touch('M31_2026-11-21/shotsInfo.json', 100)
fs.writeFileSync(path.join(astro, 'M31_2026-11-21/shotsInfo.json'), JSON.stringify({ target: 'M 31', date: '2026-11-21' }))
touch('M31_2026-11-21/(1)/panel1_0001.fits', 800)
touch('M31_2026-11-21/(2)/panel2_0001.fits', 800)
touch('M31_2026-11-21/stacked.jpg', 400)

// 会话 3：没有 stacked.jpg，应跳过
touch('NGC7000_2026-11-22/shotsInfo.json', 80)
fs.writeFileSync(path.join(astro, 'NGC7000_2026-11-22/shotsInfo.json'), JSON.stringify({ target: 'NGC 7000' }))
touch('NGC7000_2026-11-22/NGC7000_300s_0001.fits', 600)

// 校准场与暗场库
touch('CALI_FRAME/bias/cam_0/bias_001.fits', 300)
touch('CALI_FRAME/dark/dark_001.fits', 300)
touch('DWARF_DARK/darklib_001.fits', 400)

// 素材库：已存在的 M31 文件夹
fs.mkdirSync(path.join(lib, '01_深空/M31_仙女座星系/成片'), { recursive: true })
fs.mkdirSync(path.join(lib, '_dwarf mini校准场'), { recursive: true })

const db = openDatabase(dataDir)
setSetting(db, 'library_root', lib)

// ---------- 预览 ----------
const p1 = previewSync(db, lib, src)
ok(p1.ok, '预览成功')
ok(!!p1.astronomyPath && p1.astronomyPath.endsWith('Astronomy'), '定位到 Astronomy')
ok(p1.sessions.length === 3, `识别 3 个会话（实际 ${p1.sessions.length}）`)
const ic = p1.sessions.find((s) => s.sessionName === 'IC1805_2026-11-20')!
ok(ic.status === 'new', 'IC1805 状态为新增')
ok(ic.targetCatalog === 'IC1805', `目标编号归一为 IC1805（实际 ${ic.targetCatalog}）`)
ok(ic.targetFolderRel === '01_深空/IC1805_心脏星云', `新目标文件夹按内置名生成（实际 ${ic.targetFolderRel}）`)
ok(ic.date === '2026-11-20', `日期取 shotsInfo（实际 ${ic.date}）`)
ok(ic.frameCount === 3 && ic.fileCount === 5, `帧数 3 / 文件 5（实际 ${ic.frameCount}/${ic.fileCount}）`)
const m31 = p1.sessions.find((s) => s.sessionName === 'M31_2026-11-21')!
ok(m31.targetFolderRel === '01_深空/M31_仙女座星系', '已有目标文件夹被复用')
ok(m31.status === 'new', 'M31 状态为新增')
const ngc = p1.sessions.find((s) => s.sessionName === 'NGC7000_2026-11-22')!
ok(ngc.status === 'skip', '无 stacked.jpg 的会话被跳过')
ok(p1.calibrations.find((c) => c.key === 'bias')?.status === 'new', 'bias 状态为新增')
ok(p1.calibrations.find((c) => c.key === 'darklib')?.status === 'new', '暗场库首次可拷贝')

// ---------- 未识别目标可手动修正 ----------
const p2 = previewSync(db, lib, src, [{ sessionRel: 'NGC7000_2026-11-22', catalogId: 'NGC7000', nameCn: '北美洲星云' }])
ok(p2.sessions.find((s) => s.sessionName === 'NGC7000_2026-11-22')?.targetFolderRel === '01_深空/NGC7000_北美洲星云', '手动指定目标生效')

// ---------- 执行同步 ----------
async function main() {
  const r1 = await runSync(db, lib, src, {
    sessions: ['IC1805_2026-11-20', 'M31_2026-11-21'],
    makeDeleteList: true
  })
  ok(r1.ok, `同步成功（errors: ${r1.errors.join(' / ')}）`)
  ok(r1.copied === 12, `拷贝 12 个文件（实际 ${r1.copied}）`)

  const icDir = path.join(lib, '01_深空/IC1805_心脏星云/原始/IC1805_2026-11-20')
  ok(fs.existsSync(path.join(icDir, 'IC1805_300s_0003.fits')), '光帧写入原始/会话目录')
  ok(fs.existsSync(path.join(icDir, 'shotsInfo.json')), 'shotsInfo.json 一并归档')
  ok(fs.existsSync(path.join(icDir, 'stacked.jpg')), 'stacked.jpg 一并归档')
  ok(!fs.existsSync(path.join(icDir, 'failed_0004.fits')), 'failed_*.fits 未拷贝')
  ok(!fs.existsSync(path.join(icDir, 'IC1805_300s_0001.jpg')), '每帧自带 jpg 预览未拷贝')
  ok(!fs.existsSync(path.join(icDir, 'Thumbnail')), 'Thumbnail 目录未拷贝')
  ok(
    fs.existsSync(path.join(lib, '01_深空/M31_仙女座星系/原始/M31_2026-11-21/(1)/panel1_0001.fits')),
    '拼图面板子目录保留'
  )
  ok(fs.existsSync(path.join(lib, '_dwarf mini校准场/bias/cam_0/bias_001.fits')), '校准场按分类归档')
  ok(fs.existsSync(path.join(lib, '_dwarf mini校准场/暗场库/darklib_001.fits')), '暗场库首次拷贝')

  const syncedCount = Number((db.prepare('SELECT COUNT(*) AS c FROM synced_files').get() as { c: number }).c)
  ok(syncedCount === 12, `synced_files 记录 12 条（实际 ${syncedCount}）`)

  const csv = fs.readFileSync(path.join(lib, '_历史记录/素材库历史记录.csv'), 'utf8')
  const csvLines = csv.split('\r\n').filter(Boolean)
  ok(csvLines[0].includes('时间,操作,类别'), '历史 CSV 表头正确')
  ok(csvLines.length === 13, `历史 CSV 12 行明细（实际 ${csvLines.length - 1}）`)
  ok(csv.includes('深空光帧') && csv.includes('校准场-bias'), '历史 CSV 记录类别')

  ok(!!r1.deleteListPath && fs.existsSync(r1.deleteListPath), '按需生成可安全删除清单')
  const delCsv = fs.readFileSync(r1.deleteListPath!, 'utf8')
  ok(delCsv.includes('IC1805_2026-11-20') && delCsv.includes('已校验'), '删除清单含会话与校验状态')

  // ---------- 增量：再预览应为已同步 ----------
  const p3 = previewSync(db, lib, src)
  ok(p3.sessions.find((s) => s.sessionName === 'IC1805_2026-11-20')?.status === 'synced', '重复预览显示已同步')
  ok(p3.calibrations.find((c) => c.key === 'bias')?.status === 'synced', '校准场增量识别为已同步')
  ok(p3.calibrations.find((c) => c.key === 'darklib')?.status === 'skip', '暗场库仅首次拷贝')
  const r2 = await runSync(db, lib, src, { sessions: ['IC1805_2026-11-20'] })
  ok(r2.copied === 0 && r2.skipped === 0, '已同步会话不重复拷贝')

  // ---------- 撤销 ----------
  const undo = undoLastChange(db, lib, path.join(dataDir, 'thumbs'))
  ok(undo.ok && undo.kind === 'sync', `撤销同步成功（${undo.error ?? ''}）`)
  ok(!fs.existsSync(path.join(icDir, 'IC1805_300s_0001.fits')), '撤销删除本次副本')
  ok(!fs.existsSync(icDir), '撤销清理空会话目录')
  ok(fs.existsSync(path.join(lib, '01_深空/IC1805_心脏星云/原始')), '原始 目录层保留')
  ok(fs.existsSync(path.join(lib, '01_深空/M31_仙女座星系/成片')), '已有成片不受影响')
  const left = Number((db.prepare('SELECT COUNT(*) AS c FROM synced_files').get() as { c: number }).c)
  ok(left === 0, `撤销后同步记录清空（实际 ${left}）`)
  const csv2 = fs.readFileSync(path.join(lib, '_历史记录/素材库历史记录.csv'), 'utf8')
  ok(csv2.includes('删除'), '撤销写入删除历史')

  console.log('\nALL PASSED')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
