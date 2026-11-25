import fs from 'node:fs'
import path from 'node:path'
import { CALIB_DIR } from './calibration'

export const DEEP_DIR = '01_深空'
export const NIGHT_DIR = '02_星野'
export const INBOX_DIR = '_收件箱'

const CALIB_KINDS = ['bias', 'dark', 'flat']

/** 素材库的标准目录（相对路径，统一用 / 便于展示） */
const STANDARD_DIRS = [
  DEEP_DIR,
  NIGHT_DIR,
  INBOX_DIR,
  CALIB_DIR,
  ...CALIB_KINDS.map((kind) => `${CALIB_DIR}/${kind}`)
]

export interface LibraryDirCheck {
  path: string
  exists: boolean
  isDirectory: boolean
  writable: boolean
  empty: boolean
  entryCount: number
  /** 目录里已有素材库特征目录 */
  isLibrary: boolean
  /** 看起来是设备原始素材目录（同步源），不适合直接当素材库 */
  looksLikeSource: boolean
  existing: string[]
  missing: string[]
  error?: string
}

export interface LibraryPrepareResult {
  ok: boolean
  needsConfirm?: boolean
  created?: string[]
  check: LibraryDirCheck
  error?: string
}

type WritableProbe = (dir: string) => boolean

function probeWritable(dir: string): boolean {
  const probe = path.join(dir, `.astro-write-test-${process.pid}-${Date.now()}`)
  try {
    fs.writeFileSync(probe, 'ok')
    fs.unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

function sourceLike(name: string) {
  return /^astronomy$/i.test(name) || /^dwarf[_\s-]/i.test(name)
}

export function inspectLibraryDir(
  dir: string,
  options: { syncSource?: string; probe?: WritableProbe } = {}
): LibraryDirCheck {
  const abs = path.resolve(String(dir || '.'))
  const check: LibraryDirCheck = {
    path: abs,
    exists: false,
    isDirectory: false,
    writable: false,
    empty: false,
    entryCount: 0,
    isLibrary: false,
    looksLikeSource: false,
    existing: [],
    missing: [...STANDARD_DIRS]
  }

  try {
    if (!fs.statSync(abs).isDirectory()) return { ...check, exists: true, error: '所选路径不是文件夹' }
  } catch {
    return { ...check, error: '目录不存在' }
  }
  check.exists = true
  check.isDirectory = true

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true })
  } catch (err) {
    return { ...check, error: `无法读取目录：${(err as Error).message}` }
  }

  const names = entries.filter((e) => !e.name.startsWith('.')).map((e) => e.name)
  check.entryCount = entries.length
  check.empty = entries.length === 0
  check.existing = STANDARD_DIRS.filter((rel) => fs.existsSync(path.join(abs, rel)))
  check.missing = STANDARD_DIRS.filter((rel) => !check.existing.includes(rel))
  check.isLibrary = [DEEP_DIR, NIGHT_DIR, INBOX_DIR, CALIB_DIR].some((name) => names.includes(name))
  check.writable = (options.probe ?? probeWritable)(abs)

  const syncSource = options.syncSource?.trim()
  const sameAsSource = !!syncSource && path.resolve(syncSource) === abs
  check.looksLikeSource =
    !check.isLibrary &&
    (sameAsSource ||
      entries.some((entry) => entry.isDirectory() && sourceLike(entry.name)) ||
      names.some(sourceLike))

  return check
}

export function prepareLibraryDir(
  dir: string,
  options: { allowNonEmpty?: boolean; syncSource?: string; probe?: WritableProbe } = {}
): LibraryPrepareResult {
  const checked = inspectLibraryDir(dir, { syncSource: options.syncSource, probe: options.probe })
  if (!checked.exists || !checked.isDirectory) {
    return { ok: false, check: checked, error: checked.error ?? '目录不可用' }
  }
  if (checked.looksLikeSource) {
    return {
      ok: false,
      check: checked,
      error: '这看起来是设备原始素材目录，请另选一个空白文件夹作为素材库'
    }
  }
  if (!checked.writable) {
    return { ok: false, check: checked, error: '目录不可写，请换一个位置或检查权限' }
  }
  if (!checked.empty && !checked.isLibrary && !options.allowNonEmpty) {
    return {
      ok: false,
      needsConfirm: true,
      check: checked,
      error: '目录里已有其它文件，确认后只补建缺失的标准目录，不会删除或覆盖已有内容'
    }
  }

  const created: string[] = []
  try {
    for (const rel of STANDARD_DIRS) {
      const abs = path.join(checked.path, rel)
      if (fs.existsSync(abs)) continue
      fs.mkdirSync(abs, { recursive: true })
      created.push(rel)
    }
  } catch (err) {
    return {
      ok: false,
      check: inspectLibraryDir(checked.path, { syncSource: options.syncSource, probe: options.probe }),
      error: `创建目录失败：${(err as Error).message}`
    }
  }

  return {
    ok: true,
    created,
    check: inspectLibraryDir(checked.path, { syncSource: options.syncSource, probe: options.probe })
  }
}

/** 目录结构展示用：标准目录的树形顺序 */
export function libraryTree() {
  const top = [DEEP_DIR, NIGHT_DIR, INBOX_DIR, CALIB_DIR]
  return top.map((name) => ({
    name,
    children: name === CALIB_DIR ? CALIB_KINDS.map((kind) => `${name}/${kind}`) : []
  }))
}
