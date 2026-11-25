import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { openDatabase, setSetting } from '../src/main/db'
import { parseFitsHeader, readFitsHeader } from '../src/main/fits'
import { Scanner } from '../src/main/scanner'
import { disposeOcr } from '../src/main/watermark'
import { getOnlineProfile, profileCachePath } from '../src/main/profileOnline'

const base = process.env.TESTBASE!
const lib = path.join(base, 'library')
const thumbs = path.join(base, 'thumbs')
const dataDir = path.join(base, 'data')
const cacheDir = path.join(base, 'profiles')

function ok(cond: unknown, message: string) {
  if (!cond) {
    console.error('FAIL: ' + message)
    process.exit(1)
  }
  console.log('ok - ' + message)
}

function card(key: string, value: string | number): string {
  if (typeof value === 'number') {
    return `${key.padEnd(8)}= ${String(value).padStart(20)}`.padEnd(80, ' ')
  }
  return `${key.padEnd(8)}= ${`'${value}'`.padEnd(20)}`.padEnd(80, ' ')
}

/** 构造最小 FITS 头：SIMPLE + 若干卡片 + END，补齐到 2880 字节 */
function fitsBuffer(cards: Array<[string, string | number]>, end = true) {
  const lines = ['SIMPLE  =                    T'.padEnd(80, ' ')]
  for (const [key, value] of cards) lines.push(card(key, value))
  if (end) lines.push('END'.padEnd(80, ' '))
  let text = lines.join('')
  while (text.length % 2880 !== 0) text += ' '.repeat(80)
  return Buffer.from(text, 'latin1')
}

async function finalImage(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  await sharp({ create: { width: 24, height: 16, channels: 3, background: { r: 8, g: 10, b: 24 } } })
    .jpeg()
    .toFile(file)
}

async function main() {
  fs.rmSync(base, { recursive: true, force: true })
  fs.mkdirSync(base, { recursive: true })

  // ---------- FITS 解析 ----------
  const buf = fitsBuffer([
    ['DATE-OBS', '2026-11-21T14:30:25.123'],
    ['EXPTIME', 300],
    ['GAIN', 80],
    ['FILTER', 'L-Extreme'],
    ['OBJECT', 'M42']
  ])
  const header = parseFitsHeader(buf)
  ok(!!header, '最小 FITS 头可解析')
  ok(header?.dateObs === '2026-11-21T14:30:25.123', `DATE-OBS 保留原文（实际 ${header?.dateObs}）`)
  ok(header?.nightDate === '2026-11-21', `DATE-OBS 推算夜次（实际 ${header?.nightDate}）`)
  ok(header?.exposureS === 300, `EXPTIME 解析（实际 ${header?.exposureS}）`)
  ok(header?.gain === 80, `GAIN 解析（实际 ${header?.gain}）`)
  ok(header?.filter === 'L-Extreme', `FILTER 解析（实际 ${header?.filter}）`)
  ok(header?.object === 'M42', `OBJECT 解析（实际 ${header?.object}）`)
  ok(parseFitsHeader(fitsBuffer([['EXPTIME', 10]], false)) === null, '缺少 END 的截断头视为无效')
  ok(parseFitsHeader(Buffer.from('not a fits file'.padEnd(160, ' '), 'latin1')) === null, '非 FITS 内容返回 null')
  ok(parseFitsHeader(buf.subarray(0, 40)) === null, '过短文件返回 null')

  const headerFile = path.join(base, 'head.fits')
  fs.writeFileSync(headerFile, Buffer.concat([buf, Buffer.alloc(2880, 0)]))
  const fromDisk = await readFitsHeader(headerFile)
  ok(fromDisk?.nightDate === '2026-11-21', 'readFitsHeader 只读文件头即可取到日期')

  // ---------- 扫描夜次优先级 ----------
  const fitsSession = path.join(lib, '01_深空/M42_猎户座大星云/原始/M42_2026-11-20/(1)')
  fs.mkdirSync(fitsSession, { recursive: true })
  fs.writeFileSync(path.join(fitsSession, 'frame_001.fits'), fitsBuffer([
    ['DATE-OBS', '2026-11-21T14:30:25'],
    ['EXPTIME', 300]
  ]))
  await finalImage(path.join(lib, '01_深空/M42_猎户座大星云/成片/M42_2026-11-20.jpg'))

  const infoSession = path.join(lib, '01_深空/M31_仙女座星系/原始/M31_2026-11-20/(1)')
  fs.mkdirSync(infoSession, { recursive: true })
  fs.writeFileSync(path.join(infoSession, 'frame_001.fits'), fitsBuffer([['EXPTIME', 60]]))
  fs.writeFileSync(
    path.join(lib, '01_深空/M31_仙女座星系/原始/M31_2026-11-20/shotsInfo.json'),
    JSON.stringify({ target: 'M 31', date: '2026-11-22' })
  )
  await finalImage(path.join(lib, '01_深空/M31_仙女座星系/成片/M31_2026-11-20.jpg'))

  const nameSession = path.join(lib, '01_深空/M45_昴星团/原始/M45_2026-11-20/(1)')
  fs.mkdirSync(nameSession, { recursive: true })
  fs.writeFileSync(path.join(nameSession, 'frame_001.fits'), fitsBuffer([['EXPTIME', 60]]))
  await finalImage(path.join(lib, '01_深空/M45_昴星团/成片/M45_2026-11-20.jpg'))

  const db = openDatabase(dataDir)
  const scanner = new Scanner(db, lib, thumbs)
  const result = await scanner.scan()
  ok(result.ok, `扫描成功（errors: ${result.errors.join(' / ')}）`)

  const nightOf = (fileName: string) =>
    db
      .prepare('SELECT n.date AS date, s.frame_count AS frames FROM shots s LEFT JOIN nights n ON n.id = s.night_id WHERE s.file_name = ?')
      .get(fileName) as { date: string; frames: number } | undefined

  const m42 = nightOf('M42_2026-11-20.jpg')
  ok(m42?.date === '2026-11-21', `FITS 日期优先于文件名（实际 ${m42?.date}）`)
  ok(m42?.frames === 1, `FITS 会话的帧数归入 FITS 日期（实际 ${m42?.frames}）`)

  const m31 = nightOf('M31_2026-11-20.jpg')
  ok(m31?.date === '2026-11-22', `无 FITS 日期时 shotsInfo 优先于文件名（实际 ${m31?.date}）`)
  ok(m31?.frames === 1, `shotsInfo 日期的帧数正确（实际 ${m31?.frames}）`)

  const m45 = nightOf('M45_2026-11-20.jpg')
  ok(m45?.date === '2026-11-20', `无 FITS/shotsInfo 时用文件名/文件夹日期（实际 ${m45?.date}）`)

  // ---------- 在线名片：默认关闭与离线回退 ----------
  const targetRow = db.prepare("SELECT id FROM targets WHERE catalog_id = 'M42'").get() as { id: number } | undefined
  ok(!!targetRow, '找到目标记录')
  const targetId = targetRow?.id ?? 0

  const disabled = await getOnlineProfile(db, targetId, { cacheDir })
  ok(disabled.enabled === false, '联网资料默认关闭')
  ok(disabled.profile === null && disabled.builtin === true, '关闭时回退内置资料')
  ok(!!disabled.error?.includes('未开启'), `关闭时给出设置提示（实际 ${disabled.error}）`)

  setSetting(db, 'allow_online_profile', '1')
  const offline = await getOnlineProfile(db, targetId, {
    cacheDir,
    fetchImpl: (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
  })
  ok(offline.enabled && offline.builtin && offline.profile === null, '断网且无缓存时回退内置资料')
  ok(!!offline.error?.includes('联网获取失败'), `断网返回可重试错误（实际 ${offline.error}）`)

  const cachedRecord = {
    title: '猎户座大星云',
    extract: '缓存摘要：猎户座大星云是离我们最近的恒星形成区。',
    shortDescription: '发射星云',
    imageFile: null,
    source: '维基百科（中文）',
    lang: 'zh',
    updatedAt: '2026-11-20T00:00:00.000Z',
    fetchedAt: new Date().toISOString()
  }
  fs.mkdirSync(cacheDir, { recursive: true })
  fs.writeFileSync(profileCachePath(cacheDir, 'M42'), JSON.stringify(cachedRecord), 'utf8')
  const cached = await getOnlineProfile(db, targetId, {
    cacheDir,
    fetchImpl: (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
  })
  ok(cached.cached && cached.profile?.title === '猎户座大星云', '有缓存时优先展示缓存')
  ok(cached.profile?.source === '维基百科（中文）', '缓存保留资料来源')

  const forced = await getOnlineProfile(db, targetId, {
    cacheDir,
    force: true,
    fetchImpl: (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
  })
  ok(forced.cached && !!forced.profile && !!forced.error?.includes('已显示缓存'), '强制刷新失败时保留缓存并提示重试')

  await disposeOcr()
  db.close()
  console.log('\nALL PASSED')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
