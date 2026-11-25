import fs from 'node:fs'
import path from 'node:path'
import type { DB } from './db'

/** 数据库备份目录（位于数据目录内），按天各留一份，最多保留 7 份 */
export const BACKUP_DIR = 'backups'
const KEEP = 7
const NAME_RE = /^archive_(\d{4}-\d{2}-\d{2})\.db$/

export interface BackupEntry {
  fileName: string
  date: string
  bytes: number
  mtime: string
}

export function backupDir(dataDir: string) {
  return path.join(dataDir, BACKUP_DIR)
}

function localDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function listBackups(dataDir: string): BackupEntry[] {
  const dir = backupDir(dataDir)
  let names: string[] = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  const entries: BackupEntry[] = []
  for (const name of names) {
    const match = NAME_RE.exec(name)
    if (!match) continue
    const full = path.join(dir, name)
    try {
      const stat = fs.statSync(full)
      if (!stat.isFile()) continue
      entries.push({
        fileName: name,
        date: match[1],
        bytes: stat.size,
        mtime: stat.mtime.toISOString()
      })
    } catch {
      /* 文件在读取时被删除，忽略 */
    }
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date))
}

/** 只保留最近 KEEP 份，删除更早的备份 */
function prune(dataDir: string) {
  const entries = listBackups(dataDir)
  for (const entry of entries.slice(KEEP)) {
    try {
      fs.rmSync(path.join(backupDir(dataDir), entry.fileName), { force: true })
    } catch {
      /* 删不掉就留着，下次再试 */
    }
  }
}

/**
 * 当天备份。已有当天文件时跳过，返回 null。
 * 用 SQLite 的 VACUUM INTO 生成一致的快照，运行中也能安全备份。
 */
export function dailyBackup(db: DB, dataDir: string, now = new Date()): BackupEntry | null {
  const dir = backupDir(dataDir)
  fs.mkdirSync(dir, { recursive: true })
  const date = localDate(now)
  const fileName = `archive_${date}.db`
  const target = path.join(dir, fileName)
  if (!fs.existsSync(target)) {
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  }
  prune(dataDir)
  return listBackups(dataDir).find((entry) => entry.fileName === fileName) ?? null
}

export interface RestoreResult {
  ok: boolean
  error?: string
  safetyFile?: string
}

/**
 * 用指定备份覆盖当前数据库。覆盖前把现库另存为
 * archive_before_restore_<时间戳>.db，同时清理 -wal/-shm，避免旧日志污染。
 * 调用方负责在成功后重启应用。
 */
export function restoreBackup(dataDir: string, fileName: string): RestoreResult {
  const name = path.basename(String(fileName ?? ''))
  if (!NAME_RE.test(name)) return { ok: false, error: '备份文件名不合法' }
  const source = path.join(backupDir(dataDir), name)
  if (!fs.existsSync(source)) return { ok: false, error: '备份文件不存在' }

  const dbPath = path.join(dataDir, 'archive.db')
  const stamp = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const safetyName = `archive_before_restore_${localDate(stamp)}_${pad(stamp.getHours())}${pad(
    stamp.getMinutes()
  )}${pad(stamp.getSeconds())}.db`

  try {
    if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, path.join(dataDir, safetyName))
    for (const suffix of ['-wal', '-shm']) {
      fs.rmSync(dbPath + suffix, { force: true })
    }
    fs.copyFileSync(source, dbPath)
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
  return { ok: true, safetyFile: safetyName }
}
