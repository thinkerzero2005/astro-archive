import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { DB, nowIso } from './db'
import { builtinProfile, normalizeCatalogId } from './catalog'
import { logChange, registerUndoHandler, sanitizeSegment, uniqueFilePath } from './files'
import type { UndoResult, UndoRow } from './files'

const DEEP_DIR = '01_深空'
const CALIB_DIR = '_dwarf mini校准场'
const HISTORY_DIR = '_历史记录'
const HISTORY_FILE = '素材库历史记录.csv'
const DARK_LIB_DIR = '暗场库'

const CALIB_KINDS = ['bias', 'dark', 'flat'] as const
type CalibKind = (typeof CALIB_KINDS)[number]

const LIGHT_EXT = new Set(['.fits', '.fit', '.fts'])
const SKIP_DIRS = new Set(['thumbnail', 'thumbnails', 'solving_failed', 'restacked'])
const HISTORY_HEADER = ['时间', '操作', '类别', '文件相对路径', '大小KB', '来源', '批次']

const TARGET_KEYS = ['target', 'targetname', 'target_name', 'object', 'objectname', 'objname', 'obj', 'shotname']
const DATE_KEYS = ['dateobs', 'date_obs', 'date', 'starttime', 'start_time', 'shoottime', 'shoot_time', 'createtime', 'create_time']

export interface SyncTargetOverride {
  sessionRel: string
  catalogId?: string | null
  nameCn?: string | null
}

export type SyncSessionStatus = 'new' | 'partial' | 'synced' | 'skip' | 'unresolved'

export interface SyncSessionItem {
  sessionRel: string
  sessionName: string
  targetCatalog: string | null
  targetName: string | null
  targetFolderRel: string | null
  date: string | null
  frameCount: number
  fileCount: number
  bytes: number
  pendingBytes: number
  status: SyncSessionStatus
  reason: string | null
}

export interface SyncCalibrationItem {
  key: string
  label: string
  destRel: string
  fileCount: number
  bytes: number
  pendingBytes: number
  status: 'new' | 'partial' | 'synced' | 'skip'
  reason: string | null
}

export interface SyncPreview {
  ok: boolean
  error?: string
  sourceRoot: string
  astronomyPath: string | null
  sessions: SyncSessionItem[]
  calibrations: SyncCalibrationItem[]
  totalBytes: number
  pendingBytes: number
}

export interface SyncRunOptions {
  sessions?: string[]
  calibrations?: string[]
  overrides?: SyncTargetOverride[]
  makeDeleteList?: boolean
}

export interface SyncProgress {
  phase: 'copy' | 'done'
  done: number
  total: number
  label?: string
}

export interface SyncRunResult {
  ok: boolean
  error?: string
  batchId?: string
  copied: number
  bytes: number
  skipped: number
  errors: string[]
  deleteListPath?: string | null
}

interface SourceFile {
  rel: string
  abs: string
  bytes: number
}

interface SessionPlan {
  rel: string
  abs: string
  name: string
  files: SourceFile[]
  frameCount: number
  hasStacked: boolean
  totalBytes: number
  pending: SourceFile[]
  pendingBytes: number
  date: string | null
  catalog: string | null
  targetName: string | null
  folderRel: string | null
  status: SyncSessionStatus
  reason: string | null
}

interface CalibPlan {
  key: string
  label: string
  category: string
  sourceRel: string
  destRel: string
  files: SourceFile[]
  pending: SourceFile[]
  totalBytes: number
  pendingBytes: number
  status: 'new' | 'partial' | 'synced' | 'skip'
  reason: string | null
}

interface Plan {
  ok: boolean
  error?: string
  astronomyPath: string | null
  sessions: SessionPlan[]
  calibrations: CalibPlan[]
}

interface CopyRecord {
  key: string
  sourceRel: string
  destRel: string
  bytes: number
  category: string
}

type HistoryRow = [string, string, string, string, string, string, string]

function relOf(base: string, abs: string) {
  return path.relative(base, abs).split(path.sep).join('/')
}

function isDir(p: string) {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function isInside(parent: string, child: string) {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function fileKey(group: string, rel: string, bytes: number) {
  return `${group}|${rel}|${bytes}`
}

function formatTime(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function batchStamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function csvCell(value: string) {
  const v = String(value ?? '')
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** 把 Astronomy 目录定位出来：允许用户选盘符、选 Astronomy 本身，或它的上层目录 */
function resolveAstronomy(sourceRoot: string): string | null {
  const base = path.resolve(sourceRoot)
  if (path.basename(base).toLowerCase() === 'astronomy') return base
  const direct = path.join(base, 'Astronomy')
  if (isDir(direct)) return direct
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(base, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    if (entry.name.toLowerCase() === 'astronomy') return path.join(base, entry.name)
    const nested = path.join(base, entry.name, 'Astronomy')
    if (isDir(nested)) return nested
  }
  return null
}

/** 逐层找含 shotsInfo.json 的会话目录，命中后不再向下钻 */
function discoverSessions(astronomy: string): string[] {
  const out: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 3) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    if (entries.some((e) => e.isFile() && e.name.toLowerCase() === 'shotsinfo.json')) {
      out.push(dir)
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const low = entry.name.toLowerCase()
      if (SKIP_DIRS.has(low) || low === 'cali_frame' || low === 'dwarf_dark') continue
      walk(path.join(dir, entry.name), depth + 1)
    }
  }
  walk(astronomy, 0)
  return out
}

function isSessionFile(name: string) {
  const low = name.toLowerCase()
  if (low === 'shotsinfo.json' || low === 'stacked.jpg') return true
  // stacked*.fits / stacked_thumbnail.jpg / stacked-16_*.zip 都是堆栈产物，不是单帧
  if (low.startsWith('failed_') || low.startsWith('stacked')) return false
  return LIGHT_EXT.has(path.extname(low))
}

function collectFiles(dir: string, prefix: string, out: SourceFile[], keep: (name: string) => boolean) {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const abs = path.join(dir, entry.name)
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
      collectFiles(abs, rel, out, keep)
      continue
    }
    if (!entry.isFile() || !keep(entry.name)) continue
    try {
      out.push({ rel, abs, bytes: fs.statSync(abs).size })
    } catch {
      /* 读不到的文件直接跳过，不影响整场同步 */
    }
  }
}

function collectSessionFiles(sessionAbs: string) {
  const files: SourceFile[] = []
  collectFiles(sessionAbs, '', files, isSessionFile)
  return files
}

function readShotsInfo(sessionAbs: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(path.join(sessionAbs, 'shotsInfo.json'), 'utf8')
    const data = JSON.parse(raw) as unknown
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function findScalar(node: unknown, keys: string[], depth = 0): string | null {
  if (depth > 4 || !node || typeof node !== 'object') return null
  const entries = Object.entries(node as Record<string, unknown>)
  for (const [k, v] of entries) {
    if (keys.includes(k.toLowerCase()) && (typeof v === 'string' || typeof v === 'number')) return String(v)
  }
  for (const [, v] of entries) {
    const hit = findScalar(v, keys, depth + 1)
    if (hit) return hit
  }
  return null
}

function normalizeDate(raw: string | null): string | null {
  if (!raw) return null
  const m = raw.match(/(20\d{2})[-_.年/]?(\d{1,2})[-_.月/]?(\d{1,2})/)
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  }
  const n = Number(raw)
  if (Number.isFinite(n) && String(Math.round(n)).length >= 10) {
    const ms = n > 1e12 ? n : n > 1e9 ? n * 1000 : null
    if (ms) {
      const d = new Date(ms)
      const p = (x: number) => String(x).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    }
  }
  return null
}

function dayKey(ms: number) {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const CATALOG_RE = /(ABELL|HD|SAO|HIP|HR|IC|NGC|SH2|LDN|LBN|VDB|CED|PGC|UGC|M|C|B)\s*[-_\s]?(\d{1,6})/

/** 从 shotsInfo 的 target 或目录名里拆出编号与中文名，如「IC 1805 160」→ IC1805 */
function parseTarget(raw: string | null) {
  if (!raw) return { catalog: null as string | null, name: null as string | null }
  const text = raw.trim()
  if (!text) return { catalog: null, name: null }
  const m = text.toUpperCase().match(CATALOG_RE)
  const catalog = m ? `${m[1]}${m[2]}` : null
  const cn = text.match(/[\u4e00-\u9fa5]{2,}/)
  return { catalog, name: cn ? cn[0] : null }
}

function defaultTargetName(catalog: string) {
  const alias = builtinProfile(catalog)?.alias?.split(/[、,，]/)[0]?.trim()
  return alias || catalog
}

/** 已有目标文件夹优先，其次按编号找，最后按「编号_中文名」新建 */
function resolveTargetFolder(db: DB, root: string, catalog: string, nameCn: string) {
  const code = normalizeCatalogId(catalog)
  const row = db.prepare('SELECT folder_rel FROM targets WHERE catalog_id = ?').get(code) as
    | { folder_rel: string }
    | undefined
  if (row && isDir(path.join(root, row.folder_rel))) return row.folder_rel

  let dirs: string[] = []
  try {
    dirs = fs
      .readdirSync(path.join(root, DEEP_DIR), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    /* 深空目录还没建，超过新建流程 */
  }
  const hit = dirs.find((name) => {
    const up = name.toUpperCase()
    return up === code || up.startsWith(`${code}_`)
  })
  if (hit) return `${DEEP_DIR}/${hit}`
  const displayName = sanitizeSegment(nameCn || code)
  return displayName === code ? `${DEEP_DIR}/${code}` : `${DEEP_DIR}/${code}_${displayName}`
}

/** 会话目录名压成一层，避免不同场次同名文件互撞 */
function sessionFolderName(sessionRel: string) {
  return sanitizeSegment(sessionRel.split('/').join('_'))
}

function scanCalibGroup(
  astronomy: string,
  root: string,
  kind: CalibKind,
  synced: Set<string>
): CalibPlan | null {
  const srcDir = path.join(astronomy, 'CALI_FRAME', kind)
  if (!isDir(srcDir)) return null
  const files: SourceFile[] = []
  collectFiles(srcDir, '', files, () => true)
  const sourceRel = `CALI_FRAME/${kind}`
  const pending = files.filter((f) => !synced.has(fileKey(sourceRel, f.rel, f.bytes)))
  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0)
  const pendingBytes = pending.reduce((sum, f) => sum + f.bytes, 0)
  let status: CalibPlan['status'] = 'new'
  if (!files.length) status = 'skip'
  else if (!pending.length) status = 'synced'
  else if (pending.length < files.length) status = 'partial'
  return {
    key: kind,
    label: `校准场-${kind}`,
    category: `校准场-${kind}`,
    sourceRel,
    destRel: `${CALIB_DIR}/${kind}`,
    files,
    pending,
    totalBytes,
    pendingBytes,
    status,
    reason: files.length ? null : '没有校准文件'
  }
}

function hasAnyFile(dir: string): boolean {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }
  return entries.some((e) => (e.isFile() ? true : hasAnyFile(path.join(dir, e.name))))
}

function scanDarkLibrary(astronomy: string, root: string, synced: Set<string>): CalibPlan | null {
  const srcDir = path.join(astronomy, 'DWARF_DARK')
  if (!isDir(srcDir)) return null
  const destAbs = path.join(root, CALIB_DIR, DARK_LIB_DIR)
  const files: SourceFile[] = []
  collectFiles(srcDir, '', files, () => true)
  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0)
  const copiedBefore = hasAnyFile(destAbs) || [...synced].some((k) => k.startsWith('DWARF_DARK|'))
  if (copiedBefore) {
    return {
      key: 'darklib',
      label: DARK_LIB_DIR,
      category: DARK_LIB_DIR,
      sourceRel: 'DWARF_DARK',
      destRel: `${CALIB_DIR}/${DARK_LIB_DIR}`,
      files,
      pending: [],
      totalBytes,
      pendingBytes: 0,
      status: 'skip',
      reason: '暗场库只保留首次拷贝'
    }
  }
  const pending = files.filter((f) => !synced.has(fileKey('DWARF_DARK', f.rel, f.bytes)))
  let status: CalibPlan['status'] = 'new'
  if (!files.length) status = 'skip'
  else if (!pending.length) status = 'synced'
  else if (pending.length < files.length) status = 'partial'
  return {
    key: 'darklib',
    label: DARK_LIB_DIR,
    category: DARK_LIB_DIR,
    sourceRel: 'DWARF_DARK',
    destRel: `${CALIB_DIR}/${DARK_LIB_DIR}`,
    files,
    pending,
    totalBytes,
    pendingBytes: pending.reduce((sum, f) => sum + f.bytes, 0),
    status,
    reason: files.length ? null : '没有暗场文件'
  }
}

function buildPlan(db: DB, root: string, sourceRoot: string, overrides: SyncTargetOverride[]): Plan {
  const astronomy = resolveAstronomy(sourceRoot)
  if (!astronomy) {
    return {
      ok: false,
      error: `所选目录里没有找到 Astronomy 文件夹：${sourceRoot}`,
      astronomyPath: null,
      sessions: [],
      calibrations: []
    }
  }

  const synced = new Set(
    (db.prepare('SELECT key FROM synced_files').all() as Array<{ key: string }>).map((r) => r.key)
  )
  const overrideMap = new Map(
    (Array.isArray(overrides) ? overrides : []).map((o) => [String(o.sessionRel ?? '').replace(/\\/g, '/'), o])
  )

  const sessions: SessionPlan[] = []
  for (const abs of discoverSessions(astronomy)) {
    const rel = relOf(astronomy, abs)
    const name = path.basename(abs)
    const files = collectSessionFiles(abs)
    const frameCount = files.filter((f) => LIGHT_EXT.has(path.extname(f.rel).toLowerCase())).length
    const hasStacked = files.some((f) => path.basename(f.rel).toLowerCase() === 'stacked.jpg')

    const info = readShotsInfo(abs)
    const targetRaw = findScalar(info, TARGET_KEYS) ?? name
    const parsed = parseTarget(targetRaw)
    const override = overrideMap.get(rel)
    const catalog = override?.catalogId ? normalizeCatalogId(override.catalogId) : parsed.catalog
    const validCatalog = !!catalog && /^[A-Z]{1,6}\d+[A-Z]?$/.test(catalog)
    const nameCn =
      String(override?.nameCn ?? '').trim() ||
      parsed.name ||
      (validCatalog ? defaultTargetName(catalog as string) : '')

    let date = normalizeDate(findScalar(info, DATE_KEYS))
    if (!date) {
      const m = name.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/)
      if (m) date = `${m[1]}-${m[2]}-${m[3]}`
    }
    if (!date) {
      try {
        date = dayKey(fs.statSync(abs).mtimeMs)
      } catch {
        date = null
      }
    }

    const folderRel = validCatalog ? resolveTargetFolder(db, root, catalog as string, nameCn) : null

    const pending = folderRel
      ? files.filter((f) => !synced.has(fileKey(rel, f.rel, f.bytes)))
      : files

    let status: SyncSessionStatus = 'new'
    let reason: string | null = null
    if (frameCount === 0) {
      status = 'skip'
      reason = '没有可用的光帧'
    } else if (!hasStacked) {
      status = 'skip'
      reason = '会话里没有 stacked.jpg，堆栈可能未成功'
    } else if (!folderRel) {
      status = 'unresolved'
      reason = '未识别目标，请在预览里指定编号'
    } else if (pending.length === 0) {
      status = 'synced'
    } else if (pending.length < files.length) {
      status = 'partial'
    }

    sessions.push({
      rel,
      abs,
      name,
      files,
      frameCount,
      hasStacked,
      totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
      pending,
      pendingBytes: pending.reduce((sum, f) => sum + f.bytes, 0),
      date,
      catalog: validCatalog ? catalog : null,
      targetName: nameCn || null,
      folderRel,
      status,
      reason
    })
  }

  sessions.sort((a, b) => {
    const rank = (s: SessionPlan) => (s.status === 'unresolved' ? 0 : s.status === 'skip' ? 2 : 1)
    return rank(a) - rank(b) || String(b.date ?? '').localeCompare(String(a.date ?? '')) || a.rel.localeCompare(b.name, 'zh-CN')
  })

  const calibrations: CalibPlan[] = []
  for (const kind of CALIB_KINDS) {
    const group = scanCalibGroup(astronomy, root, kind, synced)
    if (group) calibrations.push(group)
  }
  const darkLib = scanDarkLibrary(astronomy, root, synced)
  if (darkLib) calibrations.push(darkLib)

  return { ok: true, astronomyPath: astronomy, sessions, calibrations }
}

export function previewSync(
  db: DB,
  root: string,
  sourceRoot: string,
  overrides: SyncTargetOverride[] = []
): SyncPreview {
  const plan = buildPlan(db, root, sourceRoot, overrides)
  if (!plan.ok) {
    return {
      ok: false,
      error: plan.error,
      sourceRoot,
      astronomyPath: plan.astronomyPath,
      sessions: [],
      calibrations: [],
      totalBytes: 0,
      pendingBytes: 0
    }
  }

  const sessions: SyncSessionItem[] = plan.sessions.map((s) => ({
    sessionRel: s.rel,
    sessionName: s.name,
    targetCatalog: s.catalog,
    targetName: s.targetName,
    targetFolderRel: s.folderRel,
    date: s.date,
    frameCount: s.frameCount,
    fileCount: s.files.length,
    bytes: s.totalBytes,
    pendingBytes: s.pendingBytes,
    status: s.status,
    reason: s.reason
  }))
  const calibrations: SyncCalibrationItem[] = plan.calibrations.map((c) => ({
    key: c.key,
    label: c.label,
    destRel: c.destRel,
    fileCount: c.files.length,
    bytes: c.totalBytes,
    pendingBytes: c.pendingBytes,
    status: c.status,
    reason: c.reason
  }))

  return {
    ok: true,
    sourceRoot,
    astronomyPath: plan.astronomyPath,
    sessions,
    calibrations,
    totalBytes: sessions.reduce((sum, s) => sum + s.bytes, 0),
    // 跳过的会话/校准场不会被拷贝，不计入待同步体积
    pendingBytes:
      sessions.reduce((sum, s) => sum + (s.status === 'skip' ? 0 : s.pendingBytes), 0) +
      calibrations.reduce((sum, c) => sum + (c.status === 'skip' ? 0 : c.pendingBytes), 0)
  }
}

function freeBytes(dir: string) {
  try {
    const st = fs.statfsSync(dir)
    return Number(st.bavail) * Number(st.bsize)
  } catch {
    return null
  }
}

function appendHistory(root: string, rows: HistoryRow[]) {
  if (!rows.length) return
  const dir = path.join(root, HISTORY_DIR)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, HISTORY_FILE)
  const exists = fs.existsSync(file)
  const lines = rows.map((cols) => cols.map(csvCell).join(','))
  if (!exists) lines.unshift(HISTORY_HEADER.map(csvCell).join(','))
  fs.appendFileSync(file, `${exists ? '' : '\ufeff'}${lines.join('\r\n')}\r\n`, 'utf8')
}

function writeDeleteList(
  root: string,
  astronomy: string,
  batchId: string,
  sessions: Array<{ plan: SessionPlan; destFor: (file: SourceFile) => string }>
) {
  if (!sessions.length) return null
  const rows: string[][] = [['批次', '会话', '文件数', '已校验', '设备路径', '建议']]
  for (const { plan, destFor } of sessions) {
    let missing = 0
    for (const file of plan.files) {
      try {
        const abs = path.join(root, destFor(file))
        if (!fs.existsSync(abs) || fs.statSync(abs).size !== file.bytes) missing++
      } catch {
        missing++
      }
    }
    rows.push([
      batchId,
      plan.name,
      String(plan.files.length),
      missing === 0 ? '已校验' : `缺少 ${missing} 个`,
      path.join(astronomy, plan.rel),
      missing === 0 ? '可删除' : '未同步完整，请勿删除'
    ])
  }
  const dir = path.join(root, HISTORY_DIR)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `可安全删除清单_${batchId}.csv`)
  fs.writeFileSync(file, '\ufeff' + rows.map((cols) => cols.map(csvCell).join(',')).join('\r\n'), 'utf8')
  return file
}

export async function runSync(
  db: DB,
  root: string,
  sourceRoot: string,
  options: SyncRunOptions = {},
  onProgress?: (p: SyncProgress) => void
): Promise<SyncRunResult> {
  const overrides = Array.isArray(options.overrides) ? options.overrides : []
  const plan = buildPlan(db, root, sourceRoot, overrides)
  if (!plan.ok || !plan.astronomyPath) {
    return { ok: false, error: plan.error ?? '无法识别同步源', copied: 0, bytes: 0, skipped: 0, errors: [] }
  }

  const selectedSessions = options.sessions
    ? plan.sessions.filter((s) => options.sessions?.includes(s.rel))
    : plan.sessions.filter((s) => s.status === 'new' || s.status === 'partial')
  const selectedCalib = options.calibrations
    ? plan.calibrations.filter((c) => options.calibrations?.includes(c.key))
    : plan.calibrations.filter((c) => c.status === 'new' || c.status === 'partial')

  const errors: string[] = []
  const jobs: Array<{
    key: string
    from: string
    destRel: string
    bytes: number
    category: string
    sourceRel: string
  }> = []
  const deleteEntries: Array<{ plan: SessionPlan; destFor: (file: SourceFile) => string }> = []

  for (const session of selectedSessions) {
    if (session.status === 'skip') {
      errors.push(`${session.name}：${session.reason ?? '已跳过'}`)
      continue
    }
    if (!session.folderRel) {
      errors.push(`${session.name}：未识别目标，请先指定编号`)
      continue
    }
    const destFor = (file: SourceFile) =>
      `${session.folderRel}/原始/${sessionFolderName(session.rel)}/${file.rel}`
    for (const file of session.pending) {
      jobs.push({
        key: fileKey(session.rel, file.rel, file.bytes),
        from: file.abs,
        destRel: destFor(file),
        bytes: file.bytes,
        category: '深空光帧',
        sourceRel: `${session.rel}/${file.rel}`
      })
    }
    deleteEntries.push({ plan: session, destFor })
  }

  for (const group of selectedCalib) {
    if (group.status === 'skip') {
      if (group.key === 'darklib') errors.push(`${group.label}：${group.reason ?? '已跳过'}`)
      continue
    }
    for (const file of group.pending) {
      jobs.push({
        key: fileKey(group.sourceRel, file.rel, file.bytes),
        from: file.abs,
        destRel: `${group.destRel}/${file.rel}`,
        bytes: file.bytes,
        category: group.category,
        sourceRel: `${group.sourceRel}/${file.rel}`
      })
    }
  }

  if (!jobs.length) {
    return { ok: true, copied: 0, bytes: 0, skipped: 0, errors }
  }

  const needed = jobs.reduce((sum, j) => sum + j.bytes, 0)
  const free = freeBytes(root)
  if (free !== null && free < needed) {
    return {
      ok: false,
      error: `素材库所在磁盘空间不足：需要 ${formatSize(needed)}，剩余 ${formatSize(free)}`,
      copied: 0,
      bytes: 0,
      skipped: 0,
      errors
    }
  }

  const batchId = `S${batchStamp()}`
  const now = nowIso()
  const records: CopyRecord[] = []
  const copiedRows: HistoryRow[] = []
  let copied = 0
  let copiedBytes = 0
  let skipped = 0

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]
    onProgress?.({ phase: 'copy', done: i, total: jobs.length, label: job.destRel })
    let destRel = job.destRel
    try {
      const abs = path.join(root, destRel)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      if (fs.existsSync(abs)) {
        if (fs.statSync(abs).size === job.bytes) {
          records.push({ ...job, destRel })
          skipped++
          continue
        }
        destRel = relOf(root, uniqueFilePath(abs))
      }
      await fsp.copyFile(job.from, path.join(root, destRel))
      if (fs.statSync(path.join(root, destRel)).size !== job.bytes) {
        errors.push(`${job.sourceRel}：复制后大小不一致`)
        continue
      }
      records.push({ ...job, destRel })
      copied++
      copiedBytes += job.bytes
      copiedRows.push([
        formatTime(),
        '新增',
        job.category,
        destRel,
        String(Math.round(job.bytes / 1024)),
        path.join(plan.astronomyPath, job.sourceRel),
        batchId
      ])
    } catch (err) {
      errors.push(`${job.sourceRel}：${(err as Error).message}`)
    }
  }

  if (records.length) {
    db.exec('BEGIN')
    try {
      const insert = db.prepare(
        `INSERT OR REPLACE INTO synced_files(key, source_rel, dest_rel, bytes, batch_id, copied_at)
         VALUES(?, ?, ?, ?, ?, ?)`
      )
      for (const record of records) {
        insert.run(record.key, record.sourceRel, record.destRel, record.bytes, batchId, now)
      }
      logChange(db, 'sync_files', 'library', null, {
        batchId,
        sourceRoot: plan.astronomyPath,
        copied,
        bytes: copiedBytes,
        skipped
      })
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      return { ok: false, error: `同步记录写入失败：${(err as Error).message}`, copied, bytes: copiedBytes, skipped, errors }
    }
  }

  appendHistory(root, copiedRows)

  const deleteListPath =
    options.makeDeleteList && copied > 0
      ? writeDeleteList(root, plan.astronomyPath, batchId, deleteEntries)
      : null

  onProgress?.({ phase: 'done', done: jobs.length, total: jobs.length })
  return {
    ok: errors.length === 0,
    batchId,
    copied,
    bytes: copiedBytes,
    skipped,
    errors: errors.slice(0, 20),
    deleteListPath
  }
}

function formatSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

const STOP_PRUNE_DIRS = new Set(['原始', '成片', '处理', ...CALIB_KINDS, DARK_LIB_DIR])

function pruneEmptyUp(root: string, start: string) {
  let cur = path.resolve(start)
  while (isInside(root, cur) && !STOP_PRUNE_DIRS.has(path.basename(cur))) {
    try {
      fs.rmdirSync(cur)
    } catch {
      return
    }
    cur = path.dirname(cur)
  }
}

function categoryOf(destRel: string) {
  const norm = destRel.replace(/\\/g, '/')
  if (norm.startsWith(`${CALIB_DIR}/${DARK_LIB_DIR}/`)) return DARK_LIB_DIR
  for (const kind of CALIB_KINDS) {
    if (norm.startsWith(`${CALIB_DIR}/${kind}/`)) return `校准场-${kind}`
  }
  return '深空光帧'
}

/** 撤销一次同步：只删素材库内本次拷入的副本，设备端文件不动 */
export function undoSyncFiles(db: DB, root: string, row: UndoRow): UndoResult {
  let detail: { batchId?: string; sourceRoot?: string } = {}
  try {
    detail = JSON.parse(row.detail_json || '{}') as { batchId?: string; sourceRoot?: string }
  } catch {
    return { ok: false, error: '同步记录已损坏' }
  }
  const batchId = detail.batchId
  if (!batchId) return { ok: false, error: '这次同步缺少批次信息' }

  const rows = db.prepare('SELECT key, dest_rel, bytes FROM synced_files WHERE batch_id = ?').all(batchId) as Array<{
    key: string
    dest_rel: string
    bytes: number
  }>
  if (!rows.length) return { ok: false, error: '这次同步没有可撤销的副本' }

  const errors: string[] = []
  const removedKeys: string[] = []
  const deleted: string[] = []
  const csvRows: HistoryRow[] = []
  const sourceRoot = detail.sourceRoot ?? ''

  for (const item of rows) {
    const abs = path.join(root, item.dest_rel)
    if (!isInside(root, abs)) {
      errors.push(`${item.dest_rel}：路径越界`)
      continue
    }
    if (fs.existsSync(abs)) {
      try {
        fs.unlinkSync(abs)
      } catch (err) {
        errors.push(`${item.dest_rel}：${(err as Error).message}`)
        continue
      }
      deleted.push(item.dest_rel)
      csvRows.push([
        formatTime(),
        '删除',
        categoryOf(item.dest_rel),
        item.dest_rel,
        String(Math.round(item.bytes / 1024)),
        sourceRoot,
        batchId
      ])
      pruneEmptyUp(root, path.dirname(abs))
    }
    removedKeys.push(item.key)
  }

  if (!deleted.length && errors.length) return { ok: false, error: errors[0], errors: errors.slice(0, 20) }
  if (!removedKeys.length) return { ok: false, error: '副本已不在素材库内' }

  db.exec('BEGIN')
  try {
    const del = db.prepare('DELETE FROM synced_files WHERE key = ?')
    for (const key of removedKeys) del.run(key)
    db.prepare('UPDATE change_log SET undone = 1 WHERE id = ?').run(row.id)
    logChange(db, 'undo_sync', 'library', null, { batchId, deleted: deleted.length }, false)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    return { ok: false, error: `撤销失败：${(err as Error).message}`, errors: errors.slice(0, 20) }
  }

  appendHistory(root, csvRows)
  return { ok: errors.length === 0, kind: 'sync', restored: deleted.length, errors: errors.slice(0, 20) }
}

registerUndoHandler('sync_files', (db, root, row) => undoSyncFiles(db, root, row))
