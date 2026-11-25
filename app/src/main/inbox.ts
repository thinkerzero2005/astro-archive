import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import exifr from 'exifr'
import { DB } from './db'
import { logChange, moveFile, sanitizeSegment, uniquePath, uniqueFilePath } from './files'
import { IMAGE_EXT, RAW_EXT, VIDEO_EXT, readFileHead } from './scanner'
import { recognizeWatermarkCached } from './watermark'

const INBOX_DIR = '_收件箱'
const DEFER_DIR = '_暂不整理'
const DEEP_DIR = '01_深空'
const NIGHT_DIR = '02_星野'

const SUPPORTED_EXT = new Set([...IMAGE_EXT, ...RAW_EXT, ...VIDEO_EXT])

export type InboxCategory = 'deep_sky' | '银河' | '星轨' | '延时' | '其他'

const NIGHT_TYPE_BY_CODE: Record<string, InboxCategory> = {
  MW: '银河',
  STARTRAIL: '星轨',
  TIMELAPSE: '延时'
}

const PREVIEW_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'])

type DateSource = 'name' | 'folder' | 'exif' | 'mtime'

export interface InboxOverride {
  relPath: string
  category: InboxCategory | null
  date?: string | null
  code?: string | null
  location?: string | null
}

export interface InboxResolved {
  destRel: string | null
  valid: boolean
  error: string | null
  conflict: boolean
}

export interface InboxFileItem extends InboxResolved {
  relPath: string
  fileName: string
  ext: string
  bytes: number
  mtime: number
  previewUrl: string | null
  date: string | null
  dateSource: DateSource | null
  category: InboxCategory | null
  code: string | null
  location: string | null
  device: string | null
  kind: string | null
  seq: number | null
  reason: string | null
}

export interface InboxListing {
  ok: boolean
  inboxPath: string
  libraryRoot: string
  files: InboxFileItem[]
  error: string | null
}

export interface InboxImportResult {
  ok: boolean
  moved: number
  errors: string[]
  moves: Array<{ fromRel: string; toRel: string }>
}

function toRel(root: string, abs: string) {
  return path.relative(root, abs).split(path.sep).join('/')
}

function dayKey(ms: number) {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function normalizeCode(raw: string) {
  const compact = raw.replace(/[\s-]/g, '').toUpperCase()
  return /^(?:M|IC|NGC|SH2|LDN|LBN|B|C|ABELL|VDB|CED)\d+[A-Z]?$/.test(compact) ? compact : ''
}

function isCatalogCode(code: string | null): code is string {
  return !!code && normalizeCode(code) === code && !NIGHT_TYPE_BY_CODE[code]
}

interface ParsedName {
  date: string | null
  code: string | null
  device: string | null
  kind: string | null
  seq: number | null
}

function findCode(base: string, parts: string[]): string | null {
  for (const part of parts) {
    const up = part.replace(/[\s-]/g, '').toUpperCase()
    if (NIGHT_TYPE_BY_CODE[up]) return up
    const catalog = normalizeCode(part)
    if (catalog) return catalog
  }
  const compact = base.toUpperCase()
  if (compact.includes('STARTRAIL')) return 'STARTRAIL'
  if (compact.includes('TIMELAPSE')) return 'TIMELAPSE'
  if (/(?:^|[^A-Z])MW(?:[^A-Z]|$)/.test(compact)) return 'MW'
  for (const candidate of compact.match(/[A-Z]{1,6}\d+[A-Z]?/g) ?? []) {
    const catalog = normalizeCode(candidate)
    if (catalog) return catalog
  }
  return null
}

function parseName(fileName: string): ParsedName {
  const base = fileName.replace(/\.[^.]+$/, '')
  const parts = base.split(/[\s_]+/).filter(Boolean)
  const dateMatch = base.match(/(20\d{2})-(\d{2})-(\d{2})/)
  const deviceMatch = base.match(/(DWARFMINI|DWARF|CANON\d*(?:MM)?|NIKON|SONY|PHONE)/i)
  const kindMatch = base.match(/(?:^|_)(final|frames|clip)(?:_|$)/i)
  const seqMatch = base.match(/(?:final|frames|clip)[_-](\d+)/i)
  return {
    date: dateMatch ? dateMatch[0] : null,
    code: findCode(base, parts),
    device: deviceMatch ? deviceMatch[1].replace(/[\s-]/g, '').toUpperCase() : null,
    kind: kindMatch ? kindMatch[1].toLowerCase() : null,
    seq: seqMatch ? Number(seqMatch[1]) : null
  }
}

function folderHints(relPath: string) {
  const folders = relPath.split('/').slice(1, -1)
  for (const folder of [...folders].reverse()) {
    const m = folder.match(/^(20\d{2}-\d{2}-\d{2})[_\-\s]*(.*)$/)
    if (m) return { date: m[1], location: m[2].trim() || null }
  }
  const last = folders[folders.length - 1]
  return { date: null, location: last && !/^\d+$/.test(last) ? last : null }
}

function categoryFromFolders(relPath: string): InboxCategory | null {
  for (const seg of relPath.split('/')) {
    if (seg === '深空') return 'deep_sky'
    if (seg === '银河' || seg === '星轨' || seg === '延时') return seg
  }
  return null
}

async function exifDate(absPath: string): Promise<string | null> {
  try {
    const data = await exifr.parse(await readFileHead(absPath), { pick: ['DateTimeOriginal'] })
    const value = data?.DateTimeOriginal
    if (!value) return null
    return new Date(value).toISOString().slice(0, 10)
  } catch {
    return null
  }
}

function existingTargetFolder(db: DB, root: string, code: string) {
  const row = db.prepare('SELECT folder_rel FROM targets WHERE catalog_id = ?').get(code) as
    | { folder_rel: string }
    | undefined
  if (row && fs.existsSync(path.join(root, row.folder_rel))) return row.folder_rel
  try {
    const dir = path.join(root, DEEP_DIR)
    const hit = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .find((name) => name === code || name.startsWith(`${code}_`))
    if (hit) return `${DEEP_DIR}/${hit}`
  } catch {
    /* 目录不存在时使用默认命名 */
  }
  return `${DEEP_DIR}/${code}_待命名`
}

function resolveDest(db: DB, root: string, item: InboxOverride): InboxResolved {
  const relPath = String(item.relPath ?? '').replace(/\\/g, '/')
  if (!relPath.startsWith(`${INBOX_DIR}/`) || relPath.includes('..')) {
    return { destRel: null, valid: false, error: '路径不合法', conflict: false }
  }
  const fileName = path.basename(relPath)
  if (!item.category) {
    return { destRel: null, valid: false, error: '请选择分类', conflict: false }
  }
  if (item.category !== 'deep_sky' && !['银河', '星轨', '延时', '其他'].includes(item.category)) {
    return { destRel: null, valid: false, error: '分类不合法', conflict: false }
  }

  if (item.category === 'deep_sky') {
    const code = normalizeCode(String(item.code ?? ''))
    if (!code) {
      return { destRel: null, valid: false, error: '请填写目标编号（如 M31 / IC434）', conflict: false }
    }
    const destRel = `${existingTargetFolder(db, root, code)}/成片/${fileName}`
    return { destRel, valid: true, error: null, conflict: fs.existsSync(path.join(root, destRel)) }
  }

  const date = String(item.date ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { destRel: null, valid: false, error: '请填写拍摄日期', conflict: false }
  }
  const location = sanitizeSegment(String(item.location ?? '').trim() || '未标注')
  const destRel = `${NIGHT_DIR}/${item.category}/${date}_${location}/${fileName}`
  return { destRel, valid: true, error: null, conflict: fs.existsSync(path.join(root, destRel)) }
}

async function collectFiles(dir: string, depth: number, out: string[], skipTopLevel?: Set<string>) {
  if (depth > 4) return
  let entries: fs.Dirent[]
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (depth === 0 && skipTopLevel?.has(entry.name)) continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectFiles(abs, depth + 1, out)
      continue
    }
    if (!entry.isFile()) continue
    const lower = entry.name.toLowerCase()
    if (lower === 'thumbs.db' || lower === 'desktop.ini') continue
    const ext = path.extname(entry.name).toLowerCase()
    if (!IMAGE_EXT.has(ext) && !RAW_EXT.has(ext) && !VIDEO_EXT.has(ext)) continue
    out.push(abs)
  }
}

export async function listInbox(db: DB, root: string): Promise<InboxListing> {
  const inboxPath = path.join(root, INBOX_DIR)
  if (!fs.existsSync(inboxPath)) {
    return { ok: true, inboxPath, libraryRoot: root, files: [], error: null }
  }

  const absFiles: string[] = []
  await collectFiles(inboxPath, 0, absFiles, new Set([DEFER_DIR]))

  const files: InboxFileItem[] = []
  for (const abs of absFiles) {
    let st: fs.Stats
    try {
      st = await fsp.stat(abs)
    } catch {
      continue
    }
    const relPath = toRel(root, abs)
    const fileName = path.basename(abs)
    const ext = path.extname(fileName).toLowerCase()
    const parsed = parseName(fileName)
    const hints = folderHints(relPath)

    let date = parsed.date ?? hints.date
    let dateSource: DateSource | null = parsed.date ? 'name' : hints.date ? 'folder' : null
    if (!date && (IMAGE_EXT.has(ext) || RAW_EXT.has(ext))) {
      date = await exifDate(abs)
      if (date) dateSource = 'exif'
    }
    if (!date) {
      date = dayKey(st.mtimeMs)
      dateSource = 'mtime'
    }

    let category: InboxCategory | null = parsed.code ? NIGHT_TYPE_BY_CODE[parsed.code] ?? null : null
    if (!category && isCatalogCode(parsed.code)) category = 'deep_sky'
    if (!category) category = categoryFromFolders(relPath)
    if (!category && VIDEO_EXT.has(ext)) category = '延时'

    const code = isCatalogCode(parsed.code) ? parsed.code : null
    const location = hints.location ?? null
    const reason = category
      ? null
      : '未识别目标，请选择分类并补全目标编号或地点'

    const resolved = resolveDest(db, root, { relPath, category, date, code, location })
    files.push({
      relPath,
      fileName,
      ext,
      bytes: st.size,
      mtime: Math.round(st.mtimeMs),
      previewUrl: PREVIEW_EXT.has(ext) ? `astro://local/${encodeURIComponent(abs)}` : null,
      date,
      dateSource,
      category,
      code,
      location,
      device: parsed.device,
      kind: parsed.kind,
      seq: parsed.seq,
      reason,
      ...resolved
    })
  }

  files.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || a.fileName.localeCompare(b.fileName, 'zh-CN'))
  return { ok: true, inboxPath, libraryRoot: root, files, error: null }
}

export function previewInbox(db: DB, root: string, items: InboxOverride[]) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    relPath: String(item.relPath ?? ''),
    ...resolveDest(db, root, item)
  }))
}

const OCR_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif'])

export interface InboxRecognition {
  relPath: string
  hasBar: boolean
  targetRaw: string | null
  catalogId: string | null
  exposureMinutes: number | null
  exposureRaw: string | null
  endedAt: string | null
  nightDate: string | null
  rigName: string | null
  confidence: number
  needsReview: boolean
  reason: string | null
}

export async function recognizeInbox(root: string, relPaths: string[]): Promise<InboxRecognition[]> {
  const results: InboxRecognition[] = []
  for (const raw of Array.isArray(relPaths) ? relPaths : []) {
    const relPath = String(raw ?? '').replace(/\\/g, '/')
    if (!relPath.startsWith(`${INBOX_DIR}/`) || relPath.includes('..')) continue
    if (!OCR_EXT.has(path.extname(relPath).toLowerCase())) continue
    const abs = path.join(root, relPath)
    if (!fs.existsSync(abs)) continue
    const base: InboxRecognition = {
      relPath,
      hasBar: false,
      targetRaw: null,
      catalogId: null,
      exposureMinutes: null,
      exposureRaw: null,
      endedAt: null,
      nightDate: null,
      rigName: null,
      confidence: 0,
      needsReview: true,
      reason: '识别失败'
    }
    try {
      const r = await recognizeWatermarkCached(abs)
      results.push({
        ...base,
        hasBar: r.hasBar,
        targetRaw: r.targetRaw,
        catalogId: r.catalogId,
        exposureMinutes: r.exposureMinutes,
        exposureRaw: r.exposureRaw,
        endedAt: r.endedAt,
        nightDate: r.nightDate,
        rigName: r.rigName,
        confidence: r.confidence,
        needsReview: r.needsReview,
        reason: r.reason
      })
    } catch (err) {
      results.push({ ...base, reason: `识别失败：${(err as Error).message}` })
    }
  }
  return results
}

function ensureDir(absDir: string, root: string, created: Set<string>) {
  if (fs.existsSync(absDir)) return
  const missing: string[] = []
  let cur = absDir
  while (!fs.existsSync(cur)) {
    missing.push(cur)
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  fs.mkdirSync(absDir, { recursive: true })
  for (const dir of missing) created.add(toRel(root, dir))
}

export function importInboxFiles(db: DB, root: string, items: InboxOverride[]): InboxImportResult {
  const moves: Array<{ fromRel: string; toRel: string }> = []
  const errors: string[] = []
  const createdDirs = new Set<string>()

  for (const item of Array.isArray(items) ? items : []) {
    const sourceRel = String(item.relPath ?? '').replace(/\\/g, '/')
    const resolved = resolveDest(db, root, item)
    if (!resolved.valid || !resolved.destRel) {
      errors.push(`${path.basename(sourceRel) || sourceRel}：${resolved.error ?? '无法归档'}`)
      continue
    }
    const fromAbs = path.join(root, sourceRel)
    if (!fs.existsSync(fromAbs)) {
      errors.push(`${path.basename(sourceRel)}：源文件不存在`)
      continue
    }
    try {
      const destAbs = uniqueFilePath(path.join(root, resolved.destRel))
      ensureDir(path.dirname(destAbs), root, createdDirs)
      moveFile(fromAbs, destAbs)
      moves.push({ fromRel: sourceRel, toRel: toRel(root, destAbs) })
    } catch (err) {
      errors.push(`${path.basename(sourceRel)}：${(err as Error).message}`)
    }
  }

  if (moves.length) {
    logChange(db, 'import_files', 'inbox', null, { items: moves, createdDirs: [...createdDirs] })
    pruneEmptyDirs(path.join(root, INBOX_DIR))
  }

  return { ok: errors.length === 0, moved: moves.length, errors: errors.slice(0, 20), moves }
}

export interface InboxStageProgress {
  done: number
  total: number
  label: string
}

export interface InboxStageResult {
  ok: boolean
  batchRel: string | null
  copied: number
  skipped: Array<{ fileName: string; reason: string }>
  errors: string[]
}

export interface InboxDeferredItem {
  relPath: string
  fileName: string
  ext: string
  bytes: number
  mtime: number
}

interface SourceEntry {
  abs: string
  rel: string
}

function insideDir(dir: string, target: string) {
  const rel = path.relative(dir, target)
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function dedupeKey(name: string, size: number, mtimeMs: number) {
  return `${name.toLowerCase()}|${size}|${Math.round(mtimeMs / 1000)}`
}

function indexSupported(dir: string, depth: number, index: Map<string, string>) {
  if (depth > 8) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      indexSupported(abs, depth + 1, index)
      continue
    }
    if (!entry.isFile() || !SUPPORTED_EXT.has(path.extname(entry.name).toLowerCase())) continue
    try {
      const st = fs.statSync(abs)
      index.set(dedupeKey(entry.name, st.size, st.mtimeMs), abs)
    } catch {
      /* 单个文件读取失败不影响去重索引 */
    }
  }
}

function walkSource(abs: string, rel: string, depth: number, out: SourceEntry[]) {
  let st: fs.Stats
  try {
    st = fs.statSync(abs)
  } catch {
    return
  }
  if (st.isDirectory()) {
    if (depth > 8) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (entry.name === 'Thumbs.db' || entry.name === 'desktop.ini') continue
      walkSource(path.join(abs, entry.name), `${rel}/${entry.name}`, depth + 1, out)
    }
    return
  }
  if (!st.isFile()) return
  if (!SUPPORTED_EXT.has(path.extname(abs).toLowerCase())) return
  out.push({ abs, rel })
}

function stampNow() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/**
 * 把拖入的文件/文件夹复制到 `_收件箱/<批次>/`，源文件保持不动。
 * 文件名 + 大小 + mtime 相同的文件视为重复，直接跳过并列入报告。
 */
export async function stageInboxPaths(
  root: string,
  sourcePaths: string[],
  onProgress?: (p: InboxStageProgress) => void
): Promise<InboxStageResult> {
  const sources = Array.from(
    new Set((Array.isArray(sourcePaths) ? sourcePaths : []).map((p) => String(p ?? '').trim()).filter(Boolean))
  )
  const result: InboxStageResult = { ok: false, batchRel: null, copied: 0, skipped: [], errors: [] }
  if (!sources.length) {
    result.errors.push('没有可导入的文件')
    return result
  }

  const entries: SourceEntry[] = []
  for (const src of sources) {
    const abs = path.resolve(src)
    if (!fs.existsSync(abs)) {
      result.skipped.push({ fileName: path.basename(abs) || abs, reason: '源路径不存在' })
      continue
    }
    if (insideDir(root, abs)) {
      result.skipped.push({ fileName: path.basename(abs), reason: '已在素材库内，未重复复制' })
      continue
    }
    let st: fs.Stats
    try {
      st = fs.statSync(abs)
    } catch (err) {
      result.errors.push(`${path.basename(abs)}：${(err as Error).message}`)
      continue
    }
    if (st.isDirectory()) {
      walkSource(abs, path.basename(abs), 0, entries)
      continue
    }
    const ext = path.extname(abs).toLowerCase()
    if (!SUPPORTED_EXT.has(ext)) {
      result.skipped.push({ fileName: path.basename(abs), reason: '不支持的格式' })
      continue
    }
    entries.push({ abs, rel: path.basename(abs) })
  }

  if (!entries.length) {
    result.ok = result.errors.length === 0
    if (result.ok && !result.skipped.length) result.skipped.push({ fileName: '', reason: '没有可导入的文件' })
    return result
  }

  const index = new Map<string, string>()
  for (const dir of [INBOX_DIR, DEEP_DIR, NIGHT_DIR]) indexSupported(path.join(root, dir), 0, index)

  const batchAbs = uniquePath(path.join(root, INBOX_DIR, stampNow()))
  const created = new Set<string>()
  ensureDir(batchAbs, root, created)

  const total = entries.length
  let done = 0
  for (const entry of entries) {
    done += 1
    onProgress?.({ done: done - 1, total, label: entry.rel })
    let st: fs.Stats
    try {
      st = fs.statSync(entry.abs)
    } catch (err) {
      result.errors.push(`${entry.rel}：${(err as Error).message}`)
      continue
    }
    const key = dedupeKey(path.basename(entry.abs), st.size, st.mtimeMs)
    if (index.has(key)) {
      result.skipped.push({ fileName: entry.rel, reason: '重复文件（同名同大小同时间），已跳过' })
      continue
    }
    try {
      const destAbs = uniqueFilePath(path.join(batchAbs, entry.rel))
      ensureDir(path.dirname(destAbs), root, created)
      fs.copyFileSync(entry.abs, destAbs)
      fs.utimesSync(destAbs, st.atimeMs / 1000, st.mtimeMs / 1000)
      index.set(key, destAbs)
      result.copied += 1
    } catch (err) {
      result.errors.push(`${entry.rel}：${(err as Error).message}`)
    }
  }
  onProgress?.({ done: total, total, label: '完成' })

  if (result.copied > 0) {
    result.batchRel = toRel(root, batchAbs)
  } else {
    try {
      fs.rmdirSync(batchAbs)
    } catch {
      /* 批次目录非空或已删除时保留 */
    }
  }
  result.ok = result.errors.length === 0
  return result
}

export function listDeferred(root: string): InboxDeferredItem[] {
  const deferRoot = path.join(root, INBOX_DIR, DEFER_DIR)
  const items: InboxDeferredItem[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 8) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(abs, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (!SUPPORTED_EXT.has(path.extname(entry.name).toLowerCase())) continue
      try {
        const st = fs.statSync(abs)
        items.push({
          relPath: toRel(root, abs),
          fileName: entry.name,
          ext: path.extname(entry.name).toLowerCase(),
          bytes: st.size,
          mtime: Math.round(st.mtimeMs)
        })
      } catch {
        /* 忽略读取失败的条目 */
      }
    }
  }
  walk(deferRoot, 0)
  return items
}

export function deferInboxFiles(db: DB, root: string, relPaths: string[]) {
  const deferRoot = path.join(root, INBOX_DIR, DEFER_DIR)
  const moves: Array<{ fromRel: string; toRel: string }> = []
  const errors: string[] = []
  const created = new Set<string>()
  for (const raw of Array.isArray(relPaths) ? relPaths : []) {
    const rel = String(raw ?? '').replace(/\\/g, '/')
    if (!rel.startsWith(`${INBOX_DIR}/`) || rel.includes('..')) {
      errors.push(`${path.basename(rel) || rel}：路径不合法`)
      continue
    }
    if (rel.startsWith(`${INBOX_DIR}/${DEFER_DIR}/`)) continue
    const fromAbs = path.join(root, rel)
    if (!fs.existsSync(fromAbs)) {
      errors.push(`${path.basename(rel)}：源文件不存在`)
      continue
    }
    try {
      const sub = rel.slice(INBOX_DIR.length + 1)
      const destAbs = uniqueFilePath(path.join(deferRoot, sub))
      ensureDir(path.dirname(destAbs), root, created)
      moveFile(fromAbs, destAbs)
      moves.push({ fromRel: rel, toRel: toRel(root, destAbs) })
    } catch (err) {
      errors.push(`${path.basename(rel)}：${(err as Error).message}`)
    }
  }
  if (moves.length) {
    logChange(db, 'defer_inbox', 'inbox', null, { items: moves }, false)
    pruneEmptyDirs(path.join(root, INBOX_DIR))
  }
  return { ok: errors.length === 0, moved: moves.length, errors: errors.slice(0, 20), moves }
}

export function restoreInboxFiles(db: DB, root: string, relPaths: string[]) {
  const deferPrefix = `${INBOX_DIR}/${DEFER_DIR}/`
  const moves: Array<{ fromRel: string; toRel: string }> = []
  const errors: string[] = []
  const created = new Set<string>()
  for (const raw of Array.isArray(relPaths) ? relPaths : []) {
    const rel = String(raw ?? '').replace(/\\/g, '/')
    if (!rel.startsWith(deferPrefix) || rel.includes('..')) {
      errors.push(`${path.basename(rel) || rel}：不在暂不整理中`)
      continue
    }
    const fromAbs = path.join(root, rel)
    if (!fs.existsSync(fromAbs)) {
      errors.push(`${path.basename(rel)}：源文件不存在`)
      continue
    }
    try {
      const sub = rel.slice(deferPrefix.length)
      const destAbs = uniqueFilePath(path.join(root, INBOX_DIR, sub))
      ensureDir(path.dirname(destAbs), root, created)
      moveFile(fromAbs, destAbs)
      moves.push({ fromRel: rel, toRel: toRel(root, destAbs) })
    } catch (err) {
      errors.push(`${path.basename(rel)}：${(err as Error).message}`)
    }
  }
  if (moves.length) {
    logChange(db, 'restore_inbox', 'inbox', null, { items: moves }, false)
    pruneEmptyDirs(path.join(root, INBOX_DIR, DEFER_DIR))
  }
  return { ok: errors.length === 0, moved: moves.length, errors: errors.slice(0, 20), moves }
}

function pruneEmptyDirs(dir: string) {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }
  let empty = true
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!pruneEmptyDirs(path.join(dir, entry.name))) empty = false
    } else {
      empty = false
    }
  }
  if (empty && path.basename(dir) !== INBOX_DIR) {
    try {
      fs.rmdirSync(dir)
    } catch {
      return false
    }
  }
  return empty
}
