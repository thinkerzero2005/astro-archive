import { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, screen, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import { DB, ensureDefaults, getSetting, openDatabase, setSetting } from './db'
import { Scanner, ScanProgress, ScanResult } from './scanner'
import { getNightDetail, getNightscape, getNights, getOverview, getPendingReviews, getRigs, getShotDetail, getStats, getTargetDetail, getTargets, getVideoDetail, searchLibrary, SearchParams } from './queries'
import {
  CreateNightPatch,
  createNight,
  NightPatch,
  openFolder,
  renameNightFolder,
  renameTargetFolder,
  resetReviews,
  resolveReviews,
  ReviewItemInput,
  revealFile,
  RigPatch,
  saveRig,
  ShotPatch,
  TargetProfilePatch,
  undoLastChange,
  updateNight,
  updateShots,
  updateTargetProfile,
  updateVersion,
  VersionPatch
} from './files'
import {
  deferInboxFiles,
  importInboxFiles,
  listDeferred,
  listInbox,
  previewInbox,
  recognizeInbox,
  restoreInboxFiles,
  stageInboxPaths,
  InboxOverride
} from './inbox'
import { previewSync, runSync } from './sync'
import type { SyncProgress, SyncRunOptions, SyncTargetOverride } from './sync'
import { CALIB_DIR, HISTORY_DIR, HISTORY_FILE, calibrationPath, getCalibrationData } from './calibration'
import { backupDir, dailyBackup, listBackups, restoreBackup } from './backup'
import { initLogger, logDir, logStats, writeLog } from './logger'
import { inspectLibraryDir, prepareLibraryDir } from './librarySetup'
import { openEncyclopedia } from './encyclopedia'
import { getOnlineProfile } from './profileOnline'
import { disposeOcr } from './watermark'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'astro',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: true }
  }
])

// ASTRO_DATA_DIR 便于隔离测试或把数据放到自定义位置；默认仍在 %APPDATA%\AstroArchive
const dataDir = process.env.ASTRO_DATA_DIR || path.join(app.getPath('appData'), 'AstroArchive')
const thumbsDir = path.join(dataDir, 'thumbs')
const profileCacheDir = path.join(dataDir, 'profiles')

// 构建脚本注入的打包日期；直接跑源码时可能不存在
declare const __BUILD_DATE__: string
const buildDate = typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : ''

let db: DB
let mainWindow: BrowserWindow | null = null
let scanning = false

function libraryRoot() {
  // 未建库时给出一个默认建议路径（用户文档目录），首次启动由建库向导确认
  return getSetting(db, 'library_root') || path.join(app.getPath('documents'), '星空档案馆')
}

const THEME_PREFS = ['dark', 'light', 'system'] as const
const ACCENT_KEYS = ['cyan', 'violet', 'amber', 'green', 'rose', 'indigo'] as const
type ThemePref = (typeof THEME_PREFS)[number]
type AccentKey = (typeof ACCENT_KEYS)[number]
interface Appearance {
  theme: ThemePref
  accent: AccentKey
  reduceMotion: boolean
}

function readAppearance(): Appearance {
  const theme = getSetting(db, 'appearance_theme') ?? ''
  const accent = getSetting(db, 'appearance_accent') ?? ''
  return {
    theme: (THEME_PREFS as readonly string[]).includes(theme) ? (theme as ThemePref) : 'dark',
    accent: (ACCENT_KEYS as readonly string[]).includes(accent) ? (accent as AccentKey) : 'cyan',
    reduceMotion: getSetting(db, 'appearance_reduce_motion') === '1'
  }
}

function writeAppearance(
  patch: Partial<Appearance>
): { ok: true; appearance: Appearance } | { ok: false; error: string } {
  if (patch.theme !== undefined) {
    if (!(THEME_PREFS as readonly string[]).includes(patch.theme)) return { ok: false, error: '未知主题' }
    setSetting(db, 'appearance_theme', patch.theme)
  }
  if (patch.accent !== undefined) {
    if (!(ACCENT_KEYS as readonly string[]).includes(patch.accent)) return { ok: false, error: '未知强调色' }
    setSetting(db, 'appearance_accent', patch.accent)
  }
  if (patch.reduceMotion !== undefined) {
    setSetting(db, 'appearance_reduce_motion', patch.reduceMotion ? '1' : '0')
  }
  return { ok: true, appearance: readAppearance() }
}

function windowBackground(appearance: Appearance) {
  const light =
    appearance.theme === 'light' || (appearance.theme === 'system' && !nativeTheme.shouldUseDarkColors)
  return light ? '#f2f6fc' : '#05070e'
}

const HOME_MODULE_KEYS = ['hero', 'stats', 'targets', 'nightscape', 'nights'] as const
type HomeModuleKey = (typeof HOME_MODULE_KEYS)[number]
interface HomeModules {
  order: HomeModuleKey[]
  hidden: HomeModuleKey[]
}

function isHomeModuleKey(value: unknown): value is HomeModuleKey {
  return (HOME_MODULE_KEYS as readonly string[]).includes(String(value))
}

function normalizeHomeModules(input: Partial<HomeModules>): HomeModules {
  const order: HomeModuleKey[] = []
  for (const key of Array.isArray(input.order) ? input.order : []) {
    if (isHomeModuleKey(key) && !order.includes(key)) order.push(key)
  }
  for (const key of HOME_MODULE_KEYS) if (!order.includes(key)) order.push(key)
  const hidden: HomeModuleKey[] = []
  for (const key of Array.isArray(input.hidden) ? input.hidden : []) {
    if (isHomeModuleKey(key) && !hidden.includes(key)) hidden.push(key)
  }
  return { order, hidden }
}

function readHomeModules(): HomeModules {
  const raw = getSetting(db, 'home_modules')
  if (!raw) return normalizeHomeModules({})
  try {
    return normalizeHomeModules(JSON.parse(raw) as Partial<HomeModules>)
  } catch {
    return normalizeHomeModules({})
  }
}

function writeHomeModules(patch: Partial<HomeModules>): { ok: true; modules: HomeModules } {
  const current = readHomeModules()
  const modules = normalizeHomeModules({
    order: patch.order ?? current.order,
    hidden: patch.hidden ?? current.hidden
  })
  setSetting(db, 'home_modules', JSON.stringify(modules))
  return { ok: true, modules }
}

function isInside(parent: string, child: string) {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo'
}

function fileResponse(absPath: string, request?: Request) {
  const mime = MIME[path.extname(absPath).toLowerCase()] ?? 'application/octet-stream'
  const size = fs.statSync(absPath).size
  const range = request?.headers.get('range') ?? ''
  const match = range.match(/^bytes=(\d*)-(\d*)$/)
  const streamHeaders = {
    'content-type': mime,
    'accept-ranges': 'bytes',
    'cache-control': 'no-cache',
    'access-control-allow-origin': '*'
  }

  if (match) {
    const hasStart = match[1] !== ''
    const hasEnd = match[2] !== ''
    let start = hasStart ? Number(match[1]) : 0
    let end = hasEnd ? Number(match[2]) : size - 1
    if (!hasStart && hasEnd) {
      start = Math.max(0, size - Number(match[2]))
      end = size - 1
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= size || start > end) {
      return new Response(null, {
        status: 416,
        headers: { 'content-range': `bytes */${size}`, 'accept-ranges': 'bytes' }
      })
    }
    end = Math.min(end, size - 1)
    const part = Readable.toWeb(fs.createReadStream(absPath, { start, end })) as unknown as ReadableStream
    return new Response(part, {
      status: 206,
      headers: {
        ...streamHeaders,
        'content-length': String(end - start + 1),
        'content-range': `bytes ${start}-${end}/${size}`
      }
    })
  }

  const stream = Readable.toWeb(fs.createReadStream(absPath)) as unknown as ReadableStream
  return new Response(stream, {
    headers: {
      ...streamHeaders,
      'content-length': String(size)
    }
  })
}

async function registerProtocol() {
  await protocol.handle('astro', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname === 'thumb') {
        const [, key, file] = url.pathname.split('/')
        const size = Number((file ?? '').replace('.webp', ''))
        if (!/^[a-f0-9]{20}$/.test(key) || ![124, 320, 1600].includes(size)) {
          return new Response('bad request', { status: 400 })
        }
        const p = path.join(thumbsDir, `${key}_${size}.webp`)
        if (!isInside(thumbsDir, p) || !fs.existsSync(p)) return new Response('not found', { status: 404 })
        return fileResponse(p, request)
      }
      if (url.hostname === 'local') {
        const abs = decodeURIComponent(url.pathname.slice(1))
        const root = libraryRoot()
        if (!isInside(root, abs) || !fs.existsSync(abs)) return new Response('not found', { status: 404 })
        return fileResponse(abs, request)
      }
      if (url.hostname === 'cache') {
        const file = decodeURIComponent(url.pathname.slice(1))
        const p = path.join(profileCacheDir, file)
        if (!file || path.extname(p).toLowerCase() === '.json') return new Response('not found', { status: 404 })
        if (!isInside(profileCacheDir, p) || !fs.existsSync(p)) return new Response('not found', { status: 404 })
        return fileResponse(p, request)
      }
      return new Response('not found', { status: 404 })
    } catch {
      return new Response('error', { status: 500 })
    }
  })
}

let scanCancelled = false

async function runScan(win: BrowserWindow | null, full = false) {
  if (scanning) return { ok: false, error: '正在扫描中' }
  scanning = true
  scanCancelled = false
  const scanner = new Scanner(db, libraryRoot(), thumbsDir, (p: ScanProgress) => {
    win?.webContents.send('scan:progress', p)
  })
  try {
    const result: ScanResult = await scanner.scan({ full, shouldCancel: () => scanCancelled })
    win?.webContents.send('library:changed', result)
    return result
  } catch (err) {
    console.error('[scan] 扫描失败:', err)
    const result: ScanResult = {
      ok: false,
      scannedAt: new Date().toISOString(),
      durationMs: 0,
      targetCount: 0,
      nightCount: 0,
      shotCount: 0,
      assetCount: 0,
      skipped: 0,
      errorCount: 1,
      errors: [(err as Error).message]
    }
    win?.webContents.send('library:changed', result)
    return result
  } finally {
    scanning = false
  }
}

function registerIpc() {
  ipcMain.handle('app:bootstrap', () => {
    const root = libraryRoot()
    return { overview: getOverview(db, root), libraryRoot: root, libraryRootExists: fs.existsSync(root), thumbsDir }
  })

  ipcMain.handle('library:overview', () => getOverview(db, libraryRoot()))
  ipcMain.handle('targets:list', () => getTargets(db, libraryRoot()))
  ipcMain.handle('target:detail', (_e, id: number) => getTargetDetail(db, libraryRoot(), Number(id)))
  ipcMain.handle('shot:detail', (_e, id: number) => getShotDetail(db, libraryRoot(), Number(id)))
  ipcMain.handle('shots:update', (_e, ids: number[], patch: ShotPatch) => updateShots(db, Array.isArray(ids) ? ids : [], patch ?? {}))
  ipcMain.handle('version:update', (_e, id: number, patch: VersionPatch) => updateVersion(db, Number(id), patch ?? {}))
  ipcMain.handle('target:profile:update', (_e, id: number, patch: TargetProfilePatch) =>
    updateTargetProfile(db, Number(id), patch ?? {})
  )
  ipcMain.handle('video:detail', (_e, id: number) => getVideoDetail(db, libraryRoot(), Number(id)))
  ipcMain.handle('nightscape:get', (_e, type: string) => getNightscape(db, libraryRoot(), String(type)))
  ipcMain.handle('nights:list', () => getNights(db, libraryRoot()))
  ipcMain.handle('night:detail', (_e, id: number) => getNightDetail(db, libraryRoot(), Number(id)))
  ipcMain.handle('night:update', (_e, id: number, patch: NightPatch) => updateNight(db, Number(id), patch ?? {}))
  ipcMain.handle('night:create', (_e, patch: CreateNightPatch) => createNight(db, patch ?? {}))
  ipcMain.handle('rigs:list', () => getRigs(db))
  ipcMain.handle('rig:save', (_e, patch: RigPatch) => saveRig(db, patch ?? {}))
  ipcMain.handle('external:encyclopedia', (_e, id: number, site: string) =>
    openEncyclopedia(db, Number(id), site)
  )
  ipcMain.handle('target:profile:online', (_e, id: number, force?: boolean) =>
    getOnlineProfile(db, Number(id), { force: !!force, cacheDir: profileCacheDir })
  )
  ipcMain.handle('stats:get', () => getStats(db, libraryRoot()))
  ipcMain.handle('review:list', (_e, state: 'pending' | 'manual') => getPendingReviews(db, libraryRoot(), state))
  ipcMain.handle('review:resolve', (_e, items: ReviewItemInput[]) => resolveReviews(db, items))
  ipcMain.handle('review:reset', (_e, ids: number[]) => resetReviews(db, ids))
  ipcMain.handle('search:run', (_e, params: SearchParams) => searchLibrary(db, libraryRoot(), params ?? {}))

  ipcMain.handle(
    'history:export',
    async (_e, rows: Array<{ time: string; action: string; entity: string; path: string; note: string }>) => {
      if (!mainWindow) return { ok: false, error: '窗口未就绪' }
      const now = new Date()
      const p2 = (n: number) => String(n).padStart(2, '0')
      const res = await dialog.showSaveDialog(mainWindow, {
        title: '导出历史记录',
        defaultPath: `星空档案馆历史_${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (res.canceled || !res.filePath) return { ok: false, canceled: true }
      const csvCell = (value: string) => {
        const v = String(value ?? '')
        return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
      }
      const lines = [
        ['时间', '操作', '对象', '路径', '备注'],
        ...rows.map((r) => [r.time, r.action, r.entity, r.path, r.note])
      ]
      fs.writeFileSync(res.filePath, '\ufeff' + lines.map((cols) => cols.map(csvCell).join(',')).join('\r\n'), 'utf8')
      return { ok: true, path: res.filePath }
    }
  )

  ipcMain.handle('library:scan', async (_e, full?: boolean) => runScan(mainWindow, full === true))
  ipcMain.handle('scan:cancel', () => {
    if (!scanning) return { ok: false, error: '当前没有正在进行的扫描' }
    scanCancelled = true
    return { ok: true }
  })
  ipcMain.handle('library:openRoot', () => openFolder(libraryRoot()))

  ipcMain.handle('folder:openTargetFinals', (_e, targetId: number) => {
    const row = db.prepare('SELECT folder_rel FROM targets WHERE id = ?').get(Number(targetId)) as
      | { folder_rel: string }
      | undefined
    if (!row) return { ok: false, error: '目标不存在' }
    return openFolder(path.join(libraryRoot(), row.folder_rel, '成片'))
  })

  ipcMain.handle('folder:openTargetRoot', (_e, targetId: number) => {
    const row = db.prepare('SELECT folder_rel FROM targets WHERE id = ?').get(Number(targetId)) as
      | { folder_rel: string }
      | undefined
    if (!row) return { ok: false, error: '目标不存在' }
    return openFolder(path.join(libraryRoot(), row.folder_rel))
  })

  ipcMain.handle('folder:openNight', (_e, nightId: number) => {
    const row = db.prepare('SELECT folder_rel FROM nights WHERE id = ?').get(Number(nightId)) as
      | { folder_rel: string | null }
      | undefined
    if (!row?.folder_rel) return { ok: false, error: '该夜次没有对应文件夹' }
    return openFolder(path.join(libraryRoot(), row.folder_rel))
  })

  ipcMain.handle('folder:revealShot', (_e, shotId: number) => {
    const row = db.prepare('SELECT file_rel FROM shots WHERE id = ?').get(Number(shotId)) as
      | { file_rel: string }
      | undefined
    if (!row) return { ok: false, error: '照片不存在' }
    return revealFile(path.join(libraryRoot(), row.file_rel))
  })

  ipcMain.handle('folder:revealVideo', (_e, videoId: number) => {
    const row = db.prepare(`SELECT file_rel FROM assets WHERE id = ? AND kind = 'video'`).get(Number(videoId)) as
      | { file_rel: string }
      | undefined
    if (!row) return { ok: false, error: '视频不存在' }
    return revealFile(path.join(libraryRoot(), row.file_rel))
  })

  ipcMain.handle('target:rename', (_e, id: number, name: string) =>
    renameTargetFolder(db, libraryRoot(), thumbsDir, Number(id), String(name))
  )

  ipcMain.handle('night:rename', (_e, id: number, location: string) =>
    renameNightFolder(db, libraryRoot(), thumbsDir, Number(id), String(location))
  )

  ipcMain.handle('change:undo', async () => {
    const result = undoLastChange(db, libraryRoot(), thumbsDir)
    if (result.ok && result.kind === 'import') await runScan(mainWindow)
    return result
  })

  ipcMain.handle('inbox:list', () => listInbox(db, libraryRoot()))
  ipcMain.handle('inbox:preview', (_e, items: InboxOverride[]) => previewInbox(db, libraryRoot(), items))
  ipcMain.handle('inbox:recognize', (_e, relPaths: string[]) => recognizeInbox(libraryRoot(), relPaths))
  ipcMain.handle('inbox:open', () => openFolder(path.join(libraryRoot(), '_收件箱')))
  ipcMain.handle('inbox:import', async (_e, items: InboxOverride[]) => {
    if (scanning) return { ok: false, moved: 0, errors: ['正在扫描素材库，请稍后再导入'], moves: [] }
    const result = importInboxFiles(db, libraryRoot(), items)
    if (result.moved > 0) await runScan(mainWindow)
    return result
  })
  ipcMain.handle('inbox:stage', async (e, sourcePaths: string[]) => {
    if (scanning) {
      return { ok: false, batchRel: null, copied: 0, skipped: [], errors: ['正在扫描素材库，请稍后再导入'] }
    }
    return stageInboxPaths(libraryRoot(), sourcePaths, (p) => e.sender.send('inbox:stage:progress', p))
  })
  ipcMain.handle('inbox:pickFolder', async () => {
    const opts = { title: '选择要导入的文件夹', properties: ['openDirectory' as const], buttonLabel: '导入' }
    const res = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true }
    return { ok: true, path: res.filePaths[0] }
  })
  ipcMain.handle('inbox:paused', () => listDeferred(libraryRoot()))
  ipcMain.handle('inbox:defer', (_e, relPaths: string[]) => deferInboxFiles(db, libraryRoot(), relPaths))
  ipcMain.handle('inbox:restore', (_e, relPaths: string[]) => restoreInboxFiles(db, libraryRoot(), relPaths))

  ipcMain.handle('sync:pickSource', async () => {
    const opts = {
      title: '选择 Dwarf 设备目录（含 Astronomy 文件夹）',
      properties: ['openDirectory' as const],
      buttonLabel: '选择'
    }
    const res = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true }
    return { ok: true, path: res.filePaths[0] }
  })

  const readSyncOverrides = (): SyncTargetOverride[] => {
    try {
      const raw = getSetting(db, 'sync_overrides')
      if (!raw) return []
      const obj = JSON.parse(raw) as Record<string, { catalogId?: string | null; nameCn?: string | null }>
      return Object.entries(obj).map(([sessionRel, v]) => ({
        sessionRel,
        catalogId: v.catalogId,
        nameCn: v.nameCn
      }))
    } catch {
      return []
    }
  }

  const mergeSyncOverrides = (stored: SyncTargetOverride[], incoming: SyncTargetOverride[]) => {
    const map = new Map<string, SyncTargetOverride>()
    for (const o of stored) map.set(o.sessionRel, o)
    for (const o of incoming) map.set(o.sessionRel, o)
    return [...map.values()]
  }

  const saveSyncOverrides = (incoming?: SyncTargetOverride[]) => {
    if (!incoming?.length) return
    const obj: Record<string, { catalogId?: string | null; nameCn?: string | null }> = {}
    for (const o of mergeSyncOverrides(readSyncOverrides(), incoming)) {
      obj[o.sessionRel] = { catalogId: o.catalogId, nameCn: o.nameCn }
    }
    setSetting(db, 'sync_overrides', JSON.stringify(obj))
  }

  ipcMain.handle('sync:preview', (_e, sourceRoot: string, overrides: SyncTargetOverride[]) =>
    previewSync(
      db,
      libraryRoot(),
      String(sourceRoot),
      mergeSyncOverrides(readSyncOverrides(), Array.isArray(overrides) ? overrides : [])
    )
  )

  ipcMain.handle('sync:run', async (_e, sourceRoot: string, options: SyncRunOptions) => {
    if (scanning) {
      return { ok: false, error: '正在扫描素材库，请稍后再同步', copied: 0, bytes: 0, skipped: 0, errors: [] }
    }
    const result = await runSync(db, libraryRoot(), String(sourceRoot), options ?? {}, (p: SyncProgress) => {
      mainWindow?.webContents.send('sync:progress', p)
    })
    saveSyncOverrides(options?.overrides)
    if (result.copied > 0) {
      setSetting(db, 'last_sync_source', String(sourceRoot))
      await runScan(mainWindow)
    }
    return result
  })

  ipcMain.handle('calib:get', () => getCalibrationData(libraryRoot()))
  ipcMain.handle('calib:open', (_e, key: string) => openFolder(calibrationPath(libraryRoot(), String(key))))

  ipcMain.handle('settings:info', () => {
    const root = libraryRoot()
    const dbPath = path.join(dataDir, 'archive.db')
    let dbBytes = 0
    try {
      dbBytes = fs.statSync(dbPath).size
    } catch {
      /* 数据库还没建 */
    }
    const historyPath = path.join(root, HISTORY_DIR, HISTORY_FILE)
    let historyBytes = 0
    let historyLines = 0
    try {
      historyBytes = fs.statSync(historyPath).size
      historyLines = fs
        .readFileSync(historyPath, 'utf8')
        .split('\n')
        .filter((line) => line.trim()).length
    } catch {
      /* 还没写过历史 */
    }
    const syncSource = getSetting(db, 'last_sync_source') ?? ''
    const synced = db.prepare('SELECT COUNT(*) AS c FROM synced_files').get() as { c?: number }
    const logs = logStats(dataDir)
    return {
      libraryRoot: root,
      dataDir,
      thumbsDir,
      dbPath,
      dbBytes,
      version: app.getVersion(),
      buildDate,
      lastScanAt: getSetting(db, 'last_scan_at') ?? '',
      syncSource,
      syncSourceExists: !!syncSource && fs.existsSync(syncSource),
      syncedFiles: Number(synced?.c ?? 0),
      historyPath,
      historyBytes,
      historyLines,
      historyExists: fs.existsSync(historyPath),
      calibrationPath: path.join(root, CALIB_DIR),
      calibrationExists: fs.existsSync(path.join(root, CALIB_DIR)),
      onlineProfileEnabled: getSetting(db, 'allow_online_profile') === '1',
      backupDir: backupDir(dataDir),
      backups: listBackups(dataDir),
      logsDir: logs.dir,
      logFiles: logs.files,
      logBytes: logs.bytes
    }
  })

  ipcMain.handle('backup:list', () => ({ backupDir: backupDir(dataDir), backups: listBackups(dataDir) }))
  ipcMain.handle('backup:openDir', () => openFolder(backupDir(dataDir)))

  ipcMain.handle('backup:restore', async (_e, fileName: string) => {
    const name = path.basename(String(fileName ?? ''))
    if (scanning) return { ok: false, error: '正在扫描素材库，请稍后再试' }
    const options = {
      type: 'warning' as const,
      title: '恢复数据库备份',
      message: `用 ${name} 覆盖当前索引数据库？`,
      detail:
        '当前数据库会先另存为 archive_before_restore_*.db，随后应用自动重启。素材库里的照片不会被改动，恢复后如需补全索引可重新扫描。',
      buttons: ['取消', '恢复并重启'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    }
    const res = mainWindow ? await dialog.showMessageBox(mainWindow, options) : await dialog.showMessageBox(options)
    if (res.response !== 1) return { ok: false, canceled: true }
    // 先关掉数据库连接，Windows 下才能安全覆盖 archive.db
    db.close()
    const result = restoreBackup(dataDir, name)
    if (!result.ok) {
      db = openDatabase(dataDir)
      return result
    }
    app.relaunch()
    app.exit(0)
    return { ok: true, safetyFile: result.safetyFile }
  })

  ipcMain.handle('settings:pickLibraryRoot', async () => {
    const opts = {
      title: '选择素材库根目录',
      defaultPath: libraryRoot(),
      properties: ['openDirectory' as const, 'createDirectory' as const],
      buttonLabel: '使用此目录'
    }
    const res = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true }
    return { ok: true, path: res.filePaths[0] }
  })

  ipcMain.handle('settings:openDataDir', () => openFolder(dataDir))
  ipcMain.handle('settings:openLogs', () => openFolder(logDir(dataDir)))
  ipcMain.handle('settings:openHistory', () => openFolder(path.join(libraryRoot(), HISTORY_DIR)))

  ipcMain.handle('library:inspect', (_e, dir: string) =>
    inspectLibraryDir(String(dir), { syncSource: getSetting(db, 'last_sync_source') ?? '' })
  )

  ipcMain.handle('library:prepare', (_e, dir: string, options: { allowNonEmpty?: boolean }) => {
    if (scanning) {
      return {
        ok: false,
        check: inspectLibraryDir(String(dir), { syncSource: getSetting(db, 'last_sync_source') ?? '' }),
        error: '正在扫描素材库，请稍后再试'
      }
    }
    const result = prepareLibraryDir(String(dir), {
      allowNonEmpty: !!options?.allowNonEmpty,
      syncSource: getSetting(db, 'last_sync_source') ?? ''
    })
    if (!result.ok) return result
    setSetting(db, 'library_root', result.check.path)
    return result
  })

  ipcMain.handle('appearance:get', () => readAppearance())
  ipcMain.handle('appearance:set', (_e, patch: Partial<Appearance>) => {
    const result = writeAppearance(patch ?? {})
    if (!result.ok) return result
    mainWindow?.setBackgroundColor(windowBackground(result.appearance))
    return result
  })

  ipcMain.handle('home:getModules', () => readHomeModules())
  ipcMain.handle('home:setModules', (_e, patch: Partial<HomeModules>) => writeHomeModules(patch ?? {}))
  ipcMain.handle('settings:setOnlineProfile', (_e, enabled: boolean) => {
    setSetting(db, 'allow_online_profile', enabled ? '1' : '0')
    return { ok: true, enabled: getSetting(db, 'allow_online_profile') === '1' }
  })

  ipcMain.handle('app:openExternal', (_e, url: string) => shell.openExternal(String(url)))
}

function createWindow() {
  // 基准尺寸 1440×900；屏幕较小时按工作区收缩，避免超出可视范围
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const width = Math.min(1440, Math.max(880, workArea.width - 48))
  const height = Math.min(900, Math.max(560, workArea.height - 48))

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(1080, width),
    minHeight: Math.min(680, height),
    center: true,
    show: false,
    backgroundColor: windowBackground(readAppearance()),
    autoHideMenuBar: true,
    title: '星空档案馆',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    mainWindow.loadURL(devUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] 渲染进程退出:', details.reason, details.exitCode)
  })
  mainWindow.on('unresponsive', () => console.error('[window] 窗口无响应'))

  const shouldScan = !getSetting(db, 'last_scan_at')
  mainWindow.webContents.once('did-finish-load', () => {
    if (shouldScan) setTimeout(() => runScan(mainWindow), 400)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    fs.mkdirSync(thumbsDir, { recursive: true })
    initLogger(dataDir)
    writeLog(dataDir, 'INFO', [`应用启动 v${app.getVersion()}${buildDate ? ` (${buildDate})` : ''}`])
    db = openDatabase(dataDir)
    ensureDefaults(db)
    registerIpc()
    await registerProtocol()
    createWindow()

    // 按天备份：启动时补一次，长期开着也每 4 小时检查。失败只记日志，不影响使用。
    const runBackup = () => {
      try {
        dailyBackup(db, dataDir)
      } catch (err) {
        console.error('[backup] 每日备份失败:', err)
      }
    }
    runBackup()
    setInterval(runBackup, 4 * 60 * 60 * 1000)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void disposeOcr()
  try {
    db?.close()
  } catch {
    /* ignore */
  }
})
