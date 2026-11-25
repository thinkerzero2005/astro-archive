import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import exifr from 'exifr'
import { DB, nowIso, setSetting } from './db'
import { builtinProfile } from './catalog'
import { isFitsFile, readFitsHeader } from './fits'
import { probeAndThumb } from './thumbs'
import { recognizeWatermarkCached, WatermarkResult } from './watermark'

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.heic', '.avif'])
const RAW_EXT = new Set(['.fits', '.fit', '.fts', '.raw', '.cr2', '.cr3', '.nef', '.arw', '.dng', '.raf', '.orf', '.rw2'])
const VIDEO_EXT = new Set(['.mp4', '.mov', '.avi', '.mkv', '.m4v'])

const DEEP_DIR = '01_深空'
const NIGHT_DIR = '02_星野'
const NIGHT_TYPES = ['银河', '星轨', '延时', '其他'] as const

export interface ScanProgress {
  phase: string
  done: number
  total: number
  label?: string
  /** 当前处理阶段：解析文件、生成缩略图、水印识别 */
  stage?: 'parse' | 'thumb' | 'watermark'
}

export interface ScanOptions {
  /** 忽略指纹，全部文件重新解析 */
  full?: boolean
  /** 每处理一批文件前调用，返回 true 时尽快停止 */
  shouldCancel?: () => boolean
}

export interface ScanResult {
  ok: boolean
  scannedAt: string
  durationMs: number
  targetCount: number
  nightCount: number
  shotCount: number
  assetCount: number
  /** 因指纹未变化而跳过的文件数 */
  skipped: number
  cancelled?: boolean
  errorCount: number
  errors: string[]
}

interface ParsedName {
  date: string | null
  device: string | null
  seq: number | null
}

function parseFileName(fileName: string): ParsedName {
  const base = fileName.replace(/\.[^.]+$/, '')
  // 人工命名用 2026-08-06，Dwarf 原始帧用 20260806-203017
  const dateMatch =
    base.match(/(\d{4})-(\d{2})-(\d{2})/) ?? base.match(/(\d{4})(\d{2})(\d{2})-\d{2}/)
  const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : null
  const deviceMatch = base.match(/(DWARF\s*MINI|DWARFMINI|DWARF|CANON|PHONE)/i)
  let device: string | null = null
  if (deviceMatch) {
    const raw = deviceMatch[1].replace(/\s+/g, '').toUpperCase()
    device = raw === 'DWARF' ? 'DWARFMINI' : raw
  }
  const seqMatch = base.match(/(?:final|video|seq)[_-](\d+)/i)
  return { date, device, seq: seqMatch ? Number(seqMatch[1]) : null }
}

function parseTargetFolder(name: string) {
  const m = name.match(/^([A-Za-z]{1,4}\s?\d+)[_\-](.+)$/)
  if (m) return { catalogId: m[1].replace(/\s+/g, ''), nameCn: m[2].trim() }
  return { catalogId: name, nameCn: name }
}

async function listDirs(dir: string) {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

async function listFiles(dir: string) {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isFile()).map((e) => e.name)
  } catch {
    return []
  }
}

/** 递归列文件：同步进来的会话/拼图面板会在 原始 下多一层目录 */
async function listFilesDeep(
  dir: string,
  prefix = '',
  depth = 0
): Promise<Array<{ rel: string; abs: string }>> {
  if (depth > 4) return []
  let entries
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: Array<{ rel: string; abs: string }> = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const abs = path.join(dir, entry.name)
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (entry.name.toLowerCase() === 'thumbnail') continue
      out.push(...(await listFilesDeep(abs, rel, depth + 1)))
      continue
    }
    if (entry.isFile()) out.push({ rel, abs })
  }
  return out
}

function extOf(name: string) {
  return path.extname(name).toLowerCase()
}

/** 可用光帧：排除堆栈产物（stacked-16_*.fits）与失败帧（failed_*） */
function isLightFrame(rel: string) {
  const base = path.basename(rel).toLowerCase()
  if (!RAW_EXT.has(extOf(base))) return false
  return !base.startsWith('stacked') && !base.startsWith('failed_')
}

/** 同步会话目录名里的拍摄日期：DWARF_RAW_TELE_M 45_..._2026-10-06-23-12-30-313 */
function sessionDate(name: string) {
  const m = name.match(/(\d{4})-(\d{2})-(\d{2})-\d{2}-\d{2}-\d{2}/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

function readShotsInfo(dir: string): { exp?: string; target?: string } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'shotsInfo.json'), 'utf8'))
  } catch {
    return null
  }
}

function normalizeDateValue(raw: string): string | null {
  const m = raw.match(/(20\d{2})[-_.年/]?(\d{1,2})[-_.月/]?(\d{1,2})/)
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null
}

/** shotsInfo 的层级结构因固件版本而异，递归找日期字段 */
function findDateField(node: unknown, depth = 0): string | null {
  if (depth > 4 || !node || typeof node !== 'object') return null
  const KEYS = ['date', 'nightdate', 'sessiondate', 'starttime', 'capturetime', 'obsdate']
  const entries = Object.entries(node as Record<string, unknown>)
  for (const [key, value] of entries) {
    if (KEYS.includes(key.toLowerCase()) && (typeof value === 'string' || typeof value === 'number')) {
      const date = normalizeDateValue(String(value))
      if (date) return date
    }
  }
  for (const [, value] of entries) {
    const date = findDateField(value, depth + 1)
    if (date) return date
  }
  return null
}

function readShotsInfoDate(dir: string) {
  try {
    return findDateField(JSON.parse(fs.readFileSync(path.join(dir, 'shotsInfo.json'), 'utf8')))
  } catch {
    return null
  }
}

/** 会话文件夹名里的日期，如 M31_2026-11-21 */
function folderDate(name: string): string | null {
  const m = name.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

interface RawSessionInfo {
  date: string | null
  exposureS: number | null
}

/**
 * 按「原始」下的一级目录划分会话，为每个会话确定夜次日期。
 * 优先级：首帧 FITS DATE-OBS > shotsInfo.json > 文件夹名 > 目录 mtime。
 */
async function resolveRawSessions(
  rawDir: string,
  rawFiles: Array<{ rel: string; abs: string }>
): Promise<Map<string, RawSessionInfo>> {
  const groups = new Map<string, Array<{ rel: string; abs: string }>>()
  for (const file of rawFiles) {
    const key = file.rel.includes('/') ? file.rel.split('/')[0] : ''
    const list = groups.get(key) ?? []
    list.push(file)
    groups.set(key, list)
  }

  const out = new Map<string, RawSessionInfo>()
  for (const [key, files] of groups) {
    const sorted = [...files].sort((a, b) => a.rel.localeCompare(b.rel))
    let fitsDate: string | null = null
    let fitsExposure: number | null = null
    let checked = 0
    for (const file of sorted) {
      if (!isFitsFile(file.abs)) continue
      if (checked >= 3) break
      checked++
      const header = await readFitsHeader(file.abs)
      if (header?.exposureS != null && fitsExposure === null) fitsExposure = header.exposureS
      if (header?.nightDate) {
        fitsDate = header.nightDate
        break
      }
    }

    const sessionDir = key ? path.join(rawDir, key) : rawDir
    const infoDate = readShotsInfoDate(sessionDir)
    const nameDate = key ? sessionDate(key) ?? folderDate(key) : null
    let mtimeDate: string | null = null
    if (!fitsDate && !infoDate && !nameDate) {
      try {
        mtimeDate = dayKey((await fsp.stat(sessionDir)).mtimeMs)
      } catch {
        mtimeDate = null
      }
    }
    out.set(key, { date: fitsDate ?? infoDate ?? nameDate ?? mtimeDate, exposureS: fitsExposure })
  }
  return out
}

function relOf(root: string, abs: string) {
  return path.relative(root, abs).split(path.sep).join('/')
}

function dayKey(ms: number) {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 水印识别不可靠时进待确认；没有水印则视为正常 */
function reviewStateOf(watermark: WatermarkResult | null): 'ok' | 'pending' {
  if (!watermark) return 'ok'
  return watermark.needsReview || watermark.confidence < 60 ? 'pending' : 'ok'
}

/** OCR 失败不应中断扫描：语言包缺失或 worker 异常时按无识别处理 */
async function tryRecognize(file: string): Promise<WatermarkResult | null> {
  try {
    return await recognizeWatermarkCached(file)
  } catch {
    return null
  }
}

/**
 * 只读文件头给 exifr。Node 26 下 exifr 按路径解析会泄漏 FileHandle（GC 时报错），
 * 传 Buffer 可规避；EXIF 段位于文件开头，读 512KB 足够。
 */
const EXIF_HEAD_BYTES = 512 * 1024

export async function readFileHead(file: string, size = EXIF_HEAD_BYTES): Promise<Buffer> {
  const fh = await fsp.open(file, 'r')
  try {
    const buf = Buffer.alloc(size)
    const { bytesRead } = await fh.read(buf, 0, size, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

export class Scanner {
  private db: DB
  private root: string
  private thumbsDir: string
  private onProgress?: (p: ScanProgress) => void
  private shouldCancel?: () => boolean
  private prevShots = new Map<string, { bytes: number; mtime: number; frameCount: number; date: string | null }>()
  private prevAssets = new Map<string, { bytes: number; mtime: number }>()
  private skipped = 0

  constructor(db: DB, root: string, thumbsDir: string, onProgress?: (p: ScanProgress) => void) {
    this.db = db
    this.root = root
    this.thumbsDir = thumbsDir
    this.onProgress = onProgress
  }

  private progress(p: ScanProgress) {
    this.onProgress?.(p)
  }

  private isCancelled() {
    return this.shouldCancel?.() === true
  }

  private cancelledResult(started: number): ScanResult {
    this.progress({ phase: 'done', done: 1, total: 1 })
    return {
      ok: false,
      cancelled: true,
      scannedAt: nowIso(),
      durationMs: Date.now() - started,
      targetCount: 0,
      nightCount: 0,
      shotCount: 0,
      assetCount: 0,
      skipped: this.skipped,
      errorCount: 0,
      errors: ['扫描已取消']
    }
  }

  /** 读取上次扫描的文件指纹；全量扫描时留空。 */
  private loadFingerprints(full?: boolean) {
    this.prevShots.clear()
    this.prevAssets.clear()
    if (full) return
    const shots = this.db
      .prepare(
        `SELECT s.file_rel AS fileRel, s.bytes AS bytes, s.mtime AS mtime,
                s.frame_count AS frameCount, n.date AS date
         FROM shots s LEFT JOIN nights n ON n.id = s.night_id`
      )
      .all() as unknown as Array<{ fileRel: string; bytes: number; mtime: number; frameCount: number; date: string | null }>
    for (const row of shots) {
      this.prevShots.set(row.fileRel, {
        bytes: Number(row.bytes),
        mtime: Number(row.mtime),
        frameCount: Number(row.frameCount),
        date: row.date ?? null
      })
    }
    const assets = this.db.prepare('SELECT file_rel AS fileRel, bytes AS bytes, mtime AS mtime FROM assets').all() as unknown as Array<{
      fileRel: string
      bytes: number
      mtime: number
    }>
    for (const row of assets) {
      this.prevAssets.set(row.fileRel, { bytes: Number(row.bytes), mtime: Number(row.mtime) })
    }
  }

  async scan(options: ScanOptions = {}): Promise<ScanResult> {
    const started = Date.now()
    this.shouldCancel = options.shouldCancel
    this.skipped = 0
    this.loadFingerprints(options.full)
    const errors: string[] = []
    const seenShots = new Set<string>()
    const seenAssets = new Set<string>()
    const seenTargets = new Set<string>()
    let shotCount = 0
    let assetCount = 0

    if (!fs.existsSync(this.root)) {
      return {
        ok: false,
        scannedAt: nowIso(),
        durationMs: Date.now() - started,
        targetCount: 0,
        nightCount: 0,
        shotCount: 0,
        assetCount: 0,
        skipped: 0,
        errorCount: 1,
        errors: [`素材库不存在：${this.root}`]
      }
    }
    if (this.isCancelled()) return this.cancelledResult(started)

    // ---------- 深空 ----------
    const deepRoot = path.join(this.root, DEEP_DIR)
    const targetDirs = await listDirs(deepRoot)
    for (let i = 0; i < targetDirs.length; i++) {
      if (this.isCancelled()) return this.cancelledResult(started)
      const dirName = targetDirs[i]
      this.progress({ phase: 'deep_sky', done: i, total: targetDirs.length, label: dirName, stage: 'parse' })
      const abs = path.join(deepRoot, dirName)
      const rel = relOf(this.root, abs)
      const { catalogId, nameCn } = parseTargetFolder(dirName)
      seenTargets.add(catalogId)

      const targetId = this.upsertTarget(catalogId, nameCn, rel)

      // 统计原始帧数量（按日期前缀），会话子目录一并计入
      const rawDir = path.join(abs, '原始')
      const rawFiles = (await listFilesDeep(rawDir)).filter((f) => isLightFrame(f.rel))
      const rawSessions = await resolveRawSessions(rawDir, rawFiles)
      const sessionDates = [...new Set([...rawSessions.values()].map((s) => s.date).filter((d): d is string => !!d))].sort()
      const rawCountByDate = new Map<string, number>()
      let rawIndex = 0
      for (const f of rawFiles) {
        if (++rawIndex % 200 === 0 && this.isCancelled()) return this.cancelledResult(started)
        const sessionKey = f.rel.includes('/') ? f.rel.split('/')[0] : ''
        const parsed = parseFileName(path.basename(f.rel))
        const key = rawSessions.get(sessionKey)?.date ?? parsed.date ?? 'unknown'
        rawCountByDate.set(key, (rawCountByDate.get(key) ?? 0) + 1)
        const fileRel = relOf(this.root, f.abs)
        seenAssets.add(fileRel)
        try {
          const st = await fsp.stat(f.abs)
          const mtime = Math.round(st.mtimeMs)
          const prev = this.prevAssets.get(fileRel)
          if (prev && prev.bytes === st.size && prev.mtime === mtime) {
            assetCount++
            this.skipped++
            continue
          }
          this.upsertAsset(null, null, 'raw', fileRel, st.size, mtime)
          assetCount++
        } catch (err) {
          errors.push(`${fileRel}: ${(err as Error).message}`)
        }
      }

      // 处理目录：工程与中间文件
      const procDir = path.join(abs, '处理')
      for (const f of await listFiles(procDir)) {
        const ext = extOf(f)
        if (!IMAGE_EXT.has(ext) && !RAW_EXT.has(ext) && !['.psd', '.xcf', '.tif', '.tiff', '.dng', '.json'].includes(ext)) continue
        const fileAbs = path.join(procDir, f)
        const fileRel = relOf(this.root, fileAbs)
        seenAssets.add(fileRel)
        try {
          const st = await fsp.stat(fileAbs)
          const mtime = Math.round(st.mtimeMs)
          const prev = this.prevAssets.get(fileRel)
          if (prev && prev.bytes === st.size && prev.mtime === mtime) {
            assetCount++
            this.skipped++
            continue
          }
          this.upsertAsset(null, null, 'project', fileRel, st.size, mtime)
          assetCount++
        } catch (err) {
          errors.push(`${fileRel}: ${(err as Error).message}`)
        }
      }

      // 成片
      const finalDir = path.join(abs, '成片')
      const finalFiles = (await listFiles(finalDir)).filter((f) => IMAGE_EXT.has(extOf(f)))
      for (const f of finalFiles) {
        if (this.isCancelled()) return this.cancelledResult(started)
        const fileAbs = path.join(finalDir, f)
        const fileRel = relOf(this.root, fileAbs)
        seenShots.add(fileRel)
        try {
          const st = await fsp.stat(fileAbs)
          const parsed = parseFileName(f)
          // 夜次优先级：会话首帧 FITS > shotsInfo > 文件名 > 文件夹 > mtime
          let date: string | null = parsed.date
          let usedSessionDate = false
          if (sessionDates.length === 1) {
            date = sessionDates[0]
            usedSessionDate = true
          } else if (date && sessionDates.includes(date)) {
            usedSessionDate = true
          } else if (!date && sessionDates.length) {
            date = sessionDates[sessionDates.length - 1]
            usedSessionDate = true
          }
          if (!date) date = dayKey(st.mtimeMs)
          let frameCount = rawCountByDate.get(date) ?? 0
          const mtime = Math.round(st.mtimeMs)
          const prev = this.prevShots.get(fileRel)
          // 文件名/FITS/shotsInfo 已确定日期时，指纹未变即可整张跳过（省去 EXIF、缩略图与 OCR）
          if (
            (usedSessionDate || !!parsed.date) &&
            prev &&
            prev.bytes === st.size &&
            prev.mtime === mtime &&
            prev.frameCount === frameCount &&
            prev.date === date
          ) {
            shotCount++
            this.skipped++
            continue
          }
          this.progress({ phase: 'deep_sky', done: i, total: targetDirs.length, label: f, stage: 'thumb' })
          const exif = await this.readExif(fileAbs)
          const probe = await probeAndThumb(fileAbs, fileRel, st.mtimeMs, st.size, this.thumbsDir)
          // 无原始帧时用成片水印补总曝光与夜次；有原始帧则以帧数推算为准
          let watermark: WatermarkResult | null = null
          if (frameCount === 0) {
            this.progress({ phase: 'deep_sky', done: i, total: targetDirs.length, label: f, stage: 'watermark' })
            watermark = await tryRecognize(fileAbs)
          }
          if (!usedSessionDate && !parsed.date && watermark?.nightDate) {
            date = watermark.nightDate
            frameCount = rawCountByDate.get(date) ?? 0
          }
          const nightId = this.upsertNight(date, 'deep_sky', '', null, null)
          const exposure = exif.exposure_s ?? null
          const watermarkTotal = frameCount === 0 && watermark?.exposureMinutes ? watermark.exposureMinutes * 60 : null
          const totalExposure = watermarkTotal ?? (exposure ? exposure * (frameCount || 1) : 0)
          const exposureSource = watermarkTotal != null ? 'watermark' : exposure ? (frameCount ? 'frames' : 'exif') : null
          const watermarkInfo = watermark?.hasBar ? watermark : null

          this.upsertShot({
            nightId,
            targetId,
            subType: null,
            fileRel,
            fileName: f,
            ext: extOf(f),
            bytes: st.size,
            width: probe?.width ?? exif.width ?? null,
            height: probe?.height ?? exif.height ?? null,
            capturedAt: exif.captured_at ?? (date ? `${date}T00:00:00` : null),
            device: parsed.device,
            cameraModel: exif.camera_model ?? null,
            lens: exif.lens ?? null,
            exposureS: exposure,
            iso: exif.iso ?? null,
            fNumber: exif.f_number ?? null,
            frameCount,
            totalExposureS: totalExposure,
            exposureSource,
            watermarkText: watermarkInfo?.rawText.slice(0, 4000) ?? null,
            reviewState: reviewStateOf(watermarkInfo),
            ar: probe?.ar ?? 1,
            stripRatio: probe?.stripRatio ?? 0,
            mtime: Math.round(st.mtimeMs),
            isFinal: 1
          })
          shotCount++
        } catch (err) {
          errors.push(`${fileRel}: ${(err as Error).message}`)
        }
      }

      // 原始 下由同步归档的会话：stacked.jpg 是设备的堆栈成果，作为当次拍摄的成片
      for (const sessName of await listDirs(rawDir)) {
        const sessAbs = path.join(rawDir, sessName)
        const stackAbs = path.join(sessAbs, 'stacked.jpg')
        if (!fs.existsSync(stackAbs)) continue
        const fileRel = relOf(this.root, stackAbs)
        seenShots.add(fileRel)
        try {
          const st = await fsp.stat(stackAbs)
          const session = rawSessions.get(sessName)
          const baseDate = session?.date ?? sessionDate(sessName) ?? folderDate(sessName)
          let date = baseDate ?? dayKey(st.mtimeMs)
          const frames = (await listFilesDeep(sessAbs)).filter((f) => isLightFrame(f.rel)).length
          const mtime = Math.round(st.mtimeMs)
          const prev = this.prevShots.get(fileRel)
          if (
            baseDate &&
            prev &&
            prev.bytes === st.size &&
            prev.mtime === mtime &&
            prev.frameCount === frames &&
            prev.date === date
          ) {
            shotCount++
            this.skipped++
            continue
          }
          this.progress({ phase: 'deep_sky', done: i, total: targetDirs.length, label: sessName, stage: 'thumb' })
          const probe = await probeAndThumb(stackAbs, fileRel, st.mtimeMs, st.size, this.thumbsDir)
          const info = readShotsInfo(sessAbs)
          const exposure = info?.exp ? Number(info.exp) : session?.exposureS ?? null
          let watermark: WatermarkResult | null = null
          if (frames === 0) {
            this.progress({ phase: 'deep_sky', done: i, total: targetDirs.length, label: sessName, stage: 'watermark' })
            watermark = await tryRecognize(stackAbs)
          }
          if (!baseDate && watermark?.nightDate) date = watermark.nightDate
          const nightId = this.upsertNight(date, 'deep_sky', '', null, null)
          const watermarkTotal = frames === 0 && watermark?.exposureMinutes ? watermark.exposureMinutes * 60 : null
          const watermarkInfo = watermark?.hasBar ? watermark : null
          this.upsertShot({
            nightId,
            targetId,
            subType: null,
            fileRel,
            fileName: `${catalogId}_${date}_stacked.jpg`,
            ext: '.jpg',
            bytes: st.size,
            width: probe?.width ?? null,
            height: probe?.height ?? null,
            capturedAt: `${date}T00:00:00`,
            device: 'DWARFMINI',
            cameraModel: null,
            lens: null,
            exposureS: exposure,
            iso: null,
            fNumber: null,
            frameCount: frames,
            totalExposureS: watermarkTotal ?? (exposure ? exposure * frames : 0),
            exposureSource: watermarkTotal != null ? 'watermark' : exposure ? (frames ? 'frames' : 'exif') : null,
            watermarkText: watermarkInfo?.rawText.slice(0, 4000) ?? null,
            reviewState: reviewStateOf(watermarkInfo),
            ar: probe?.ar ?? 1,
            stripRatio: probe?.stripRatio ?? 0,
            mtime: Math.round(st.mtimeMs),
            isFinal: 1
          })
          shotCount++
        } catch (err) {
          errors.push(`${fileRel}: ${(err as Error).message}`)
        }
      }
    }

    // ---------- 星野 ----------
    const nightRoot = path.join(this.root, NIGHT_DIR)
    for (const type of NIGHT_TYPES) {
      if (this.isCancelled()) return this.cancelledResult(started)
      const typeDir = path.join(nightRoot, type)
      const capDirs = await listDirs(typeDir)
      for (let i = 0; i < capDirs.length; i++) {
        if (this.isCancelled()) return this.cancelledResult(started)
        const capName = capDirs[i]
        const abs = path.join(typeDir, capName)
        const rel = relOf(this.root, abs)
        this.progress({ phase: 'nightscape', done: i, total: capDirs.length, label: `${type}/${capName}`, stage: 'parse' })

        const m = capName.match(/^(\d{4}-\d{2}-\d{2})[_-](.+)$/)
        let date = m?.[1] ?? null
        let location = m?.[2]?.trim() || '未标注'
        if (!date) {
          try {
            const st = await fsp.stat(abs)
            date = dayKey(st.mtimeMs)
          } catch {
            date = dayKey(Date.now())
          }
          location = '未标注'
        }

        const nightId = this.upsertNight(date, 'nightscape', type, location, rel)
        const files = await listFiles(abs)
        for (const f of files) {
          if (this.isCancelled()) return this.cancelledResult(started)
          const ext = extOf(f)
          const fileAbs = path.join(abs, f)
          const fileRel = relOf(this.root, fileAbs)
          try {
            const st = await fsp.stat(fileAbs)
            const mtime = Math.round(st.mtimeMs)
            if (VIDEO_EXT.has(ext)) {
              seenAssets.add(fileRel)
              const prev = this.prevAssets.get(fileRel)
              if (prev && prev.bytes === st.size && prev.mtime === mtime) {
                assetCount++
                this.skipped++
                continue
              }
              this.upsertAsset(null, nightId, 'video', fileRel, st.size, mtime)
              assetCount++
              continue
            }
            if (!IMAGE_EXT.has(ext)) continue
            seenShots.add(fileRel)
            const prev = this.prevShots.get(fileRel)
            if (prev && prev.bytes === st.size && prev.mtime === mtime && prev.date === date) {
              shotCount++
              this.skipped++
              continue
            }
            this.progress({ phase: 'nightscape', done: i, total: capDirs.length, label: f, stage: 'thumb' })
            const parsed = parseFileName(f)
            const exif = await this.readExif(fileAbs)
            const probe = await probeAndThumb(fileAbs, fileRel, st.mtimeMs, st.size, this.thumbsDir)
            this.upsertShot({
              nightId,
              targetId: null,
              subType: type,
              fileRel,
              fileName: f,
              ext,
              bytes: st.size,
              width: probe?.width ?? exif.width ?? null,
              height: probe?.height ?? exif.height ?? null,
              capturedAt: exif.captured_at ?? (date ? `${date}T00:00:00` : null),
              device: parsed.device,
              cameraModel: exif.camera_model ?? null,
              lens: exif.lens ?? null,
              exposureS: exif.exposure_s ?? null,
              iso: exif.iso ?? null,
              fNumber: exif.f_number ?? null,
              frameCount: 1,
              totalExposureS: exif.exposure_s ?? 0,
              ar: probe?.ar ?? 1,
              stripRatio: probe?.stripRatio ?? 0,
              mtime: Math.round(st.mtimeMs),
              isFinal: 1
            })
            shotCount++
          } catch (err) {
            errors.push(`${fileRel}: ${(err as Error).message}`)
          }
        }
      }
    }

    // ---------- 清理消失的文件 ----------
    if (errors.length === 0) {
      const shotRows = this.db.prepare('SELECT id, file_rel FROM shots').all() as Array<{ id: number; file_rel: string }>
      for (const row of shotRows) {
        if (!seenShots.has(row.file_rel)) {
          this.db.prepare('DELETE FROM shots WHERE id = ?').run(row.id)
          this.db.prepare('DELETE FROM shot_tags WHERE shot_id = ?').run(row.id)
          this.db.prepare('DELETE FROM version_sources WHERE version_shot_id = ?').run(row.id)
        }
      }
      const assetRows = this.db.prepare('SELECT id, file_rel FROM assets').all() as Array<{ id: number; file_rel: string }>
      for (const row of assetRows) {
        if (!seenAssets.has(row.file_rel)) this.db.prepare('DELETE FROM assets WHERE id = ?').run(row.id)
      }
      const targetRows = this.db.prepare('SELECT id, catalog_id FROM targets').all() as Array<{ id: number; catalog_id: string }>
      for (const row of targetRows) {
        if (!seenTargets.has(row.catalog_id)) {
          const left = this.db.prepare('SELECT COUNT(*) AS c FROM shots WHERE target_id = ?').get(row.id) as { c: number }
          if (Number(left.c) === 0) this.db.prepare('DELETE FROM targets WHERE id = ?').run(row.id)
        }
      }
      // 清理没有任何作品与素材的夜次
      this.db.exec(`
        DELETE FROM nights
        WHERE id NOT IN (SELECT night_id FROM shots WHERE night_id IS NOT NULL)
          AND id NOT IN (SELECT night_id FROM assets WHERE night_id IS NOT NULL)
      `)
    }

    // 取消后不执行清理，避免半途删除旧记录
    if (this.isCancelled()) return this.cancelledResult(started)
    this.recalcNightExposure()

    const scannedAt = nowIso()
    setSetting(this.db, 'last_scan_at', scannedAt)

    const targetCount = Number((this.db.prepare('SELECT COUNT(*) AS c FROM targets').get() as { c: number }).c)
    const nightCount = Number((this.db.prepare('SELECT COUNT(*) AS c FROM nights').get() as { c: number }).c)

    this.progress({ phase: 'done', done: 1, total: 1 })

    return {
      ok: errors.length === 0,
      scannedAt,
      durationMs: Date.now() - started,
      targetCount,
      nightCount,
      shotCount,
      assetCount,
      skipped: this.skipped,
      errorCount: errors.length,
      errors: errors.slice(0, 20)
    }
  }

  private recalcNightExposure() {
    // 同一目标同一夜可能有多个成片，取该目标该夜的最大累计曝光，避免重复相加
    this.db.exec(`
      UPDATE nights SET total_exposure_s = COALESCE((
        SELECT SUM(t.total_s) FROM (
          SELECT MAX(s.total_exposure_s) AS total_s
          FROM shots s
          WHERE s.night_id = nights.id
          GROUP BY s.target_id, s.sub_type
        ) t
      ), 0)
    `)
  }

  private async readExif(absPath: string) {
    try {
      const data = await exifr.parse(await readFileHead(absPath), {
        pick: [
          'DateTimeOriginal',
          'ExposureTime',
          'ISO',
          'FNumber',
          'Make',
          'Model',
          'LensModel',
          'ImageWidth',
          'ImageHeight'
        ]
      })
      if (!data) return this.emptyExif()
      const camera = [data.Make, data.Model].filter(Boolean).join(' ').trim()
      return {
        captured_at: data.DateTimeOriginal ? new Date(data.DateTimeOriginal).toISOString() : null,
        exposure_s: typeof data.ExposureTime === 'number' ? data.ExposureTime : null,
        iso: typeof data.ISO === 'number' ? data.ISO : null,
        f_number: typeof data.FNumber === 'number' ? data.FNumber : null,
        camera_model: camera || null,
        lens: data.LensModel ?? null,
        width: typeof data.ImageWidth === 'number' ? data.ImageWidth : null,
        height: typeof data.ImageHeight === 'number' ? data.ImageHeight : null
      }
    } catch {
      return this.emptyExif()
    }
  }

  private emptyExif() {
    return {
      captured_at: null as string | null,
      exposure_s: null as number | null,
      iso: null as number | null,
      f_number: null as number | null,
      camera_model: null as string | null,
      lens: null as string | null,
      width: null as number | null,
      height: null as number | null
    }
  }

  private upsertTarget(catalogId: string, nameCn: string, folderRel: string) {
    const now = nowIso()
    this.db
      .prepare(
        `INSERT INTO targets(catalog_id, name_cn, folder_rel, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(catalog_id) DO UPDATE SET
           name_cn = excluded.name_cn,
           folder_rel = excluded.folder_rel,
           updated_at = excluded.updated_at`
      )
      .run(catalogId, nameCn, folderRel, now, now)
    this.fillTargetProfile(catalogId)
    const row = this.db.prepare('SELECT id FROM targets WHERE catalog_id = ?').get(catalogId) as { id: number }
    return row.id
  }

  /** 用内置资料补齐天体名片；只填空字段，且手工编辑过的目标完全跳过 */
  private fillTargetProfile(catalogId: string) {
    const p = builtinProfile(catalogId)
    if (!p) return
    const now = nowIso()
    this.db
      .prepare(
        `UPDATE targets SET
           name_en = CASE WHEN COALESCE(name_en, '') = '' THEN ? ELSE name_en END,
           alias = CASE WHEN COALESCE(alias, '') = '' THEN ? ELSE alias END,
           object_type = CASE WHEN COALESCE(object_type, '') = '' THEN ? ELSE object_type END,
           constellation = CASE WHEN COALESCE(constellation, '') = '' THEN ? ELSE constellation END,
           distance_ly = COALESCE(distance_ly, ?),
           magnitude = COALESCE(magnitude, ?),
           description = CASE WHEN COALESCE(description, '') = '' THEN ? ELSE description END,
           source = CASE WHEN COALESCE(source, '') = '' THEN ? ELSE source END,
           profile_updated_at = CASE WHEN COALESCE(profile_updated_at, '') = '' THEN ? ELSE profile_updated_at END,
           updated_at = ?
         WHERE catalog_id = ? AND profile_edited = 0`
      )
      .run(
        p.nameEn,
        p.alias,
        p.objectType,
        p.constellation,
        p.distanceLy,
        p.magnitude,
        p.description,
        '内置天体库',
        now,
        now,
        catalogId
      )
  }

  private upsertNight(date: string, category: 'deep_sky' | 'nightscape', subType: string, location: string | null, folderRel: string | null) {
    const now = nowIso()
    this.db
      .prepare(
        `INSERT INTO nights(date, category, sub_type, location, folder_rel, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(date, category, sub_type) DO UPDATE SET
           folder_rel = excluded.folder_rel,
           location = COALESCE(nights.location, excluded.location),
           updated_at = excluded.updated_at`
      )
      .run(date, category, subType, location, folderRel, now, now)
    const row = this.db
      .prepare('SELECT id FROM nights WHERE date = ? AND category = ? AND sub_type = ?')
      .get(date, category, subType) as { id: number }
    return row.id
  }

  private upsertAsset(
    shotId: number | null,
    nightId: number | null,
    kind: string,
    fileRel: string,
    bytes: number,
    mtime: number
  ) {
    const now = nowIso()
    this.db
      .prepare(
        `INSERT INTO assets(shot_id, night_id, kind, file_rel, bytes, mtime, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(file_rel) DO UPDATE SET
           shot_id = excluded.shot_id,
           night_id = excluded.night_id,
           kind = excluded.kind,
           bytes = excluded.bytes,
           mtime = excluded.mtime`
      )
      .run(shotId, nightId, kind, fileRel, bytes, mtime, now)
  }

  private upsertShot(s: {
    nightId: number
    targetId: number | null
    subType: string | null
    fileRel: string
    fileName: string
    ext: string
    bytes: number
    width: number | null
    height: number | null
    capturedAt: string | null
    device: string | null
    cameraModel: string | null
    lens: string | null
    exposureS: number | null
    iso: number | null
    fNumber: number | null
    frameCount: number
    totalExposureS: number
    exposureSource?: string | null
    watermarkText?: string | null
    reviewState?: string
    ar: number
    stripRatio: number
    mtime: number
    isFinal: number
  }) {
    const now = nowIso()
    const version = this.nextVersionNumber(s.targetId, s.nightId)
    this.db
      .prepare(
        `INSERT INTO shots(
          night_id, target_id, sub_type, file_rel, file_name, ext, bytes, width, height,
          captured_at, device, camera_model, lens, exposure_s, iso, f_number,
          frame_count, total_exposure_s, exposure_source, watermark_text, review_state, ar, strip_ratio, mtime, is_final,
          version_no, version_order, created_at, updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_rel) DO UPDATE SET
          night_id = excluded.night_id,
          target_id = excluded.target_id,
          sub_type = excluded.sub_type,
          file_name = excluded.file_name,
          ext = excluded.ext,
          bytes = excluded.bytes,
          width = excluded.width,
          height = excluded.height,
          captured_at = excluded.captured_at,
          device = excluded.device,
          camera_model = excluded.camera_model,
          lens = excluded.lens,
          exposure_s = excluded.exposure_s,
          iso = excluded.iso,
          f_number = excluded.f_number,
          frame_count = excluded.frame_count,
          total_exposure_s = CASE WHEN shots.exposure_source = 'manual' THEN shots.total_exposure_s ELSE excluded.total_exposure_s END,
          exposure_source = CASE WHEN shots.exposure_source = 'manual' THEN 'manual' ELSE excluded.exposure_source END,
          watermark_text = excluded.watermark_text,
          review_state = CASE WHEN shots.review_state = 'manual' THEN 'manual' ELSE excluded.review_state END,
          ar = excluded.ar,
          strip_ratio = excluded.strip_ratio,
          mtime = excluded.mtime,
          updated_at = excluded.updated_at`
      )
      .run(
        s.nightId,
        s.targetId,
        s.subType,
        s.fileRel,
        s.fileName,
        s.ext,
        s.bytes,
        s.width,
        s.height,
        s.capturedAt,
        s.device,
        s.cameraModel,
        s.lens,
        s.exposureS,
        s.iso,
        s.fNumber,
        s.frameCount,
        s.totalExposureS,
        s.exposureSource ?? null,
        s.watermarkText ?? null,
        s.reviewState ?? 'ok',
        s.ar,
        s.stripRatio,
        s.mtime,
        s.isFinal,
        version.no,
        version.order,
        now,
        now
      )
    if (s.isFinal && s.nightId) {
      const row = this.db.prepare('SELECT id FROM shots WHERE file_rel = ?').get(s.fileRel) as { id: number } | undefined
      if (row) {
        this.db
          .prepare('INSERT OR IGNORE INTO version_sources(version_shot_id, night_id) VALUES(?, ?)')
          .run(row.id, s.nightId)
      }
    }
  }

  /** 同目标同夜次自动编号，重扫不覆盖已有版本字段 */
  private nextVersionNumber(targetId: number | null, nightId: number | null) {
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(version_no), 0) + 1 AS no, COALESCE(MAX(version_order), 0) + 1 AS ord
         FROM shots WHERE is_final = 1 AND target_id IS ? AND night_id IS ?`
      )
      .get(targetId, nightId) as { no: number; ord: number } | undefined
    return { no: Number(row?.no ?? 1), order: Number(row?.ord ?? 1) }
  }
}

export { IMAGE_EXT, RAW_EXT, VIDEO_EXT }
