import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { openDatabase } from '../src/main/db'
import { Scanner } from '../src/main/scanner'
import { disposeOcr } from '../src/main/watermark'
import { getPendingReviews } from '../src/main/queries'
import { resetReviews, resolveReviews } from '../src/main/files'

const base = process.env.TESTBASE!
const lib = path.join(base, 'library')
const thumbs = path.join(base, 'thumbs')
const dataDir = path.join(base, 'data')

function ok(cond: unknown, message: string) {
  if (!cond) {
    console.error('FAIL: ' + message)
    process.exit(1)
  }
  console.log('ok - ' + message)
}

/** 在图片底部合成白色信息条，用于模拟 Dwarf 成片水印 */
async function watermarkedImage(file: string, lines: string[]) {
  const width = 1400
  const height = 1000
  const barHeight = 110
  const text = lines
    .map((line, i) => `<text x="40" y="${44 + i * 48}" font-family="Arial, Microsoft YaHei" font-size="38" fill="#111">${line}</text>`)
    .join('')
  const svg = `<svg width="${width}" height="${barHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${barHeight}" fill="#ffffff"/>${text}
  </svg>`
  await sharp({ create: { width, height, channels: 3, background: { r: 4, g: 6, b: 18 } } })
    .composite([{ input: Buffer.from(svg), top: height - barHeight, left: 0 }])
    .jpeg({ quality: 92 })
    .toFile(file)
}

async function main() {
  fs.rmSync(base, { recursive: true, force: true })
  const rawDir = path.join(lib, '01_深空/M31_仙女座星系/原始/M31_2026-11-21/(1)')
  fs.mkdirSync(rawDir, { recursive: true })
  for (let i = 1; i <= 3; i++) {
    fs.writeFileSync(path.join(rawDir, `M31_300s_2026-11-21_000${i}.fits`), Buffer.alloc(256, 1))
  }
  const finalDir = path.join(lib, '01_深空/M31_仙女座星系/成片')
  fs.mkdirSync(finalDir, { recursive: true })
  await sharp({ create: { width: 24, height: 16, channels: 3, background: { r: 8, g: 10, b: 24 } } })
    .jpeg()
    .toFile(path.join(finalDir, 'M31_2026-11-21.jpg'))

  // 无原始帧的成片：靠水印补总曝光与夜次
  const wmDir = path.join(lib, '01_深空/M16_鹰状星云/成片')
  fs.mkdirSync(wmDir, { recursive: true })
  await watermarkedImage(
    path.join(wmDir, 'HD37805_DWARFMINI_final_001.jpg'),
    ['NGC 7000', '4小时 | 2026.10.07 05:43', 'DWARF mini']
  )
  // 水印信息残缺：应标记待确认
  const pendingDir = path.join(lib, '01_深空/NGC9999_未知/成片')
  fs.mkdirSync(pendingDir, { recursive: true })
  await watermarkedImage(path.join(pendingDir, 'final_001.jpg'), ['NGC 9999'])

  const db = openDatabase(dataDir)
  const scanner = new Scanner(db, lib, thumbs)
  const result = await scanner.scan()
  ok(result.ok, `扫描成功（errors: ${result.errors.join(' / ')}）`)

  const shot = db
    .prepare('SELECT frame_count, file_rel FROM shots WHERE file_name = ?')
    .get('M31_2026-11-21.jpg') as { frame_count: number; file_rel: string } | undefined
  ok(!!shot, '找到成片')
  ok(shot?.frame_count === 3, `会话子目录里的光帧计入帧数（实际 ${shot?.frame_count}）`)

  const rawAssets = db
    .prepare("SELECT file_rel FROM assets WHERE kind = 'raw' ORDER BY file_rel")
    .all() as Array<{ file_rel: string }>
  ok(rawAssets.length === 3, `索引 3 个原始文件（实际 ${rawAssets.length}）`)
  ok(
    rawAssets.every((r) => r.file_rel.includes('原始/M31_2026-11-21/(1)/')),
    '原始文件相对路径保留会话与面板层级'
  )

  // 水印补全：无原始帧时用总曝光、夜次落库，并记录来源与原文
  const wm = db
    .prepare('SELECT night_id, total_exposure_s, exposure_source, review_state, watermark_text FROM shots WHERE file_name = ?')
    .get('HD37805_DWARFMINI_final_001.jpg') as
    | { night_id: number; total_exposure_s: number; exposure_source: string; review_state: string; watermark_text: string }
    | undefined
  ok(!!wm, '找到无原始帧的水印成片')
  ok(wm?.exposure_source === 'watermark', `曝光来源标记为 watermark（实际 ${wm?.exposure_source}）`)
  ok(wm?.total_exposure_s === 14400, `水印总曝光 4 小时落入 shots（实际 ${wm?.total_exposure_s}s）`)
  ok(wm?.review_state === 'ok', `字段齐全不待确认（实际 ${wm?.review_state}）`)
  ok(String(wm?.watermark_text ?? '').includes('NGC'), '水印原文留档')

  const wmNight = db.prepare('SELECT date, total_exposure_s FROM nights WHERE id = ?').get(wm?.night_id ?? 0) as
    | { date: string; total_exposure_s: number }
    | undefined
  ok(wmNight?.date === '2026-10-06', `文件名无日期时按水印夜次归档（实际 ${wmNight?.date}）`)
  ok(wmNight?.total_exposure_s === 14400, `夜次总曝光随水印曝光更新（实际 ${wmNight?.total_exposure_s}s）`)

  const pending = db.prepare('SELECT review_state FROM shots WHERE file_name = ?').get('final_001.jpg') as
    | { review_state: string }
    | undefined
  ok(pending?.review_state === 'pending', `水印信息残缺标记待确认（实际 ${pending?.review_state}）`)

  const stats = db
    .prepare("SELECT COUNT(*) AS c FROM shots WHERE exposure_source = 'watermark'")
    .get() as { c: number }
  ok(Number(stats.c) === 1, `统计可筛出水印补全成片（实际 ${stats.c}）`)

  // 待确认核对：补曝光后来源转 manual、清除标记并同步夜次
  const pendingList = getPendingReviews(db, lib)
  const pendingRow = pendingList.find((r) => r.fileName === 'final_001.jpg')
  ok(!!pendingRow, '待确认列表返回水印信息残缺成片')
  const resolved = resolveReviews(db, [{ id: pendingRow?.id ?? 0, totalExposureS: 3600 }])
  ok(resolved.ok && resolved.updated === 1, '核对保存成功')
  const after = db
    .prepare('SELECT total_exposure_s, exposure_source, review_state, night_id FROM shots WHERE file_name = ?')
    .get('final_001.jpg') as
    | { total_exposure_s: number; exposure_source: string; review_state: string; night_id: number }
    | undefined
  ok(after?.total_exposure_s === 3600, `手工曝光写入 shots（实际 ${after?.total_exposure_s}s）`)
  ok(after?.exposure_source === 'manual', `曝光来源转为 manual（实际 ${after?.exposure_source}）`)
  ok(after?.review_state === 'manual', `核对状态记为 manual（实际 ${after?.review_state}）`)
  const afterNight = db.prepare('SELECT total_exposure_s FROM nights WHERE id = ?').get(after?.night_id ?? 0) as
    | { total_exposure_s: number }
    | undefined
  ok(afterNight?.total_exposure_s === 3600, `夜次曝光随核对更新（实际 ${afterNight?.total_exposure_s}s）`)
  ok(getPendingReviews(db, lib).length === 0, '核对后待确认列表清空')
  ok(getPendingReviews(db, lib, 'manual').length === 1, '已核对列表可查到该成片')

  // 重扫保护：手工曝光与核对状态不被覆盖
  await scanner.scan()
  await scanner.scan()
  const rescanned = db
    .prepare('SELECT total_exposure_s, exposure_source, review_state FROM shots WHERE file_name = ?')
    .get('final_001.jpg') as
    | { total_exposure_s: number; exposure_source: string; review_state: string }
    | undefined
  ok(rescanned?.total_exposure_s === 3600, `重扫后保留手工曝光（实际 ${rescanned?.total_exposure_s}s）`)
  ok(rescanned?.exposure_source === 'manual', `重扫后保留 manual 来源（实际 ${rescanned?.exposure_source}）`)
  ok(rescanned?.review_state === 'manual', `重扫后保留核对状态（实际 ${rescanned?.review_state}）`)

  // 恢复自动：回到水印解析结果，信息残缺则重新待确认
  const reset = resetReviews(db, [pendingRow?.id ?? 0])
  ok(reset.ok && reset.updated === 1, '恢复自动执行成功')
  const restored = db
    .prepare('SELECT total_exposure_s, exposure_source, review_state, night_id FROM shots WHERE file_name = ?')
    .get('final_001.jpg') as
    | { total_exposure_s: number; exposure_source: string | null; review_state: string; night_id: number }
    | undefined
  ok(restored?.total_exposure_s === 0, `恢复后清除手工曝光（实际 ${restored?.total_exposure_s}s）`)
  ok(restored?.exposure_source === null, `恢复后清除 manual 来源（实际 ${restored?.exposure_source}）`)
  ok(restored?.review_state === 'pending', `恢复后重新待确认（实际 ${restored?.review_state}）`)
  const restoredNight = db.prepare('SELECT total_exposure_s FROM nights WHERE id = ?').get(restored?.night_id ?? 0) as
    | { total_exposure_s: number }
    | undefined
  ok(restoredNight?.total_exposure_s === 0, `恢复后夜次曝光同步归零（实际 ${restoredNight?.total_exposure_s}s）`)
  ok(getPendingReviews(db, lib).length === 1, '恢复后重新出现在待确认列表')

  await disposeOcr()
  db.close()
  console.log('\nALL PASSED')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
