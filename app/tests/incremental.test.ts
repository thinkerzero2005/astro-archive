import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { getSetting, openDatabase, setSetting } from '../src/main/db'
import { Scanner } from '../src/main/scanner'
import { disposeOcr } from '../src/main/watermark'

const base = process.env.TESTBASE!
const lib = path.join(base, 'library')
const thumbs = path.join(base, 'thumbs')
const data = path.join(base, 'data')

function ok(cond: unknown, message: string) {
  if (!cond) {
    console.error('FAIL: ' + message)
    process.exit(1)
  }
  console.log('ok - ' + message)
}

function fitsFile(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const lines = [
    'SIMPLE  =                    T'.padEnd(80, ' '),
    "DATE-OBS= '2026-11-21T14:30:25'".padEnd(80, ' '),
    'EXPTIME =                  120'.padEnd(80, ' '),
    'END'.padEnd(80, ' ')
  ]
  let text = lines.join('')
  while (text.length % 2880 !== 0) text += ' '.repeat(80)
  fs.writeFileSync(file, Buffer.from(text, 'latin1'))
}

async function jpg(file: string, name: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 12, g: 16, b: 40 } } })
    .composite([
      {
        input: Buffer.from(
          `<svg width="32" height="24"><text x="2" y="16" fill="#cfe0ff" font-size="9" font-family="sans-serif">${name}</text></svg>`
        )
      }
    ])
    .jpeg()
    .toFile(file)
}

async function main() {
  fs.rmSync(base, { recursive: true, force: true })
  fs.mkdirSync(base, { recursive: true })

  const target = '01_深空/M42_猎户座大星云'
  fitsFile(path.join(lib, target, '原始/M42_2026-11-21/frame_001.fits'))
  await jpg(path.join(lib, target, '成片/M42_2026-11-21.jpg'), 'M42')
  fs.mkdirSync(path.join(lib, target, '处理'), { recursive: true })
  fs.writeFileSync(path.join(lib, target, '处理/stack.tif'), Buffer.from('fake-tiff-content'))
  await jpg(path.join(lib, '02_星野/银河/2026-11-21_山顶/银河.jpg'), 'MW')

  const db = openDatabase(data)
  const scanner = new Scanner(db, lib, thumbs)

  const first = await scanner.scan()
  ok(first.ok, `首次扫描成功（${first.errors.join(' / ')}）`)
  ok(first.skipped === 0, `首次扫描没有跳过（${first.skipped}）`)
  ok(first.shotCount === 2, `首次扫描识别 2 张成片（${first.shotCount}）`)
  ok(first.assetCount === 2, `首次扫描登记 2 个素材（${first.assetCount}）`)

  const assetMtime = db.prepare("SELECT mtime FROM assets WHERE kind = 'raw'").get() as { mtime: number }
  ok(assetMtime.mtime > 0, '素材指纹写入 mtime')

  const shotId = (db.prepare("SELECT id FROM shots WHERE file_name = 'M42_2026-11-21.jpg'").get() as { id: number }).id
  db.prepare('UPDATE shots SET rating = 4 WHERE id = ?').run(shotId)

  const second = await scanner.scan()
  ok(second.ok, '二次扫描成功')
  ok(second.skipped === 4, `指纹未变的 4 个文件全部跳过（${second.skipped}）`)
  ok(second.shotCount === 2 && second.assetCount === 2, '跳过不改变统计口径')
  const rating = (db.prepare('SELECT rating FROM shots WHERE id = ?').get(shotId) as { rating: number }).rating
  ok(rating === 4, '跳过的文件保留人工评级')

  const changed = path.join(lib, target, '成片/M42_2026-11-21.jpg')
  const later = new Date(Date.now() + 5000)
  fs.utimesSync(changed, later, later)
  const third = await scanner.scan()
  ok(third.ok, '文件改动后扫描成功')
  ok(third.skipped === 3, `仅跳过一个改动之外的文件（${third.skipped}）`)

  const full = await scanner.scan({ full: true })
  ok(full.ok && full.skipped === 0, '全量重扫不跳过任何文件')

  const beforeCancel = getSetting(db, 'last_scan_at')
  setSetting(db, 'last_scan_at', '2000-01-01T00:00:00.000Z')
  const cancelled = await scanner.scan({ shouldCancel: () => true })
  ok(cancelled.cancelled === true && cancelled.ok === false, '取消扫描立即返回 cancelled')
  ok((cancelled.errors[0] ?? '').includes('取消'), '取消结果带说明')
  ok(getSetting(db, 'last_scan_at') === '2000-01-01T00:00:00.000Z', '取消后不更新上次扫描时间')
  const afterCancelCount = Number((db.prepare('SELECT COUNT(*) AS c FROM shots').get() as { c: number }).c)
  ok(afterCancelCount === 2, '取消后不清空已有记录')
  setSetting(db, 'last_scan_at', beforeCancel ?? '')

  await disposeOcr()
  db.close()
  console.log('\nALL PASSED')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
