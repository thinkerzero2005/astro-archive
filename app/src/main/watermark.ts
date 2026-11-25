import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { createWorker } from 'tesseract.js'
import { catalogIdByEnglishName, normalizeCatalogId } from './catalog'

type OcrWorker = Awaited<ReturnType<typeof createWorker>>

/** 水印识别结果：字段全部可空，未识别到就留空，由调用方决定是否进待确认 */
export interface WatermarkResult {
  ok: boolean
  hasBar: boolean
  rawText: string
  targetRaw: string | null
  catalogId: string | null
  catalogSource: 'number' | 'english' | null
  exposureMinutes: number | null
  exposureRaw: string | null
  endedAt: string | null
  nightDate: string | null
  rigName: string | null
  frameSeconds: number | null
  frameGain: number | null
  coordinates: { lat: number; lng: number } | null
  barRatio: number | null
  confidence: number
  needsReview: boolean
  reason: string | null
}

interface BarBox {
  width: number
  height: number
  top: number
  barHeight: number
}

const CATALOG_RE = /(ABELL|HD|SAO|HIP|HR|IC|NGC|SH2|LDN|LBN|VDB|CED|PGC|UGC|M|C|B)\s*[-_\s]?(\d{1,6})/i

let workerPromise: Promise<OcrWorker> | null = null
let queue: Promise<unknown> = Promise.resolve()

function tessdataDir(): string | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const candidates = [
    process.env.ASTRO_TESSDATA,
    resourcesPath ? path.join(resourcesPath, 'tessdata') : null,
    path.join(__dirname, '..', 'assets', 'tessdata'),
    path.join(process.cwd(), 'assets', 'tessdata')
  ].filter((p): p is string => !!p)
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'chi_sim.traineddata'))) return dir
  }
  return null
}

/** 惰性创建 OCR worker，全进程复用一个；中文模型同时覆盖数字与拉丁字母 */
function getWorker(): Promise<OcrWorker> {
  if (!workerPromise) {
    const langPath = tessdataDir()
    if (!langPath) {
      throw new Error('缺少 OCR 语言包：assets/tessdata/chi_sim.traineddata')
    }
    workerPromise = createWorker('chi_sim', 1, {
      langPath,
      gzip: false,
      cachePath: path.join(os.tmpdir(), 'astro-ocr-cache'),
      logger: () => {}
    })
    workerPromise.catch(() => {
      workerPromise = null
    })
  }
  return workerPromise
}

async function ocrBuffer(buf: Buffer): Promise<{ text: string; confidence: number }> {
  const task = queue.then(async () => {
    const worker = await getWorker()
    const { data } = await worker.recognize(buf)
    return { text: String(data.text ?? ''), confidence: Number(data.confidence ?? 0) }
  })
  queue = task.catch(() => {})
  return task
}

/** 从底部向上找连续高亮行，定位白色信息条；找不到返回 null */
export async function locateBar(file: string): Promise<BarBox | null> {
  const meta = await sharp(file).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (!width || !height) return null
  const scanHeight = Math.max(80, Math.min(height, Math.round(height * 0.3)))
  const { data, info } = await sharp(file)
    .extract({ left: 0, top: height - scanHeight, width, height: scanHeight })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const channels = info.channels
  const rowMean = (y: number) => {
    let sum = 0
    const offset = y * width * channels
    for (let x = 0; x < width; x++) sum += data[offset + x * channels]
    return sum / width
  }
  let localTop = scanHeight
  for (let y = scanHeight - 1; y >= 0; y--) {
    if (rowMean(y) > 200) localTop = y
    else break
  }
  const barHeight = scanHeight - localTop
  if (barHeight < 6) return null
  return { width, height, top: height - scanHeight + localTop, barHeight }
}

async function cropBar(file: string, box: BarBox): Promise<Buffer> {
  const pad = 3
  const top = Math.max(0, box.top - pad)
  const height = Math.min(box.height - top, box.barHeight + pad)
  const scale = Math.min(4, Math.max(2, Math.round(1400 / box.width)))
  return sharp(file)
    .extract({ left: 0, top, width: box.width, height })
    .resize({ width: box.width * scale, kernel: 'lanczos3' })
    .grayscale()
    .normalize()
    .png()
    .toBuffer()
}

function nightDateOf(endedAt: string | null): string | null {
  if (!endedAt) return null
  const m = endedAt.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return null
  const [, y, mo, d, h] = m
  const hour = Number(h)
  // 凌晨结束归到前一天；下午/傍晚结束少见，记为当天
  const shift = hour < 12 ? -1 : 0
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d) + shift))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}`
}

function cleanTarget(text: string): string | null {
  const stripped = text
    .replace(/DWARF\s*(?:mini|3|2)?/gi, ' ')
    .replace(/\d+\s*小\s*时\s*(?:\d+\s*分)?/g, ' ')
    .replace(/\d+\s*分\s*钟?/g, ' ')
    .replace(/20\d{2}[.\-/年]\s*\d{1,2}[.\-/月]\s*\d{1,2}\s*日?\s*(?:\d{1,2}\s*[:：]\s*\d{2})?/g, ' ')
    .replace(/\d{1,3}(?:\.\d+)?\s*[°"”]\s*[NS]\s*\d{1,3}(?:\.\d+)?\s*[°"”?]\s*[EW]/gi, ' ')
  const segments = stripped
    .split(/[|｜\n\t]/)
    .map((s) =>
      s
        .replace(/[[\]【】<>(){}]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)
  const candidate = segments.find((s) => /[A-Za-z\u4e00-\u9fa5]/.test(s) && !/^\d+\s*s$/i.test(s))
  if (!candidate) return null
  return candidate.replace(/[-_·:：,，]+$/g, '').trim()
}

/** 解析白条文字；纯函数，便于单测 */
export function parseWatermarkText(text: string): Omit<WatermarkResult, 'ok' | 'hasBar' | 'barRatio' | 'rawText'> {
  const flat = text.replace(/\s+/g, ' ')

  const expHm = flat.match(/(\d{1,2})\s*小\s*时\s*(?:(\d{1,2})\s*分)?/)
  const expMin = expHm ? Number(expHm[1]) * 60 + Number(expHm[2] ?? 0) : null
  const expOnlyMin = expMin == null ? flat.match(/(\d{1,3})\s*分\s*钟?/) : null
  const exposureMinutes = expMin ?? (expOnlyMin ? Number(expOnlyMin[1]) : null)
  const exposureRaw = expHm
    ? `${expHm[1]}小时${expHm[2] ? `${expHm[2]}分` : ''}`
    : expOnlyMin
      ? `${expOnlyMin[1]}分`
      : null

  const dt = flat.match(/(20\d{2})[.\-/年]\s*(\d{1,2})[.\-/月]\s*(\d{1,2})\s*日?\s*(\d{1,2})\s*[:：]\s*(\d{2})/)
  const endedAt = dt
    ? `${dt[1]}-${dt[2].padStart(2, '0')}-${dt[3].padStart(2, '0')}T${dt[4].padStart(2, '0')}:${dt[5]}`
    : null

  const rigMatch = flat.match(/DWARF\s*(mini|3|2)?/i)
  const rigName = rigMatch ? `Dwarf ${(rigMatch[1] ?? 'mini').replace(/^./, (c) => c.toUpperCase())}` : null

  const paramMatch = flat.match(/(\d{1,3})\s*s\s*[|:：·]\s*(\d{1,3})/i)
  const frameSeconds = paramMatch ? Number(paramMatch[1]) : null
  const frameGain = paramMatch ? Number(paramMatch[2]) : null

  const gps = flat.match(/(\d{1,3}(?:\.\d+)?)\s*[°"”]\s*N\s*(\d{1,3}(?:\.\d+)?)\s*[°"”?]\s*E/i)
  const coordinates = gps ? { lat: Number(gps[1]), lng: Number(gps[2]) } : null

  const targetRaw = cleanTarget(flat)
  let catalogId: string | null = null
  let catalogSource: 'number' | 'english' | null = null
  if (targetRaw) {
    const code = targetRaw.match(CATALOG_RE)
    if (code) {
      catalogId = normalizeCatalogId(`${code[1]}${code[2]}`)
      catalogSource = 'number'
    } else {
      const en = catalogIdByEnglishName(targetRaw)
      if (en) {
        catalogId = en
        catalogSource = 'english'
      }
    }
  }

  const nightDate = nightDateOf(endedAt)
  const reasons: string[] = []
  if (!targetRaw) reasons.push('未识别到目标')
  else if (!catalogId) reasons.push('目标未匹配编号')
  if (!endedAt) reasons.push('未识别到拍摄时间')
  else if (dt && Number(dt[4]) >= 12) reasons.push('结束时间在下午，夜次待核')
  if (exposureMinutes == null) reasons.push('未识别到总曝光')

  return {
    targetRaw,
    catalogId,
    catalogSource,
    exposureMinutes,
    exposureRaw,
    endedAt,
    nightDate,
    rigName,
    frameSeconds,
    frameGain,
    coordinates,
    confidence: 0,
    needsReview: reasons.length > 0,
    reason: reasons.length ? reasons.join('；') : null
  }
}

/** 识别一张成片的水印；找不到白条时 hasBar=false，调用方回退文件名/手工 */
export async function recognizeWatermark(file: string): Promise<WatermarkResult> {
  const base: WatermarkResult = {
    ok: true,
    hasBar: false,
    rawText: '',
    targetRaw: null,
    catalogId: null,
    catalogSource: null,
    exposureMinutes: null,
    exposureRaw: null,
    endedAt: null,
    nightDate: null,
    rigName: null,
    frameSeconds: null,
    frameGain: null,
    coordinates: null,
    barRatio: null,
    confidence: 0,
    needsReview: true,
    reason: '未检测到水印条'
  }
  const box = await locateBar(file)
  if (!box) return base
  const buf = await cropBar(file, box)
  const { text, confidence } = await ocrBuffer(buf)
  const parsed = parseWatermarkText(text)
  return {
    ...base,
    ...parsed,
    hasBar: true,
    rawText: text.trim(),
    barRatio: Number((box.barHeight / box.height).toFixed(4)),
    confidence: Math.round(confidence),
    needsReview: parsed.needsReview || confidence < 60
  }
}

interface CacheEntry {
  size: number
  mtimeMs: number
  result: WatermarkResult
}

/** 按 文件路径+大小+mtime 缓存识别结果，重扫/刷新不重复 OCR */
const resultCache = new Map<string, CacheEntry>()

export async function recognizeWatermarkCached(file: string): Promise<WatermarkResult> {
  const stat = await fs.promises.stat(file).catch(() => null)
  if (stat) {
    const hit = resultCache.get(file)
    if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) return hit.result
  }
  const result = await recognizeWatermark(file)
  if (stat) resultCache.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, result })
  return result
}

/** 应用退出时释放 worker */
export async function disposeOcr(): Promise<void> {
  resultCache.clear()
  if (!workerPromise) return
  try {
    const worker = await workerPromise
    await worker.terminate()
  } catch {
    /* ignore */
  } finally {
    workerPromise = null
  }
}
