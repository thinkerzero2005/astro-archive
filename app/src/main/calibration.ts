import fs from 'node:fs'
import path from 'node:path'

export const CALIB_DIR = '_dwarf mini校准场'
export const DARK_LIB_DIR = '暗场库'
export const HISTORY_DIR = '_历史记录'
export const HISTORY_FILE = '素材库历史记录.csv'

const KINDS = [
  { key: 'bias' as const, label: 'Bias 偏置场' },
  { key: 'dark' as const, label: 'Dark 暗场' },
  { key: 'flat' as const, label: 'Flat 平场' }
]

export interface CalibrationDevice {
  name: string
  fileCount: number
  bytes: number
}

export interface CalibrationGroup {
  key: 'bias' | 'dark' | 'flat'
  label: string
  fileCount: number
  bytes: number
  devices: CalibrationDevice[]
  updatedAt: string | null
}

export interface CalibrationData {
  ok: boolean
  path: string
  exists: boolean
  groups: CalibrationGroup[]
  darkLibrary: {
    fileCount: number
    bytes: number
    devices: CalibrationDevice[]
    updatedAt: string | null
  } | null
  totalFiles: number
  totalBytes: number
}

interface DirStats {
  fileCount: number
  bytes: number
  latest: number
}

function walkStats(dir: string, depth = 0): DirStats {
  const out: DirStats = { fileCount: 0, bytes: 0, latest: 0 }
  if (depth > 4) return out
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const sub = walkStats(abs, depth + 1)
      out.fileCount += sub.fileCount
      out.bytes += sub.bytes
      out.latest = Math.max(out.latest, sub.latest)
      continue
    }
    if (!entry.isFile()) continue
    try {
      const st = fs.statSync(abs)
      out.fileCount++
      out.bytes += st.size
      out.latest = Math.max(out.latest, st.mtimeMs)
    } catch {
      /* 读不到的单个文件忽略 */
    }
  }
  return out
}

function isoOf(ms: number) {
  return ms > 0 ? new Date(ms).toISOString() : null
}

/** 校准场目录分设备统计（cam_0 / cam_1 / cam_0_gain_2_ir_2 …） */
function groupDevices(dir: string): { devices: CalibrationDevice[]; total: DirStats } {
  const total: DirStats = { fileCount: 0, bytes: 0, latest: 0 }
  const devices: CalibrationDevice[] = []
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return { devices, total }
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const st = walkStats(path.join(dir, entry.name))
    devices.push({ name: entry.name, fileCount: st.fileCount, bytes: st.bytes })
    total.fileCount += st.fileCount
    total.bytes += st.bytes
    total.latest = Math.max(total.latest, st.latest)
  }
  devices.sort((a, b) => a.name.localeCompare(b.name, 'en'))
  return { devices, total }
}

/** 暗场库按 wide / tele 归类（目录名形如 wide_exp_60_gain_60_bin_1_…） */
function darkLibraryGroups(dir: string) {
  const buckets = new Map<string, DirStats>()
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const head = entry.name.split(/[_\s-]/)[0].toLowerCase()
    const key = head === 'wide' ? 'wide 广角' : head === 'tele' ? 'tele 长焦' : '其他'
    const st = walkStats(path.join(dir, entry.name))
    const bucket = buckets.get(key) ?? { fileCount: 0, bytes: 0, latest: 0 }
    bucket.fileCount += st.fileCount
    bucket.bytes += st.bytes
    bucket.latest = Math.max(bucket.latest, st.latest)
    buckets.set(key, bucket)
  }
  const order = ['wide 广角', 'tele 长焦', '其他']
  return order
    .filter((key) => buckets.has(key))
    .map((key) => ({ name: key, ...buckets.get(key)! }))
}

export function getCalibrationData(root: string): CalibrationData {
  const dir = path.join(root, CALIB_DIR)
  const exists = fs.existsSync(dir)
  const groups: CalibrationGroup[] = KINDS.map(({ key, label }) => {
    const { devices, total } = groupDevices(path.join(dir, key))
    return {
      key,
      label,
      fileCount: total.fileCount,
      bytes: total.bytes,
      devices,
      updatedAt: isoOf(total.latest)
    }
  })

  const darkDir = path.join(dir, DARK_LIB_DIR)
  const darkStats = groupDevices(darkDir)
  const darkDevices = darkLibraryGroups(darkDir)
  const darkLibrary =
    darkStats.total.fileCount || darkDevices.length
      ? {
          fileCount: darkStats.total.fileCount,
          bytes: darkStats.total.bytes,
          devices: darkDevices,
          updatedAt: isoOf(darkStats.total.latest)
        }
      : null

  const totalFiles = groups.reduce((n, g) => n + g.fileCount, 0) + (darkLibrary?.fileCount ?? 0)
  const totalBytes = groups.reduce((n, g) => n + g.bytes, 0) + (darkLibrary?.bytes ?? 0)

  return { ok: true, path: dir, exists, groups, darkLibrary, totalFiles, totalBytes }
}

/** 校准场里某一类的绝对路径，用于「打开文件夹」 */
export function calibrationPath(root: string, key: string) {
  const dir = path.join(root, CALIB_DIR)
  if (!key || key === 'root') return dir
  if (key === 'darklib') return path.join(dir, DARK_LIB_DIR)
  return KINDS.some((k) => k.key === key) ? path.join(dir, key) : dir
}
