import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { disposeOcr, parseWatermarkText, recognizeWatermark, locateBar, recognizeWatermarkCached } from '../src/main/watermark'
import { recognizeInbox } from '../src/main/inbox'

const base = process.env.TESTBASE!

function ok(cond: unknown, message: string) {
  if (!cond) {
    console.error('FAIL: ' + message)
    process.exit(1)
  }
  console.log('ok - ' + message)
}

function parseCases() {
  // A 类版式：目标在左，第二行「曝光 | 日期时间」，右侧设备
  const a = parseWatermarkText('IC 434 [ DWARF mini\n1 小 时 32 分 | 2026.11.21 10:34')
  ok(a.catalogId === 'IC434', `A 类：编号归一 IC434（实际 ${a.catalogId}）`)
  ok(a.exposureMinutes === 92, `A 类：1小时32分 = 92 分钟（实际 ${a.exposureMinutes}）`)
  ok(a.endedAt === '2026-11-21T10:34', `A 类：结束时间（实际 ${a.endedAt}）`)
  ok(a.nightDate === '2026-11-20', `A 类：凌晨结束归前一天（实际 ${a.nightDate}）`)
  ok(a.rigName === 'Dwarf Mini', `A 类：器材（实际 ${a.rigName}）`)

  // B 类版式：设备在左，随后英文俗名 + 曝光，第二行日期 + GPS + 参数
  const b = parseWatermarkText(
    "DWARF mini Bode's Galaxy | 4 小 时 5 分\n2026.02.04 03:52 |37.9\" N 113.5?E 15s | 60 | 天 文"
  )
  ok(b.targetRaw === "Bode's Galaxy", `B 类：英文名解析（实际 ${b.targetRaw}）`)
  ok(b.catalogId === 'M81', `B 类：英文名映射 M81（实际 ${b.catalogId}/${b.catalogSource}）`)
  ok(b.exposureMinutes === 245, `B 类：4小时5分 = 245 分钟（实际 ${b.exposureMinutes}）`)
  ok(b.nightDate === '2026-02-03', `B 类：夜次换算（实际 ${b.nightDate}）`)
  ok(b.frameSeconds === 15 && b.frameGain === 60, `B 类：单帧参数（实际 ${b.frameSeconds}/${b.frameGain}）`)

  // 英文俗名必须能映射到内置编号（含水印里的鹰状星云）
  const m16 = parseWatermarkText('DWARF mini Eagle Nebula | 1 小 时 59 分 2026.04.19 03:51131.5" N 118.9"E 60s | 60 | 双窄带')
  ok(m16.catalogId === 'M16', `Eagle Nebula → M16（实际 ${m16.catalogId}）`)

  // 无编号、无英文匹配 → 待确认
  const unknown = parseWatermarkText('DWARF mini Some Unknown Nebula\n2026.05.01 22:10')
  ok(unknown.catalogId === null && unknown.needsReview, '未知目标进入待确认')
  ok(unknown.nightDate === '2026-05-01', '傍晚结束记为当天')

  // 缺字段 → 待确认并给出原因
  const broken = parseWatermarkText('DWARF mini')
  ok(broken.needsReview && !!broken.reason, `缺字段给出原因（${broken.reason}）`)
}

async function syntheticCase() {
  const dir = path.join(base, 'watermark')
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })

  const barHeight = 110
  const width = 1400
  const height = 1000
  const svg = `<svg width="${width}" height="${barHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${barHeight}" fill="#ffffff"/>
    <text x="40" y="44" font-family="Arial, Microsoft YaHei" font-size="38" fill="#111111">NGC 7000</text>
    <text x="40" y="92" font-family="Microsoft YaHei, Arial" font-size="34" fill="#111111">4小时 | 2026.10.07 05:43</text>
    <text x="1130" y="66" font-family="Arial" font-size="30" fill="#111111">DWARF mini</text>
  </svg>`
  const file = path.join(dir, 'synthetic.jpg')
  await sharp({ create: { width, height, channels: 3, background: { r: 4, g: 6, b: 18 } } })
    .composite([{ input: Buffer.from(svg), top: height - barHeight, left: 0 }])
    .jpeg({ quality: 92 })
    .toFile(file)

  const box = await locateBar(file)
  ok(!!box, '合成图定位到白条')
  ok(!!box && Math.abs(box.top - (height - barHeight)) <= 3, `白条上边界准确（top=${box?.top}）`)

  const result = await recognizeWatermark(file)
  ok(result.hasBar, '合成图识别出水印')
  ok(result.catalogId === 'NGC7000', `合成图目标 NGC7000（实际 ${result.targetRaw} → ${result.catalogId}）`)
  ok(result.exposureMinutes === 240, `合成图总曝光 240 分钟（实际 ${result.exposureMinutes}）`)
  ok(result.nightDate === '2026-10-06', `合成图夜次 2026-10-06（实际 ${result.nightDate}）`)
  ok(result.rigName === 'Dwarf Mini', `合成图器材（实际 ${result.rigName}）`)
  ok(!result.needsReview, `合成图字段齐全无需待确认（${result.reason ?? ''}）`)

  // 无白条的普通图：不误判
  const plain = path.join(dir, 'plain.jpg')
  await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 12, b: 30 } } })
    .jpeg()
    .toFile(plain)
  const none = await recognizeWatermark(plain)
  ok(!none.hasBar && none.reason === '未检测到水印条', '无白条图正确跳过')

  // 缓存：同一路径+大小+mtime 第二次直接复用结果（对象引用相同）
  const cached1 = await recognizeWatermarkCached(file)
  const cached2 = await recognizeWatermarkCached(file)
  ok(cached1 === cached2, '识别结果按大小+mtime 缓存复用')

  return { dir, file }
}

async function inboxCase(source: { dir: string; file: string }) {
  const root = path.join(base, 'library')
  const inboxDir = path.join(root, '_收件箱')
  fs.mkdirSync(inboxDir, { recursive: true })
  fs.copyFileSync(source.file, path.join(inboxDir, 'new-final.jpg'))

  const items = await recognizeInbox(root, [
    '_收件箱/new-final.jpg',
    '../escape.jpg',
    '_收件箱/missing.jpg'
  ])
  ok(items.length === 1, `收件箱识别只处理合法且存在的图片（实际 ${items.length} 条）`)
  ok(items[0]?.relPath === '_收件箱/new-final.jpg', '返回相对路径与入参一致')
  ok(items[0]?.catalogId === 'NGC7000', `收件箱识别给出建议编号（${items[0]?.catalogId}）`)
  ok(items[0]?.exposureMinutes === 240, `收件箱识别给出总曝光（${items[0]?.exposureMinutes} 分钟）`)
  ok(items[0]?.nightDate === '2026-10-06', `收件箱识别给出夜次（${items[0]?.nightDate}）`)
}

async function realSampleCase() {
  const sample = (process.env.ASTRO_REAL_SAMPLE || '').trim()
  if (!sample || !fs.existsSync(sample)) {
    console.log('skip - 未提供真实样本（设置 ASTRO_REAL_SAMPLE 指向一张带水印成片）')
    return
  }
  const result = await recognizeWatermark(sample)
  console.log(`  样本 ${path.basename(sample)} → ${result.targetRaw} / ${result.exposureRaw} / ${result.endedAt} / 夜次 ${result.nightDate}`)
  ok(result.hasBar, '真实样本识别出水印')
  ok(!!result.catalogId, `真实样本匹配到编号（${result.catalogId}）`)
  ok(!!result.nightDate, `真实样本换算出夜次（${result.nightDate}）`)
}

async function main() {
  fs.rmSync(base, { recursive: true, force: true })
  fs.mkdirSync(base, { recursive: true })
  parseCases()
  const source = await syntheticCase()
  await inboxCase(source)
  await realSampleCase()
  await disposeOcr()
  console.log('\nALL PASSED')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
