import fs from 'node:fs'
import path from 'node:path'
import { shell } from 'electron'
import { DB, nowIso } from './db'
import { THUMB_SIZES, thumbKey, thumbPath } from './thumbs'
import { parseWatermarkText } from './watermark'

export function sanitizeSegment(input: string) {
  const cleaned = input
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  return cleaned || '未标注'
}

export function uniquePath(target: string) {
  if (!fs.existsSync(target)) return target
  const dir = path.dirname(target)
  const base = path.basename(target)
  for (let i = 2; i < 1000; i++) {
    const candidate = path.join(dir, `${base}_${i}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  throw new Error('同名文件夹过多，无法生成新名称')
}

/** 为文件生成不冲突的路径，序号插在扩展名之前 */
export function uniqueFilePath(target: string) {
  if (!fs.existsSync(target)) return target
  const dir = path.dirname(target)
  const ext = path.extname(target)
  const base = path.basename(target, ext)
  for (let i = 2; i < 1000; i++) {
    const candidate = path.join(dir, `${base}_${i}${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  throw new Error('同名文件过多，无法生成新名称')
}

/** 移动文件，跨盘时退化为复制后删除 */
export function moveFile(from: string, to: string) {
  try {
    fs.renameSync(from, to)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      fs.copyFileSync(from, to)
      fs.unlinkSync(from)
      return
    }
    throw err
  }
}

export async function openFolder(absPath: string) {
  if (!fs.existsSync(absPath)) {
    return { ok: false, error: `文件夹不存在：${absPath}` }
  }
  const message = await shell.openPath(absPath)
  return message ? { ok: false, error: message } : { ok: true }
}

export function revealFile(absPath: string) {
  if (!fs.existsSync(absPath)) return { ok: false, error: `文件不存在：${absPath}` }
  shell.showItemInFolder(absPath)
  return { ok: true }
}

interface ShotRelRow {
  id: number
  file_rel: string
  mtime: number
  bytes: number
}

function migrateThumbs(thumbsDir: string, rows: ShotRelRow[], oldPrefix: string, newPrefix: string) {
  for (const row of rows) {
    const oldRel = row.file_rel
    const newRel = newPrefix + oldRel.slice(oldPrefix.length)
    const oldKey = thumbKey(oldRel, row.mtime, row.bytes)
    const newKey = thumbKey(newRel, row.mtime, row.bytes)
    for (const size of THUMB_SIZES) {
      const from = thumbPath(thumbsDir, oldKey, size)
      const to = thumbPath(thumbsDir, newKey, size)
      try {
        if (fs.existsSync(from)) fs.renameSync(from, to)
      } catch {
        // 缩略图迁移失败不阻断重命名，下次扫描会补
      }
    }
  }
}

function rewriteRelPrefix(db: DB, table: 'shots' | 'assets', oldPrefix: string, newPrefix: string) {
  db.prepare(
    `UPDATE ${table} SET file_rel = ? || substr(file_rel, ?) WHERE file_rel LIKE ?`
  ).run(newPrefix, oldPrefix.length + 1, `${oldPrefix}/%`)
}

export function logChange(
  db: DB,
  action: string,
  entity: string,
  entityId: number | null,
  detail: Record<string, unknown>,
  undoable = true
) {
  db.prepare(
    `INSERT INTO change_log(at, action, entity, entity_id, detail_json, undoable, undone)
     VALUES(?, ?, ?, ?, ?, ?, 0)`
  ).run(nowIso(), action, entity, entityId, JSON.stringify(detail), undoable ? 1 : 0)
}

export function renameTargetFolder(db: DB, root: string, thumbsDir: string, targetId: number, newNameCn: string) {
  const target = db.prepare('SELECT * FROM targets WHERE id = ?').get(targetId) as
    | { id: number; catalog_id: string; name_cn: string; folder_rel: string }
    | undefined
  if (!target) return { ok: false, error: '目标不存在' }

  const safeName = sanitizeSegment(newNameCn)
  if (!safeName) return { ok: false, error: '名称不能为空' }
  if (safeName === target.name_cn) return { ok: true, renamed: false }

  const parent = path.dirname(path.join(root, target.folder_rel))
  const oldAbs = path.join(root, target.folder_rel)
  let newAbs = uniquePath(path.join(parent, `${target.catalog_id}_${safeName}`))
  const newRel = path.relative(root, newAbs).split(path.sep).join('/')

  const shotRows = db
    .prepare('SELECT id, file_rel, mtime, bytes FROM shots WHERE file_rel LIKE ?')
    .all(`${target.folder_rel}/%`) as unknown as ShotRelRow[]

  try {
    fs.renameSync(oldAbs, newAbs)
  } catch (err) {
    return { ok: false, error: `重命名失败：${(err as Error).message}` }
  }

  try {
    db.exec('BEGIN')
    db.prepare('UPDATE targets SET name_cn = ?, folder_rel = ?, updated_at = ? WHERE id = ?').run(
      newNameCn.trim(),
      newRel,
      nowIso(),
      targetId
    )
    rewriteRelPrefix(db, 'shots', target.folder_rel, newRel)
    rewriteRelPrefix(db, 'assets', target.folder_rel, newRel)
    logChange(db, 'rename_folder', 'target', targetId, {
      oldRel: target.folder_rel,
      newRel,
      oldName: target.name_cn,
      newName: newNameCn.trim()
    })
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    try {
      fs.renameSync(newAbs, oldAbs)
    } catch {
      /* 回滚文件失败时保留现场，交由用户处理 */
    }
    return { ok: false, error: `重命名失败：${(err as Error).message}` }
  }

  migrateThumbs(thumbsDir, shotRows, target.folder_rel, newRel)
  return { ok: true, renamed: true, folderRel: newRel }
}

export function renameNightFolder(db: DB, root: string, thumbsDir: string, nightId: number, newLocation: string) {
  const night = db.prepare('SELECT * FROM nights WHERE id = ?').get(nightId) as
    | { id: number; date: string; category: string; sub_type: string; location: string | null; folder_rel: string | null }
    | undefined
  if (!night) return { ok: false, error: '夜次不存在' }
  if (night.category !== 'nightscape' || !night.folder_rel) {
    return { ok: false, error: '只有星野夜次支持按地点改名' }
  }

  const safe = sanitizeSegment(newLocation)
  const oldRel = night.folder_rel
  const oldAbs = path.join(root, oldRel)
  const typeRel = path.dirname(oldRel)
  const oldFolderName = path.basename(oldRel)
  if (oldFolderName === `${night.date}_${safe}`) {
    return { ok: true, renamed: false }
  }

  let newAbs = uniquePath(path.join(root, typeRel, `${night.date}_${safe}`))
  const newRel = path.relative(root, newAbs).split(path.sep).join('/')

  const shotRows = db
    .prepare('SELECT id, file_rel, mtime, bytes FROM shots WHERE file_rel LIKE ?')
    .all(`${oldRel}/%`) as unknown as ShotRelRow[]

  try {
    fs.renameSync(oldAbs, newAbs)
  } catch (err) {
    return { ok: false, error: `重命名失败：${(err as Error).message}` }
  }

  try {
    db.exec('BEGIN')
    db.prepare('UPDATE nights SET location = ?, folder_rel = ?, updated_at = ? WHERE id = ?').run(
      safe,
      newRel,
      nowIso(),
      nightId
    )
    rewriteRelPrefix(db, 'shots', oldRel, newRel)
    rewriteRelPrefix(db, 'assets', oldRel, newRel)
    logChange(db, 'rename_folder', 'night', nightId, {
      oldRel,
      newRel,
      oldName: night.location ?? '未标注',
      newName: safe
    })
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    try {
      fs.renameSync(newAbs, oldAbs)
    } catch {
      /* 同上 */
    }
    return { ok: false, error: `重命名失败：${(err as Error).message}` }
  }

  migrateThumbs(thumbsDir, shotRows, oldRel, newRel)
  return { ok: true, renamed: true, folderRel: newRel }
}

export interface UndoResult {
  ok: boolean
  error?: string
  kind?: 'rename' | 'import' | 'edit' | 'profile' | 'night' | 'rig' | 'version' | 'sync'
  restored?: number
  errors?: string[]
}

export interface ShotPatch {
  rating?: number
  notes?: string
  isPinned?: boolean
  cover?: boolean
}

interface ShotEditRow {
  id: number
  target_id: number | null
  rating: number
  notes: string | null
  is_pinned: number
}

/** 照片的评分 / 备注 / 置顶 / 代表图，全部记录到 change_log 以便撤销 */
export function updateShots(db: DB, ids: number[], patch: ShotPatch) {
  const unique = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]
  if (!unique.length) return { ok: false, error: '没有选中照片' }

  const fields: string[] = []
  const values: Array<number | string | null> = []
  const after: { rating?: number; notes?: string | null; is_pinned?: number } = {}
  if (patch.rating !== undefined) {
    const rating = Math.max(0, Math.min(5, Math.round(Number(patch.rating) || 0)))
    fields.push('rating = ?')
    values.push(rating)
    after.rating = rating
  }
  if (patch.notes !== undefined) {
    const notes = String(patch.notes).trim().slice(0, 2000)
    fields.push('notes = ?')
    values.push(notes || null)
    after.notes = notes || null
  }
  if (patch.isPinned !== undefined) {
    const pinned = patch.isPinned ? 1 : 0
    fields.push('is_pinned = ?')
    values.push(pinned)
    after.is_pinned = pinned
  }
  if (!fields.length && !patch.cover) return { ok: false, error: '没有要保存的修改' }

  const placeholders = unique.map(() => '?').join(',')
  const rows = db
    .prepare(`SELECT id, target_id, rating, notes, is_pinned FROM shots WHERE id IN (${placeholders})`)
    .all(...unique) as unknown as ShotEditRow[]
  if (!rows.length) return { ok: false, error: '照片不存在' }

  let cover: { targetId: number; before: number | null; after: number } | null = null
  if (patch.cover) {
    if (rows.length !== 1) return { ok: false, error: '代表图只能选择一张' }
    const targetId = rows[0].target_id
    if (!targetId) return { ok: false, error: '这张照片不属于深空目标，无法设为代表图' }
    const target = db.prepare('SELECT cover_shot_id FROM targets WHERE id = ?').get(targetId) as
      | { cover_shot_id: number | null }
      | undefined
    if (!target) return { ok: false, error: '目标不存在' }
    cover = { targetId, before: target.cover_shot_id, after: rows[0].id }
  }

  const now = nowIso()
  db.exec('BEGIN')
  try {
    if (fields.length) {
      db.prepare(`UPDATE shots SET ${fields.join(', ')}, updated_at = ? WHERE id IN (${placeholders})`).run(
        ...values,
        now,
        ...unique
      )
    }
    if (cover) {
      db.prepare('UPDATE targets SET cover_shot_id = ?, updated_at = ? WHERE id = ?').run(cover.after, now, cover.targetId)
    }
    logChange(db, 'edit_shot', 'shot', rows.length === 1 ? rows[0].id : null, {
      items: rows.map((r) => ({
        id: r.id,
        before: { rating: r.rating, notes: r.notes, is_pinned: r.is_pinned },
        after
      })),
      cover
    })
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    return { ok: false, error: `保存失败：${(err as Error).message}` }
  }

  return { ok: true, updated: rows.length }
}

export interface ReviewItemInput {
  id: number
  totalExposureS?: number
}

/** 按夜次重算总曝光：同目标同夜取最大累计，避免多个成片重复相加 */
function syncNightExposure(db: DB, nightId: number) {
  db.prepare(
    `UPDATE nights SET total_exposure_s = COALESCE((
       SELECT SUM(t.total_s) FROM (
         SELECT MAX(s.total_exposure_s) AS total_s
         FROM shots s
         WHERE s.night_id = ?
         GROUP BY s.target_id, s.sub_type
       ) t
     ), 0) WHERE id = ?`
  ).run(nightId, nightId)
}

/** 人工核对待确认成片：可同时修正总曝光；状态记为 manual，避免重扫覆盖 */
export function resolveReviews(db: DB, items: ReviewItemInput[]) {
  const list = (Array.isArray(items) ? items : [])
    .map((item) => ({ id: Number(item.id), totalExposureS: item.totalExposureS }))
    .filter((item) => Number.isInteger(item.id) && item.id > 0)
  if (!list.length) return { ok: false, error: '没有待保存的核对结果' }

  const now = nowIso()
  const nightIds = new Set<number>()
  let updated = 0

  db.exec('BEGIN')
  try {
    for (const item of list) {
      const row = db.prepare('SELECT night_id FROM shots WHERE id = ?').get(item.id) as
        | { night_id: number | null }
        | undefined
      if (!row) continue
      if (item.totalExposureS !== undefined) {
        const seconds = Math.max(0, Math.min(3600 * 240, Math.round(Number(item.totalExposureS) || 0)))
        db.prepare(
          "UPDATE shots SET total_exposure_s = ?, exposure_source = 'manual', review_state = 'manual', updated_at = ? WHERE id = ?"
        ).run(seconds, now, item.id)
      } else {
        db.prepare("UPDATE shots SET review_state = 'manual', updated_at = ? WHERE id = ?").run(now, item.id)
      }
      if (row.night_id) nightIds.add(row.night_id)
      updated++
    }
    for (const nightId of nightIds) syncNightExposure(db, nightId)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    return { ok: false, error: `保存失败：${(err as Error).message}` }
  }

  return { ok: true, updated }
}

/** 恢复自动值：用留档的水印原文重新解析，回到 pending / ok 与 watermark 来源 */
export function resetReviews(db: DB, ids: number[]) {
  const list = (Array.isArray(ids) ? ids : [])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0)
  if (!list.length) return { ok: false, error: '请选择要恢复的成片' }

  const now = nowIso()
  const nightIds = new Set<number>()
  let updated = 0

  db.exec('BEGIN')
  try {
    for (const id of list) {
      const row = db.prepare('SELECT night_id, watermark_text FROM shots WHERE id = ?').get(id) as
        | { night_id: number | null; watermark_text: string | null }
        | undefined
      if (!row) continue
      const parsed = row.watermark_text ? parseWatermarkText(row.watermark_text) : null
      const seconds = parsed?.exposureMinutes != null ? parsed.exposureMinutes * 60 : 0
      const source = parsed?.exposureMinutes != null ? 'watermark' : null
      const state = parsed && !parsed.needsReview ? 'ok' : 'pending'
      db.prepare(
        'UPDATE shots SET total_exposure_s = ?, exposure_source = ?, review_state = ?, updated_at = ? WHERE id = ?'
      ).run(seconds, source, state, now, id)
      if (row.night_id) nightIds.add(row.night_id)
      updated++
    }
    for (const nightId of nightIds) syncNightExposure(db, nightId)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    return { ok: false, error: `恢复失败：${(err as Error).message}` }
  }

  return { ok: true, updated }
}

export interface VersionPatch {
  versionName?: string
  tags?: string[]
  software?: string
  processedAt?: string
  note?: string
  nightIds?: number[]
  final?: boolean
  move?: 'up' | 'down'
}

interface VersionRow {
  id: number
  night_id: number | null
  target_id: number | null
  version_no: number
  version_name: string | null
  version_tags: string | null
  version_software: string | null
  version_processed_at: string | null
  version_note: string | null
  is_final_version: number
  version_order: number
  version_edited: number
}

function cleanTags(input: unknown) {
  const list = Array.isArray(input) ? input : []
  return [...new Set(list.map((v) => String(v ?? '').trim().slice(0, 30)).filter(Boolean))].slice(0, 20)
}

function readSourceNightIds(db: DB, shotId: number) {
  return (
    db.prepare('SELECT night_id FROM version_sources WHERE version_shot_id = ? ORDER BY night_id').all(shotId) as Array<{
      night_id: number
    }>
  ).map((r) => Number(r.night_id))
}

function normalizeNightIds(db: DB, input: unknown) {
  const ids = [
    ...new Set((Array.isArray(input) ? input : []).map((v) => Number(v)).filter((id) => Number.isInteger(id) && id > 0))
  ]
  if (!ids.length) return [] as number[]
  const placeholders = ids.map(() => '?').join(',')
  const found = (db.prepare(`SELECT id FROM nights WHERE id IN (${placeholders})`).all(...ids) as Array<{ id: number }>).map(
    (r) => Number(r.id)
  )
  if (found.length !== ids.length) return null
  return found.sort((a, b) => a - b)
}

/** 深空按「目标 + 日期」分组，星野按夜次分组（夜次已含日期与子类） */
function versionGroup(db: DB, row: { target_id: number | null; night_id: number | null; id: number }) {
  if (row.target_id === null) {
    if (row.night_id === null) {
      return db
        .prepare('SELECT id, version_order FROM shots WHERE id = ?')
        .all(row.id) as Array<{ id: number; version_order: number }>
    }
    return db
      .prepare(
        `SELECT s.id, s.version_order FROM shots s
         WHERE s.is_final = 1 AND s.night_id IS ?
         ORDER BY s.version_order, s.version_no, s.created_at, s.id`
      )
      .all(row.night_id) as Array<{ id: number; version_order: number }>
  }
  const day =
    (
      db
        .prepare(
          `SELECT COALESCE(n.date, substr(s.captured_at, 1, 10), '') AS day
           FROM shots s LEFT JOIN nights n ON n.id = s.night_id WHERE s.id = ?`
        )
        .get(row.id) as { day: string } | undefined
    )?.day ?? ''
  return db
    .prepare(
      `SELECT s.id, s.version_order FROM shots s LEFT JOIN nights n ON n.id = s.night_id
       WHERE s.is_final = 1 AND s.target_id IS ? AND COALESCE(n.date, substr(s.captured_at, 1, 10), '') = ?
       ORDER BY s.version_order, s.version_no, s.created_at, s.id`
    )
    .all(row.target_id, day) as Array<{ id: number; version_order: number }>
}

/** 版本登记：名称、差异标签、软件、处理日期、备注、来源夜次、最终版、上下移；全部可撤销 */
export function updateVersion(db: DB, shotId: number, patch: VersionPatch) {
  const row = db
    .prepare(
      `SELECT id, night_id, target_id, version_no, version_name, version_tags, version_software,
              version_processed_at, version_note, is_final_version, version_order, version_edited
       FROM shots WHERE id = ? AND is_final = 1`
    )
    .get(shotId) as unknown as VersionRow | undefined
  if (!row) return { ok: false, error: '这张成片不存在' }

  const sourcesBefore = readSourceNightIds(db, shotId)
  let nightIds = sourcesBefore
  if (patch.nightIds !== undefined) {
    const ids = normalizeNightIds(db, patch.nightIds)
    if (ids === null) return { ok: false, error: '有夜次已不存在，请刷新后重试' }
    nightIds = ids
  }

  const editing = ['versionName', 'tags', 'software', 'processedAt', 'note'].some((key) => key in patch)
  const cleanedTags = patch.tags !== undefined ? cleanTags(patch.tags) : null
  const after = {
    version_name:
      patch.versionName !== undefined ? textField(patch.versionName, 60) : row.version_name,
    version_tags:
      patch.tags !== undefined ? (cleanedTags!.length ? JSON.stringify(cleanedTags) : null) : row.version_tags,
    version_software:
      patch.software !== undefined ? textField(patch.software, 60) : row.version_software,
    version_processed_at:
      patch.processedAt !== undefined ? textField(patch.processedAt, 20) : row.version_processed_at,
    version_note: patch.note !== undefined ? textField(patch.note, 1000) : row.version_note,
    version_edited: editing ? 1 : row.version_edited
  }

  // 组内上下移：交换后重排整组序号，避免历史数据序号重复
  const group = versionGroup(db, row)
  const ordersBefore = group.map((g) => ({ id: g.id, order: Number(g.version_order ?? 0) }))
  if (patch.move) {
    const index = group.findIndex((g) => g.id === shotId)
    const swap = patch.move === 'up' ? index - 1 : index + 1
    if (index >= 0 && swap >= 0 && swap < group.length) {
      ;[group[index], group[swap]] = [group[swap], group[index]]
    }
  }
  const order = group.findIndex((g) => g.id === shotId) + 1

  // 最终版：深空按目标唯一，星野按夜次唯一
  const scopeField = row.target_id !== null ? 'target_id' : 'night_id'
  const scopeValue = row.target_id !== null ? row.target_id : row.night_id
  const scopeBefore = (
    db
      .prepare(`SELECT id, is_final_version FROM shots WHERE is_final = 1 AND ${scopeField} IS ? ORDER BY id`)
      .all(scopeValue) as Array<{ id: number; is_final_version: number }>
  ).map((r) => ({ id: Number(r.id), final: Number(r.is_final_version) }))
  const finalAfter = patch.final === undefined ? row.is_final_version : patch.final ? 1 : 0

  const now = nowIso()
  db.exec('BEGIN')
  try {
    db.prepare(
      `UPDATE shots SET version_name = ?, version_tags = ?, version_software = ?, version_processed_at = ?,
         version_note = ?, version_edited = ?, is_final_version = ?, updated_at = ? WHERE id = ?`
    ).run(
      after.version_name,
      after.version_tags,
      after.version_software,
      after.version_processed_at,
      after.version_note,
      after.version_edited,
      finalAfter,
      now,
      shotId
    )
    if (patch.final === true) {
      db.prepare(
        `UPDATE shots SET is_final_version = 0, updated_at = ? WHERE is_final = 1 AND ${scopeField} IS ? AND id != ?`
      ).run(now, scopeValue, shotId)
    }
    const orderUpdate = db.prepare('UPDATE shots SET version_order = ? WHERE id = ?')
    group.forEach((g, i) => orderUpdate.run(i + 1, g.id))
    if (patch.nightIds !== undefined) {
      db.prepare('DELETE FROM version_sources WHERE version_shot_id = ?').run(shotId)
      const link = db.prepare('INSERT OR IGNORE INTO version_sources(version_shot_id, night_id) VALUES(?, ?)')
      for (const id of nightIds) link.run(shotId, id)
    }
    logChange(db, 'edit_version', 'shot', shotId, {
      before: {
        version_name: row.version_name,
        version_tags: row.version_tags,
        version_software: row.version_software,
        version_processed_at: row.version_processed_at,
        version_note: row.version_note,
        version_edited: row.version_edited,
        is_final_version: row.is_final_version,
        version_order: row.version_order,
        nightIds: sourcesBefore
      },
      after: { ...after, is_final_version: finalAfter, version_order: order, nightIds },
      scope: { field: scopeField, value: scopeValue, before: scopeBefore },
      orders: ordersBefore
    })
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    return { ok: false, error: `保存失败：${(err as Error).message}` }
  }

  return { ok: true, updated: 1 }
}

export interface TargetProfilePatch {
  nameEn?: string
  alias?: string
  objectType?: string
  constellation?: string
  distanceLy?: number | null
  magnitude?: number | null
  description?: string
}

interface TargetProfileRow {
  id: number
  name_en: string | null
  alias: string | null
  object_type: string | null
  constellation: string | null
  distance_ly: number | null
  magnitude: number | null
  description: string | null
  source: string | null
  profile_updated_at: string | null
  profile_edited: number
}

function textField(value: unknown, max: number) {
  const text = String(value ?? '').trim().slice(0, max)
  return text || null
}

/** 返回 undefined 表示数值非法 */
function numericField(value: unknown, max: number) {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0 || num > max) return undefined
  return Math.round(num * 10) / 10
}

/** 天体名片编辑：手工保存后标记 profile_edited，扫描不再覆盖；改动写入 change_log 可撤销 */
export function updateTargetProfile(db: DB, targetId: number, patch: TargetProfilePatch) {
  const row = db
    .prepare(
      `SELECT id, name_en, alias, object_type, constellation, distance_ly, magnitude,
              description, source, profile_updated_at, profile_edited
       FROM targets WHERE id = ?`
    )
    .get(targetId) as unknown as TargetProfileRow | undefined
  if (!row) return { ok: false, error: '目标不存在' }

  const distance = patch.distanceLy !== undefined ? numericField(patch.distanceLy, 1e9) : row.distance_ly
  const magnitude = patch.magnitude !== undefined ? numericField(patch.magnitude, 40) : row.magnitude
  if (distance === undefined) return { ok: false, error: '距离需要是不小于 0 的数字' }
  if (magnitude === undefined) return { ok: false, error: '视星等需要是 0 到 40 之间的数字' }

  const before = {
    name_en: row.name_en,
    alias: row.alias,
    object_type: row.object_type,
    constellation: row.constellation,
    distance_ly: row.distance_ly,
    magnitude: row.magnitude,
    description: row.description,
    source: row.source,
    profile_updated_at: row.profile_updated_at,
    profile_edited: row.profile_edited
  }
  const after = {
    name_en: patch.nameEn !== undefined ? textField(patch.nameEn, 120) : row.name_en,
    alias: patch.alias !== undefined ? textField(patch.alias, 200) : row.alias,
    object_type: patch.objectType !== undefined ? textField(patch.objectType, 60) : row.object_type,
    constellation: patch.constellation !== undefined ? textField(patch.constellation, 60) : row.constellation,
    distance_ly: distance,
    magnitude,
    description: patch.description !== undefined ? textField(patch.description, 1200) : row.description,
    source: '手动编辑',
    profile_updated_at: nowIso(),
    profile_edited: 1
  }

  const changed = (Object.keys(after) as Array<keyof typeof after>).some((key) => after[key] !== before[key])
  if (!changed && row.profile_edited === 1) return { ok: true, updated: 0 }

  const now = nowIso()
  db.exec('BEGIN')
  try {
    db.prepare(
      `UPDATE targets SET name_en = ?, alias = ?, object_type = ?, constellation = ?, distance_ly = ?,
         magnitude = ?, description = ?, source = ?, profile_updated_at = ?, profile_edited = 1, updated_at = ?
       WHERE id = ?`
    ).run(
      after.name_en,
      after.alias,
      after.object_type,
      after.constellation,
      after.distance_ly,
      after.magnitude,
      after.description,
      after.source,
      after.profile_updated_at,
      now,
      targetId
    )
    logChange(db, 'edit_target_profile', 'target', targetId, { before, after })
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    return { ok: false, error: `保存失败：${(err as Error).message}` }
  }

  return { ok: true, updated: 1 }
}

export interface NightPatch {
  location?: string
  weather?: string
  seeing?: string
  bortle?: number | null
  notes?: string
  postProcess?: string
  rigIds?: number[]
}

export interface RigPatch {
  id?: number
  name: string
  type?: string
  focalMm?: number | null
  apertureF?: number | null
  device?: string
  notes?: string
}

export interface CreateNightPatch {
  date: string
  category: 'deep_sky' | 'nightscape'
  subType?: string
  location?: string
}

interface NightEditRow {
  id: number
  date: string
  category: string
  sub_type: string
  location: string | null
  weather: string | null
  seeing: string | null
  bortle: number | null
  notes: string | null
  post_process: string | null
}

interface RigRow {
  id: number
  name: string
  type: string
  focal_mm: number | null
  aperture_f: number | null
  device: string | null
  notes: string | null
}

/** 返回 undefined 表示整数非法 */
function intField(value: unknown, min: number, max: number) {
  if (value === null || value === undefined || value === '') return null
  const num = Math.round(Number(value))
  if (!Number.isFinite(num) || num < min || num > max) return undefined
  return num
}

function normalizeRigIds(db: DB, input: unknown): number[] | null {
  const ids = [...new Set((Array.isArray(input) ? input : []).map((v) => Number(v)).filter((id) => Number.isInteger(id) && id > 0))]
  if (!ids.length) return []
  const placeholders = ids.map(() => '?').join(',')
  const found = (db.prepare(`SELECT id FROM rigs WHERE id IN (${placeholders})`).all(...ids) as Array<{ id: number }>).map(
    (r) => Number(r.id)
  )
  if (found.length !== ids.length) return null
  return found.sort((a, b) => a - b)
}

/** 夜次详情编辑：地点/天气/视宁度/波特尔/备注 + 参与器材，改动可撤销 */
export function updateNight(db: DB, nightId: number, patch: NightPatch) {
  const row = db
    .prepare(
      'SELECT id, date, category, sub_type, location, weather, seeing, bortle, notes, post_process FROM nights WHERE id = ?'
    )
    .get(nightId) as unknown as NightEditRow | undefined
  if (!row) return { ok: false, error: '夜次不存在' }

  const bortle = patch.bortle !== undefined ? intField(patch.bortle, 1, 9) : row.bortle
  if (bortle === undefined) return { ok: false, error: '波特尔等级需要是 1 到 9 的整数' }

  const beforeRigs = (
    db.prepare('SELECT rig_id FROM night_rigs WHERE night_id = ? ORDER BY rig_id').all(nightId) as Array<{ rig_id: number }>
  ).map((r) => Number(r.rig_id))
  let afterRigs = beforeRigs
  if (patch.rigIds !== undefined) {
    const ids = normalizeRigIds(db, patch.rigIds)
    if (ids === null) return { ok: false, error: '有器材已不存在，请刷新器材库后重试' }
    afterRigs = ids
  }

  const after = {
    location: patch.location !== undefined ? textField(patch.location, 120) : row.location,
    weather: patch.weather !== undefined ? textField(patch.weather, 200) : row.weather,
    seeing: patch.seeing !== undefined ? textField(patch.seeing, 60) : row.seeing,
    bortle,
    notes: patch.notes !== undefined ? textField(patch.notes, 2000) : row.notes,
    post_process: patch.postProcess !== undefined ? textField(patch.postProcess, 2000) : row.post_process
  }
  const fieldsChanged = (Object.keys(after) as Array<keyof typeof after>).some((key) => after[key] !== row[key])
  const rigsChanged = afterRigs.join(',') !== beforeRigs.join(',')
  if (!fieldsChanged && !rigsChanged) return { ok: true, updated: 0 }

  const now = nowIso()
  db.exec('BEGIN')
  try {
    db.prepare(
      'UPDATE nights SET location = ?, weather = ?, seeing = ?, bortle = ?, notes = ?, post_process = ?, updated_at = ? WHERE id = ?'
    ).run(after.location, after.weather, after.seeing, after.bortle, after.notes, after.post_process, now, nightId)
    if (rigsChanged) {
      db.prepare('DELETE FROM night_rigs WHERE night_id = ?').run(nightId)
      const insert = db.prepare('INSERT OR IGNORE INTO night_rigs(night_id, rig_id) VALUES(?, ?)')
      for (const rigId of afterRigs) insert.run(nightId, rigId)
    }
    logChange(db, 'edit_night', 'night', nightId, {
      before: {
        location: row.location,
        weather: row.weather,
        seeing: row.seeing,
        bortle: row.bortle,
        notes: row.notes,
        post_process: row.post_process,
        rigIds: beforeRigs
      },
      after: { ...after, rigIds: afterRigs }
    })
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    return { ok: false, error: `保存失败：${(err as Error).message}` }
  }

  return { ok: true, updated: 1 }
}

/** 新增或编辑器材；新增撤销时删除，编辑撤销时还原字段 */
export function saveRig(db: DB, patch: RigPatch) {
  const name = textField(patch.name, 60)
  if (!name) return { ok: false, error: '器材名称不能为空' }

  const focal = patch.focalMm !== undefined ? numericField(patch.focalMm, 5000) : null
  const aperture = patch.apertureF !== undefined ? numericField(patch.apertureF, 100) : null
  if (focal === undefined) return { ok: false, error: '焦距需要是不小于 0 的数字' }
  if (aperture === undefined) return { ok: false, error: '光圈需要是不小于 0 的数字' }

  const after = {
    name,
    type: textField(patch.type, 60) ?? '',
    focal_mm: focal,
    aperture_f: aperture,
    device: textField(patch.device, 40),
    notes: textField(patch.notes, 500)
  }
  const id = patch.id ? Number(patch.id) : 0
  const dup = db
    .prepare('SELECT id FROM rigs WHERE name = ? AND id != ?')
    .get(name, id || -1) as { id: number } | undefined
  if (dup) return { ok: false, error: '已有同名器材，换个名称吧' }

  const now = nowIso()
  const before = id
    ? ((db.prepare('SELECT id, name, type, focal_mm, aperture_f, device, notes FROM rigs WHERE id = ?').get(id) as
        | RigRow
        | undefined) ?? null)
    : null
  if (id && !before) return { ok: false, error: '器材不存在' }

  db.exec('BEGIN')
  try {
    let savedId = id
    if (before) {
      db.prepare(
        'UPDATE rigs SET name = ?, type = ?, focal_mm = ?, aperture_f = ?, device = ?, notes = ?, updated_at = ? WHERE id = ?'
      ).run(after.name, after.type, after.focal_mm, after.aperture_f, after.device, after.notes, now, id)
    } else {
      const info = db
        .prepare(
          'INSERT INTO rigs(name, type, focal_mm, aperture_f, device, notes, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(after.name, after.type, after.focal_mm, after.aperture_f, after.device, after.notes, now, now)
      savedId = Number(info.lastInsertRowid)
    }
    logChange(db, 'save_rig', 'rig', savedId, { before, after })
    db.exec('COMMIT')
    return { ok: true, id: savedId, updated: 1 }
  } catch (err) {
    db.exec('ROLLBACK')
    return { ok: false, error: `保存失败：${(err as Error).message}` }
  }
}

/** 先建空夜次：不创建文件夹，后续导入成片时由扫描自动关联 */
export function createNight(db: DB, patch: CreateNightPatch) {
  const date = String(patch.date ?? '').trim()
  const parsed = new Date(`${date}T12:00:00`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime())) {
    return { ok: false, error: '日期需要是 YYYY-MM-DD 格式' }
  }
  const category = patch.category === 'deep_sky' ? 'deep_sky' : patch.category === 'nightscape' ? 'nightscape' : null
  if (!category) return { ok: false, error: '请选择深空或星野' }

  const subType = category === 'deep_sky' ? '' : (textField(patch.subType, 20) ?? '其他')
  const location = textField(patch.location, 120)
  const exists = db
    .prepare('SELECT id FROM nights WHERE date = ? AND category = ? AND sub_type = ?')
    .get(date, category, subType) as { id: number } | undefined
  if (exists) return { ok: false, error: '该日期已有同类夜次，可直接在夜次记录里编辑' }

  const now = nowIso()
  db.exec('BEGIN')
  try {
    const info = db
      .prepare('INSERT INTO nights(date, category, sub_type, location, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)')
      .run(date, category, subType, location, now, now)
    const id = Number(info.lastInsertRowid)
    logChange(db, 'create_night', 'night', id, { id, date, category, subType, location })
    db.exec('COMMIT')
    return { ok: true, id, updated: 1 }
  } catch (err) {
    db.exec('ROLLBACK')
    return { ok: false, error: `新建失败：${(err as Error).message}` }
  }
}

function undoEditNight(
  db: DB,
  row: { id: number; entity: string; entity_id: number; detail_json: string }
): UndoResult {
  const detail = JSON.parse(row.detail_json) as {
    before?: {
      location: string | null
      weather: string | null
      seeing: string | null
      bortle: number | null
      notes: string | null
      post_process?: string | null
      rigIds?: number[]
    }
  }
  if (!detail.before) return { ok: false, error: '这条记录缺少原始数据，无法撤销' }
  const b = detail.before

  db.exec('BEGIN')
  try {
    db.prepare(
      'UPDATE nights SET location = ?, weather = ?, seeing = ?, bortle = ?, notes = ?, post_process = ?, updated_at = ? WHERE id = ?'
    ).run(b.location, b.weather, b.seeing, b.bortle, b.notes, b.post_process ?? null, nowIso(), row.entity_id)
    db.prepare('DELETE FROM night_rigs WHERE night_id = ?').run(row.entity_id)
    const insert = db.prepare('INSERT OR IGNORE INTO night_rigs(night_id, rig_id) VALUES(?, ?)')
    for (const rigId of b.rigIds ?? []) insert.run(row.entity_id, rigId)
    db.prepare('UPDATE change_log SET undone = 1 WHERE id = ?').run(row.id)
    logChange(db, 'undo_edit_night', row.entity, row.entity_id, {}, false)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    return { ok: false, error: `撤销失败：${(err as Error).message}` }
  }

  return { ok: true, kind: 'night', restored: 1 }
}

function undoRigSave(
  db: DB,
  row: { id: number; entity: string; entity_id: number; detail_json: string }
): UndoResult {
  const detail = JSON.parse(row.detail_json) as { before?: RigRow | null }
  db.exec('BEGIN')
  try {
    if (!detail.before) {
      db.prepare('DELETE FROM night_rigs WHERE rig_id = ?').run(row.entity_id)
      db.prepare('DELETE FROM rigs WHERE id = ?').run(row.entity_id)
    } else {
      const b = detail.before
      db.prepare(
        'UPDATE rigs SET name = ?, type = ?, focal_mm = ?, aperture_f = ?, device = ?, notes = ?, updated_at = ? WHERE id = ?'
      ).run(b.name, b.type, b.focal_mm, b.aperture_f, b.device, b.notes, nowIso(), row.entity_id)
    }
    db.prepare('UPDATE change_log SET undone = 1 WHERE id = ?').run(row.id)
    logChange(db, 'undo_save_rig', row.entity, row.entity_id, {}, false)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    return { ok: false, error: `撤销失败：${(err as Error).message}` }
  }

  return { ok: true, kind: 'rig', restored: 1 }
}

function undoCreateNight(
  db: DB,
  row: { id: number; entity: string; entity_id: number }
): UndoResult {
  const shots = Number(
    (db.prepare('SELECT COUNT(*) AS c FROM shots WHERE night_id = ?').get(row.entity_id) as { c: number } | undefined)?.c ?? 0
  )
  const assets = Number(
    (db.prepare('SELECT COUNT(*) AS c FROM assets WHERE night_id = ?').get(row.entity_id) as { c: number } | undefined)?.c ?? 0
  )
  if (shots + assets > 0) return { ok: false, error: '夜次下已有成片或视频，不能撤销新建' }

  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM night_rigs WHERE night_id = ?').run(row.entity_id)
    db.prepare('DELETE FROM nights WHERE id = ?').run(row.entity_id)
    db.prepare('UPDATE change_log SET undone = 1 WHERE id = ?').run(row.id)
    logChange(db, 'undo_create_night', row.entity, row.entity_id, {}, false)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    return { ok: false, error: `撤销失败：${(err as Error).message}` }
  }

  return { ok: true, kind: 'night', restored: 1 }
}

function undoEditTargetProfile(
  db: DB,
  row: { id: number; entity: string; entity_id: number; detail_json: string }
): UndoResult {
  const detail = JSON.parse(row.detail_json) as { before?: TargetProfileRow }
  if (!detail.before) return { ok: false, error: '这条记录缺少原始资料，无法撤销' }
  const b = detail.before

  db.exec('BEGIN')
  try {
    db.prepare(
      `UPDATE targets SET name_en = ?, alias = ?, object_type = ?, constellation = ?, distance_ly = ?,
         magnitude = ?, description = ?, source = ?, profile_updated_at = ?, profile_edited = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      b.name_en,
      b.alias,
      b.object_type,
      b.constellation,
      b.distance_ly,
      b.magnitude,
      b.description,
      b.source,
      b.profile_updated_at,
      Number(b.profile_edited ?? 0) ? 1 : 0,
      nowIso(),
      row.entity_id
    )
    db.prepare('UPDATE change_log SET undone = 1 WHERE id = ?').run(row.id)
    logChange(db, 'undo_edit_profile', row.entity, row.entity_id, {}, false)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    return { ok: false, error: `撤销失败：${(err as Error).message}` }
  }

  return { ok: true, kind: 'profile', restored: 1 }
}

function undoEditShot(
  db: DB,
  row: { id: number; entity: string; entity_id: number; detail_json: string }
): UndoResult {
  const detail = JSON.parse(row.detail_json) as {
    items?: Array<{ id: number; before: { rating: number; notes: string | null; is_pinned: number } }>
    cover?: { targetId: number; before: number | null } | null
  }
  const items = detail.items ?? []

  db.exec('BEGIN')
  try {
    for (const item of items) {
      db.prepare('UPDATE shots SET rating = ?, notes = ?, is_pinned = ?, updated_at = ? WHERE id = ?').run(
        item.before.rating,
        item.before.notes,
        item.before.is_pinned ? 1 : 0,
        nowIso(),
        item.id
      )
    }
    if (detail.cover) {
      db.prepare('UPDATE targets SET cover_shot_id = ?, updated_at = ? WHERE id = ?').run(
        detail.cover.before,
        nowIso(),
        detail.cover.targetId
      )
    }
    db.prepare('UPDATE change_log SET undone = 1 WHERE id = ?').run(row.id)
    logChange(db, 'undo_edit', row.entity, row.entity_id, { items: items.length }, false)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    return { ok: false, error: `撤销失败：${(err as Error).message}` }
  }

  return { ok: true, kind: 'edit', restored: items.length }
}

function undoEditVersion(
  db: DB,
  row: { id: number; entity: string; entity_id: number; detail_json: string }
): UndoResult {
  const detail = JSON.parse(row.detail_json) as {
    before?: {
      version_name: string | null
      version_tags: string | null
      version_software: string | null
      version_processed_at: string | null
      version_note: string | null
      version_edited: number
      is_final_version: number
      version_order: number
      nightIds?: number[]
    }
    scope?: { field: 'target_id' | 'night_id'; value: number | null; before: Array<{ id: number; final: number }> }
    orders?: Array<{ id: number; order: number }>
  }
  const before = detail.before
  if (!before) return { ok: false, error: '这条记录缺少原始数据，无法撤销' }

  db.exec('BEGIN')
  try {
    db.prepare(
      `UPDATE shots SET version_name = ?, version_tags = ?, version_software = ?, version_processed_at = ?,
         version_note = ?, version_edited = ?, is_final_version = ?, updated_at = ? WHERE id = ?`
    ).run(
      before.version_name,
      before.version_tags,
      before.version_software,
      before.version_processed_at,
      before.version_note,
      before.version_edited,
      before.is_final_version,
      nowIso(),
      row.entity_id
    )
    db.prepare('DELETE FROM version_sources WHERE version_shot_id = ?').run(row.entity_id)
    const link = db.prepare('INSERT OR IGNORE INTO version_sources(version_shot_id, night_id) VALUES(?, ?)')
    for (const nightId of before.nightIds ?? []) link.run(row.entity_id, nightId)
    for (const item of detail.orders ?? []) {
      db.prepare('UPDATE shots SET version_order = ? WHERE id = ?').run(item.order, item.id)
    }
    for (const item of detail.scope?.before ?? []) {
      db.prepare('UPDATE shots SET is_final_version = ? WHERE id = ?').run(item.final ? 1 : 0, item.id)
    }
    db.prepare('UPDATE change_log SET undone = 1 WHERE id = ?').run(row.id)
    logChange(db, 'undo_edit_version', row.entity, row.entity_id, {}, false)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    return { ok: false, error: `撤销失败：${(err as Error).message}` }
  }

  return { ok: true, kind: 'version', restored: 1 }
}

export interface UndoRow {
  id: number
  action: string
  entity: string
  entity_id: number
  detail_json: string
}

type UndoHandler = (db: DB, root: string, row: UndoRow) => UndoResult

const undoHandlers = new Map<string, UndoHandler>()

/** 由具体业务模块注册自己的撤销实现，避免 files.ts 反向依赖它们 */
export function registerUndoHandler(action: string, handler: UndoHandler) {
  undoHandlers.set(action, handler)
}

export function undoLastChange(db: DB, root: string, thumbsDir: string): UndoResult {
  const row = db
    .prepare(
      `SELECT * FROM change_log
       WHERE action IN ('rename_folder', 'import_files', 'edit_shot', 'edit_target_profile',
                        'edit_night', 'save_rig', 'create_night', 'edit_version', 'sync_files')
         AND undoable = 1 AND undone = 0
       ORDER BY id DESC LIMIT 1`
    )
    .get() as UndoRow | undefined
  if (!row) return { ok: false, error: '没有可撤销的操作' }
  const handler = undoHandlers.get(row.action)
  if (handler) return handler(db, root, row)
  if (row.action === 'import_files') return undoImportFiles(db, root, row)
  if (row.action === 'edit_shot') return undoEditShot(db, row)
  if (row.action === 'edit_target_profile') return undoEditTargetProfile(db, row)
  if (row.action === 'edit_night') return undoEditNight(db, row)
  if (row.action === 'save_rig') return undoRigSave(db, row)
  if (row.action === 'create_night') return undoCreateNight(db, row)
  if (row.action === 'edit_version') return undoEditVersion(db, row)

  const detail = JSON.parse(row.detail_json) as { oldRel: string; newRel: string; oldName: string; newName: string }
  const oldAbs = path.join(root, detail.oldRel)
  const newAbs = path.join(root, detail.newRel)
  if (!fs.existsSync(newAbs)) return { ok: false, error: '原文件夹已不存在，无法撤销' }
  if (fs.existsSync(oldAbs)) return { ok: false, error: '原名称已被占用，无法撤销' }

  const shotRows = db
    .prepare('SELECT id, file_rel, mtime, bytes FROM shots WHERE file_rel LIKE ?')
    .all(`${detail.newRel}/%`) as unknown as ShotRelRow[]

  try {
    fs.renameSync(newAbs, oldAbs)
  } catch (err) {
    return { ok: false, error: `撤销失败：${(err as Error).message}` }
  }

  try {
    db.exec('BEGIN')
    if (row.entity === 'target') {
      db.prepare('UPDATE targets SET name_cn = ?, folder_rel = ?, updated_at = ? WHERE id = ?').run(
        detail.oldName,
        detail.oldRel,
        nowIso(),
        row.entity_id
      )
    } else {
      db.prepare('UPDATE nights SET location = ?, folder_rel = ?, updated_at = ? WHERE id = ?').run(
        detail.oldName,
        detail.oldRel,
        nowIso(),
        row.entity_id
      )
    }
    rewriteRelPrefix(db, 'shots', detail.newRel, detail.oldRel)
    rewriteRelPrefix(db, 'assets', detail.newRel, detail.oldRel)
    db.prepare('UPDATE change_log SET undone = 1 WHERE id = ?').run(row.id)
    logChange(db, 'undo_rename', row.entity, row.entity_id, detail, false)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    try {
      fs.renameSync(oldAbs, newAbs)
    } catch {
      /* ignore */
    }
    return { ok: false, error: `撤销失败：${(err as Error).message}` }
  }

  migrateThumbs(thumbsDir, shotRows, detail.newRel, detail.oldRel)
  return { ok: true, kind: 'rename' }
}

function undoImportFiles(
  db: DB,
  root: string,
  row: { id: number; detail_json: string }
): UndoResult {
  const detail = JSON.parse(row.detail_json) as {
    items?: Array<{ fromRel: string; toRel: string }>
    createdDirs?: string[]
  }
  const items = detail.items ?? []
  if (!items.length) return { ok: false, error: '这次导入没有可恢复的文件' }

  const restored: string[] = []
  const errors: string[] = []
  for (const item of items) {
    const fromAbs = path.join(root, item.toRel)
    if (!fs.existsSync(fromAbs)) {
      errors.push(`${path.basename(item.toRel)} 已不在归档位置`)
      continue
    }
    try {
      const backAbs = uniqueFilePath(path.join(root, item.fromRel))
      fs.mkdirSync(path.dirname(backAbs), { recursive: true })
      moveFile(fromAbs, backAbs)
      restored.push(item.toRel)
    } catch (err) {
      errors.push(`${path.basename(item.toRel)}：${(err as Error).message}`)
    }
  }

  if (!restored.length) return { ok: false, error: errors[0] ?? '没有文件可以恢复' }

  // 清掉本次导入新建、现在已空的文件夹，避免撤销后残留空目标
  const createdDirs = (detail.createdDirs ?? [])
    .map((rel) => path.join(root, rel))
    .sort((a, b) => b.length - a.length)
  for (const dir of createdDirs) {
    try {
      fs.rmdirSync(dir)
    } catch {
      /* 非空或已被删除，保留现场 */
    }
  }

  db.exec('BEGIN')
  try {
    db.prepare('UPDATE change_log SET undone = 1 WHERE id = ?').run(row.id)
    logChange(db, 'undo_import', 'inbox', null, { items: detail.items, restored }, false)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    return { ok: false, error: `撤销失败：${(err as Error).message}` }
  }

  return { ok: true, kind: 'import', restored: restored.length, errors: errors.slice(0, 20) }
}
