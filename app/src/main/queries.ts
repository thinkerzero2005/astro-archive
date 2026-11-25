import fs from 'node:fs'
import path from 'node:path'
import { DB } from './db'
import { thumbKey } from './thumbs'

export function localUrl(absPath: string) {
  return `astro://local/${encodeURIComponent(absPath)}`
}

function thumbUrl(key: string, size: number) {
  return `astro://thumb/${key}/${size}.webp`
}

interface ShotRow {
  id: number
  night_id: number | null
  target_id: number | null
  sub_type: string | null
  file_rel: string
  file_name: string
  ext: string
  bytes: number
  width: number | null
  height: number | null
  captured_at: string | null
  device: string | null
  camera_model: string | null
  lens: string | null
  exposure_s: number | null
  iso: number | null
  f_number: number | null
  frame_count: number
  total_exposure_s: number
  rating: number
  is_pinned: number
  notes: string | null
  ar: number
  strip_ratio: number
  mtime: number
  version_no: number
  version_name: string | null
  version_tags: string | null
  version_software: string | null
  version_processed_at: string | null
  version_note: string | null
  is_final_version: number
  version_order: number
  version_edited: number
  exposure_source: string | null
  watermark_text: string | null
  review_state: string
}

interface TargetRow {
  id: number
  catalog_id: string
  name_cn: string
  name_en: string | null
  object_type: string | null
  constellation: string | null
  distance_ly: number | null
  ra: string | null
  dec: string | null
  folder_rel: string
  cover_shot_id: number | null
  pinned: number
  alias: string | null
  magnitude: number | null
  description: string | null
  source: string | null
  profile_updated_at: string | null
  profile_edited: number
  updated_at: string
}

interface NightRow {
  id: number
  date: string
  category: 'deep_sky' | 'nightscape'
  sub_type: string
  location: string | null
  folder_rel: string | null
  total_exposure_s: number
  weather?: string | null
  seeing?: string | null
  bortle?: number | null
}

interface NightFullRow extends NightRow {
  weather: string | null
  moon_illum: number | null
  moon_phase: string | null
  seeing: string | null
  bortle: number | null
  notes: string | null
  post_process: string | null
  created_at: string
  updated_at: string
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

interface AssetRow {
  id: number
  shot_id: number | null
  night_id: number | null
  kind: string
  file_rel: string
  bytes: number
  width: number | null
  height: number | null
  duration_s: number | null
  fps: number | null
  codec: string | null
  created_at: string
}

const SHOT_COLS = `id, night_id, target_id, sub_type, file_rel, file_name, ext, bytes, width, height,
  captured_at, device, camera_model, lens, exposure_s, iso, f_number, frame_count, total_exposure_s,
  rating, is_pinned, notes, ar, strip_ratio, mtime,
  version_no, version_name, version_tags, version_software, version_processed_at, version_note,
  is_final_version, version_order, version_edited, exposure_source, watermark_text, review_state`

function shotThumb(row: Pick<ShotRow, 'file_rel' | 'mtime' | 'bytes'>, size: number) {
  return thumbUrl(thumbKey(row.file_rel, row.mtime, row.bytes), size)
}

function versionTags(raw: string | null) {
  if (!raw) return [] as string[]
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.map((v) => String(v)).filter(Boolean) : []
  } catch {
    return [] as string[]
  }
}

function videoDto(row: AssetRow, root: string) {
  const durationS = Number(row.duration_s ?? 0)
  const fps = Number(row.fps ?? 0)
  return {
    id: row.id,
    fileName: path.basename(row.file_rel),
    fileUrl: localUrl(path.join(root, row.file_rel)),
    bytes: Number(row.bytes ?? 0),
    durationS,
    fps,
    frameCount: fps > 0 && durationS > 0 ? Math.round(durationS * fps) : 0,
    ar: row.width && row.height ? row.width / row.height : 16 / 9
  }
}

function videosOfNight(db: DB, root: string, nightId: number) {
  const rows = db
    .prepare(`SELECT * FROM assets WHERE kind = 'video' AND night_id = ? ORDER BY file_rel`)
    .all(nightId) as unknown as AssetRow[]
  return rows.map((row) => videoDto(row, root))
}

function videoCountByType(db: DB) {
  const rows = db
    .prepare(
      `SELECT n.sub_type AS type, COUNT(*) AS c
       FROM assets a JOIN nights n ON n.id = a.night_id
       WHERE a.kind = 'video' GROUP BY n.sub_type`
    )
    .all() as Array<{ type: string | null; c: number }>
  return new Map(rows.map((r) => [r.type || '其他', Number(r.c)]))
}

function targetTitle(catalogId: string, nameCn: string) {
  return nameCn && nameCn !== catalogId ? `${catalogId} · ${nameCn}` : catalogId
}

function moonInfo(date: Date) {
  const synodic = 29.530588853
  const days = (date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000
  const phase = ((days % synodic) + synodic) % synodic
  const illum = Math.round(((1 - Math.cos((2 * Math.PI * phase) / synodic)) / 2) * 100)
  const names = ['新月', '娥眉月', '上弦月', '盈凸月', '满月', '亏凸月', '下弦月', '残月']
  const idx = Math.round((phase / synodic) * 8) % 8
  return { phase: names[idx], illum }
}

function countInbox(root: string) {
  const dir = path.join(root, '_收件箱')
  let count = 0
  const walk = (d: string, depth: number) => {
    if (depth > 3) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isFile()) count++
      else if (e.isDirectory()) walk(path.join(d, e.name), depth + 1)
    }
  }
  walk(dir, 0)
  return count
}

function exposureByTarget(db: DB) {
  const rows = db
    .prepare(
      `SELECT target_id, COUNT(*) AS nights, SUM(total_s) AS exposure, SUM(finals) AS finals
       FROM (
         SELECT target_id, night_id, MAX(total_exposure_s) AS total_s, COUNT(*) AS finals
         FROM shots WHERE target_id IS NOT NULL
         GROUP BY target_id, night_id
       ) GROUP BY target_id`
    )
    .all() as Array<{ target_id: number; nights: number; exposure: number; finals: number }>
  return new Map(rows.map((r) => [r.target_id, r]))
}

export function getTargets(db: DB, root: string) {
  const targets = db.prepare('SELECT * FROM targets ORDER BY updated_at DESC').all() as unknown as TargetRow[]
  const agg = exposureByTarget(db)
  const latestShot = db.prepare(
    `SELECT ${SHOT_COLS} FROM shots WHERE target_id = ? ORDER BY COALESCE(captured_at, '') DESC, mtime DESC LIMIT 1`
  )
  const now = Date.now()
  return targets.map((t) => {
    const a = agg.get(t.id)
    const cover = db
      .prepare(
        `SELECT ${SHOT_COLS} FROM shots WHERE target_id = ?
         ORDER BY (id = ?) DESC, is_pinned DESC, COALESCE(captured_at, '') DESC, mtime DESC LIMIT 1`
      )
      .get(t.id, t.cover_shot_id ?? -1) as unknown as ShotRow | undefined
    const latest = latestShot.get(t.id) as unknown as ShotRow | undefined
    const isNew = latest ? now - new Date(latest.captured_at ?? latest.mtime).getTime() < 14 * 86400000 : false
    return {
      id: t.id,
      catalogId: t.catalog_id,
      nameCn: t.name_cn,
      nameEn: t.name_en,
      title: targetTitle(t.catalog_id, t.name_cn),
      pinned: t.pinned,
      nights: Number(a?.nights ?? 0),
      finals: Number(a?.finals ?? 0),
      exposureS: Number(a?.exposure ?? 0),
      thumbUrl: cover ? shotThumb(cover, 320) : null,
      isNew
    }
  })
}

export function getOverview(db: DB, root: string) {
  const targets = getTargets(db, root)
  const nightRows = db.prepare('SELECT * FROM nights ORDER BY date DESC, id DESC').all() as unknown as NightRow[]
  const shots = db.prepare(`SELECT ${SHOT_COLS} FROM shots`).all() as unknown as ShotRow[]

  const deepShots = shots.filter((s) => s.target_id !== null)
  const nsShots = shots.filter((s) => s.target_id === null)
  const videoCounts = videoCountByType(db)
  const videoTotal = [...videoCounts.values()].reduce((sum, c) => sum + c, 0)
  const byType: Record<string, number> = { 银河: 0, 星轨: 0, 延时: 0, 其他: 0 }
  for (const s of nsShots) {
    const key = s.sub_type ?? '其他'
    byType[key] = (byType[key] ?? 0) + 1
  }
  for (const [key, count] of videoCounts) byType[key] = (byType[key] ?? 0) + count

  const exposureS = targets.reduce((sum, t) => sum + t.exposureS, 0)

  // 最近成片 / 置顶
  const heroShot = db
    .prepare(
      `SELECT ${SHOT_COLS} FROM shots
       WHERE target_id IS NOT NULL
       ORDER BY is_pinned DESC, COALESCE(captured_at, '') DESC, mtime DESC LIMIT 1`
    )
    .get() as unknown as ShotRow | undefined

  let hero = null
  if (heroShot) {
    const t = db.prepare('SELECT * FROM targets WHERE id = ?').get(heroShot.target_id) as unknown as TargetRow | undefined
    const agg = t ? exposureByTarget(db).get(t.id) : undefined
    const deviceLabel =
      heroShot.device === 'DWARFMINI' ? 'DWARF mini' : heroShot.device === 'CANON' ? 'Canon' : heroShot.device === 'PHONE' ? '手机' : '—'
    const expLabel = heroShot.exposure_s
      ? heroShot.frame_count > 0
        ? `${Math.round(heroShot.exposure_s)} s × ${heroShot.frame_count}`
        : `单张 ${Math.round(heroShot.exposure_s)} s`
      : '曝光未知'
    const hours = Number(agg?.exposure ?? 0) / 3600
    hero = {
      shotId: heroShot.id,
      targetId: t?.id ?? null,
      nameCn: t ? targetTitle(t.catalog_id, t.name_cn) : heroShot.file_name,
      nameEn: t?.name_en ?? '',
      constellation: t?.constellation ?? '',
      distanceLy: t?.distance_ly ?? null,
      date: (heroShot.captured_at ?? '').slice(0, 10),
      pinned: heroShot.is_pinned === 1,
      thumbUrl: shotThumb(heroShot, 1600),
      facts: [
        hours >= 0.1 ? `累计 ${hours.toFixed(1)} h` : '累计曝光待补',
        deviceLabel,
        expLabel,
        `${Number(agg?.finals ?? 1)} 张成片`
      ]
    }
  }

  // 星野三条入口：每个类型取最近一次夜次
  const latestVideoNight = db.prepare(
    `SELECT n.id, n.date, n.location FROM assets a JOIN nights n ON n.id = a.night_id
     WHERE a.kind = 'video' AND n.sub_type = ? ORDER BY n.date DESC LIMIT 1`
  )
  const nsItems = (['银河', '星轨', '延时'] as const).map((type) => {
    const typeShots = nsShots.filter((s) => (s.sub_type ?? '其他') === type)
    const latest = typeShots.sort((a, b) => (b.captured_at ?? '').localeCompare(a.captured_at ?? ''))[0]
    const night = latest?.night_id ? nightRows.find((n) => n.id === latest.night_id) : null
    const videoNight = night
      ? null
      : (latestVideoNight.get(type) as { id: number; date: string; location: string | null } | undefined)
    return {
      type,
      count: typeShots.length + (videoCounts.get(type) ?? 0),
      nightId: night?.id ?? videoNight?.id ?? null,
      date: night?.date ?? videoNight?.date ?? '',
      location: night?.location ?? videoNight?.location ?? '未标注',
      thumbUrl: latest ? shotThumb(latest, 320) : null
    }
  })

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const marks = nightRows
    .filter((n) => n.date.startsWith(`${year}-${String(month).padStart(2, '0')}`))
    .map((n) => Number(n.date.slice(8, 10)))

  const recentNights = nightRows.slice(0, 4).map((n) => ({
    id: n.id,
    date: n.date,
    category: n.category,
    subType: n.sub_type,
    location: n.location ?? (n.category === 'deep_sky' ? '深空拍摄' : '未标注'),
    exposureS: Number(n.total_exposure_s ?? 0)
  }))

  return {
    libraryRoot: root,
    lastScanAt: String(
      (db.prepare(`SELECT value FROM settings WHERE key = 'last_scan_at'`).get() as { value?: string } | undefined)?.value ?? ''
    ),
    stats: {
      targets: targets.length,
      nights: nightRows.length,
      exposureS,
      nightscapeWorks: nsShots.length + videoTotal,
      finals: shots.length,
      deepSkyFinals: deepShots.length,
      byType
    },
    hero,
    targets: targets.slice(0, 8),
    nightscape: {
      items: nsItems,
      byType
    },
    recentNights,
    calendar: {
      year,
      month,
      today: now.getDate(),
      marks,
      moon: moonInfo(now)
    },
    pendingInbox: countInbox(root)
  }
}

export function getTargetDetail(db: DB, root: string, targetId: number) {
  const target = db.prepare('SELECT * FROM targets WHERE id = ?').get(targetId) as unknown as TargetRow | undefined
  if (!target) return null

  const shots = db
    .prepare(`SELECT ${SHOT_COLS} FROM shots WHERE target_id = ? ORDER BY COALESCE(captured_at, '') DESC, mtime DESC`)
    .all(targetId) as unknown as ShotRow[]

  const nights = db.prepare('SELECT * FROM nights').all() as unknown as NightRow[]
  const nightById = new Map(nights.map((n) => [n.id, n]))

  const groupsMap = new Map<string, { nightId: number | null; date: string; shots: ShotRow[] }>()
  for (const s of shots) {
    const night = s.night_id ? nightById.get(s.night_id) : undefined
    const date = night?.date ?? (s.captured_at ?? '').slice(0, 10) ?? '未知日期'
    const key = `${s.night_id ?? 'x'}-${date}`
    if (!groupsMap.has(key)) groupsMap.set(key, { nightId: s.night_id, date, shots: [] })
    groupsMap.get(key)!.shots.push(s)
  }

  const rawCount = db
    .prepare(`SELECT COUNT(*) AS c FROM assets a WHERE a.kind = 'raw' AND a.file_rel LIKE ?`)
    .get(`${target.folder_rel}/原始/%`) as { c: number }

  const sourceMap = new Map<number, number[]>()
  const sourceRows = db
    .prepare(
      `SELECT vs.version_shot_id, vs.night_id FROM version_sources vs
       JOIN shots s ON s.id = vs.version_shot_id WHERE s.target_id = ?`
    )
    .all(targetId) as Array<{ version_shot_id: number; night_id: number }>
  for (const row of sourceRows) {
    const list = sourceMap.get(Number(row.version_shot_id)) ?? []
    list.push(Number(row.night_id))
    sourceMap.set(Number(row.version_shot_id), list)
  }

  const groups = [...groupsMap.values()].map((g) => {
    const devices = [...new Set(g.shots.map((s) => s.device).filter(Boolean))] as string[]
    const ordered = [...g.shots].sort(
      (a, b) =>
        Number(b.is_final_version) - Number(a.is_final_version) ||
        Number(a.version_order) - Number(b.version_order) ||
        Number(a.version_no) - Number(b.version_no)
    )
    return {
      nightId: g.nightId,
      date: g.date,
      device: devices.length ? devices.join(' / ') : '—',
      exposureS: Math.max(...g.shots.map((s) => Number(s.total_exposure_s || 0)), 0),
      nightshots: g.shots.length,
      shots: ordered.map((s, index) => ({
        id: s.id,
        fileName: s.file_name,
        thumbUrl: shotThumb(s, 124),
        fullUrl: localUrl(path.join(root, s.file_rel)),
        ar: s.ar || 1.5,
        rating: s.rating,
        versionNo: Number(s.version_no || index + 1),
        versionName: s.version_name ?? '',
        versionTags: versionTags(s.version_tags),
        software: s.version_software ?? '',
        processedAt: s.version_processed_at ?? '',
        versionNote: s.version_note ?? '',
        isFinalVersion: Number(s.is_final_version) === 1,
        versionOrder: Number(s.version_order ?? 0),
        versionEdited: Number(s.version_edited) === 1,
        sourceNightIds: sourceMap.get(s.id) ?? (s.night_id ? [s.night_id] : [])
      }))
    }
  })

  const agg = exposureByTarget(db).get(targetId)
  const cover = (target.cover_shot_id ? shots.find((s) => s.id === target.cover_shot_id) : undefined) ?? shots[0]
  const abs = path.join(root, target.folder_rel)

  return {
    target: {
      id: target.id,
      title: targetTitle(target.catalog_id, target.name_cn),
      catalogId: target.catalog_id,
      nameCn: target.name_cn,
      nameEn: target.name_en ?? '',
      objectType: target.object_type ?? '',
      constellation: target.constellation ?? '',
      distanceLy: target.distance_ly,
      ra: target.ra,
      dec: target.dec,
      pinned: target.pinned,
      alias: target.alias ?? '',
      magnitude: target.magnitude,
      description: target.description ?? '',
      source: target.source ?? '',
      profileUpdatedAt: target.profile_updated_at ?? '',
      profileEdited: target.profile_edited === 1,
      coverUrl: cover ? shotThumb(cover, 1600) : null
    },
    summary: {
      nights: Number(agg?.nights ?? 0),
      finals: Number(agg?.finals ?? shots.length),
      exposureS: Number(agg?.exposure ?? 0),
      rawFrames: Number(rawCount.c ?? 0)
    },
    groups,
    folderPath: abs,
    folders: {
      root: abs,
      finals: path.join(abs, '成片'),
      raw: path.join(abs, '原始'),
      processed: path.join(abs, '处理')
    }
  }
}

export function getShotDetail(db: DB, root: string, shotId: number) {
  const shot = db.prepare(`SELECT ${SHOT_COLS} FROM shots WHERE id = ?`).get(shotId) as unknown as ShotRow | undefined
  if (!shot) return null

  const night = shot.night_id
    ? (db.prepare('SELECT * FROM nights WHERE id = ?').get(shot.night_id) as unknown as NightRow | undefined)
    : undefined
  const target = shot.target_id
    ? (db.prepare('SELECT * FROM targets WHERE id = ?').get(shot.target_id) as unknown as TargetRow | undefined)
    : undefined

  const siblings = shot.target_id
    ? (db
        .prepare(`SELECT ${SHOT_COLS} FROM shots WHERE target_id = ? AND night_id IS ? ORDER BY COALESCE(captured_at, ''), mtime`)
        .all(shot.target_id, shot.night_id) as unknown as ShotRow[])
    : (db
        .prepare(`SELECT ${SHOT_COLS} FROM shots WHERE target_id IS NULL AND night_id IS ? ORDER BY COALESCE(captured_at, ''), mtime`)
        .all(shot.night_id) as unknown as ShotRow[])

  const film = siblings.length ? siblings : [shot]
  const index = Math.max(0, film.findIndex((s) => s.id === shot.id))

  return {
    shot: {
      id: shot.id,
      fileName: shot.file_name,
      fileUrl: localUrl(path.join(root, shot.file_rel)),
      thumbUrl: shotThumb(shot, 1600),
      ar: shot.ar || 1.5,
      width: shot.width,
      height: shot.height,
      bytes: shot.bytes,
      capturedAt: shot.captured_at,
      device: shot.device,
      cameraModel: shot.camera_model,
      lens: shot.lens,
      exposureS: shot.exposure_s,
      iso: shot.iso,
      fNumber: shot.f_number,
      frameCount: shot.frame_count,
      totalExposureS: shot.total_exposure_s,
      exposureSource: shot.exposure_source,
      reviewState: shot.review_state,
      rating: shot.rating,
      notes: shot.notes,
      location: night?.location ?? null,
      subType: shot.sub_type,
      isPinned: shot.is_pinned === 1,
      isCover: !!target && target.cover_shot_id === shot.id
    },
    context: {
      title: target
        ? targetTitle(target.catalog_id, target.name_cn)
        : night
          ? `${night.sub_type || '星野'} · ${night.location ?? '未标注'}`
          : shot.file_name,
      subtitle: night ? `${night.date} · ${night.category === 'deep_sky' ? '深空' : night.sub_type}` : '',
      film: film.map((s) => ({ id: s.id, thumbUrl: shotThumb(s, 124), fileName: s.file_name, ar: s.ar || 1.5 })),
      index
    },
    folderPath: path.dirname(path.join(root, shot.file_rel)),
    nightId: shot.night_id,
    targetId: shot.target_id
  }
}

function rigRows(db: DB) {
  return db
    .prepare('SELECT id, name, type, focal_mm, aperture_f, device, notes FROM rigs ORDER BY id')
    .all() as unknown as RigRow[]
}

/** 夜次参与器材：手工关联 ∪ 成片设备自动匹配 */
function rigNamesByNight(db: DB, shots: Array<{ night_id: number | null; device: string | null }>) {
  const rigs = rigRows(db)
  const nameById = new Map(rigs.map((r) => [r.id, r.name]))
  const namesByDevice = new Map<string, string[]>()
  for (const r of rigs) {
    if (!r.device) continue
    const list = namesByDevice.get(r.device) ?? []
    list.push(r.name)
    namesByDevice.set(r.device, list)
  }

  const result = new Map<number, string[]>()
  const add = (nightId: number, name: string) => {
    const list = result.get(nightId) ?? []
    if (!list.includes(name)) list.push(name)
    result.set(nightId, list)
  }

  const manual = db.prepare('SELECT night_id, rig_id FROM night_rigs').all() as Array<{
    night_id: number
    rig_id: number
  }>
  for (const m of manual) {
    const name = nameById.get(Number(m.rig_id))
    if (name) add(Number(m.night_id), name)
  }
  for (const s of shots) {
    if (s.night_id == null || !s.device) continue
    for (const name of namesByDevice.get(s.device) ?? []) add(s.night_id, name)
  }
  return result
}

export function getNights(db: DB, root: string) {
  const nightRows = db.prepare('SELECT * FROM nights ORDER BY date DESC, id DESC').all() as unknown as NightRow[]
  const targets = db.prepare('SELECT * FROM targets').all() as unknown as TargetRow[]
  const shots = db.prepare(`SELECT ${SHOT_COLS} FROM shots`).all() as unknown as ShotRow[]
  const targetById = new Map(targets.map((t) => [t.id, t]))

  const shotsByNight = new Map<number, ShotRow[]>()
  for (const s of shots) {
    if (s.night_id == null) continue
    const list = shotsByNight.get(s.night_id) ?? []
    list.push(s)
    shotsByNight.set(s.night_id, list)
  }

  const rigsByNight = rigNamesByNight(db, shots)

  const byDate = new Map<string, NightRow[]>()
  for (const n of nightRows) {
    const list = byDate.get(n.date) ?? []
    list.push(n)
    byDate.set(n.date, list)
  }

  const shotDto = (s: ShotRow) => ({
    id: s.id,
    fileName: s.file_name,
    thumbUrl: shotThumb(s, 320),
    ar: s.ar || 1.5,
    rating: s.rating
  })

  const dates = [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, nights]) => {
      const deepTargets = new Map<number, { shots: ShotRow[]; devices: Set<string>; nights: Set<number> }>()
      const nightscape: Array<{
        nightId: number
        category: 'nightscape'
        subType: string
        location: string
        folderRel: string | null
        devices: string[]
        rigs: string[]
        shotCount: number
        exposureS: number
        shots: ReturnType<typeof shotDto>[]
        videos: ReturnType<typeof videoDto>[]
      }> = []

      for (const n of nights) {
        const list = (shotsByNight.get(n.id) ?? []).slice().sort((a, b) =>
          (a.captured_at ?? '').localeCompare(b.captured_at ?? '')
        )
        if (n.category === 'deep_sky') {
          for (const s of list) {
            if (s.target_id == null) continue
            const group = deepTargets.get(s.target_id) ?? { shots: [], devices: new Set<string>(), nights: new Set<number>() }
            group.shots.push(s)
            group.nights.add(n.id)
            if (s.device) group.devices.add(s.device)
            deepTargets.set(s.target_id, group)
          }
        } else {
          const devices = [...new Set(list.map((s) => s.device).filter(Boolean))] as string[]
          const frameExposure = list.reduce((sum, s) => sum + Number(s.total_exposure_s || 0), 0)
          nightscape.push({
            nightId: n.id,
            category: 'nightscape',
            subType: n.sub_type || '星野',
            location: n.location ?? '未标注',
            folderRel: n.folder_rel,
            devices,
            rigs: rigsByNight.get(n.id) ?? [],
            shotCount: list.length,
            exposureS: Math.max(frameExposure, Number(n.total_exposure_s || 0)),
            shots: list.map(shotDto),
            videos: videosOfNight(db, root, n.id)
          })
        }
      }

      const deepSky = [...deepTargets.entries()]
        .map(([targetId, group]) => {
          const t = targetById.get(targetId)
          return {
            targetId,
            title: t ? targetTitle(t.catalog_id, t.name_cn) : '未命名目标',
            nameEn: t?.name_en ?? '',
            shotCount: group.shots.length,
            exposureS: Math.max(...group.shots.map((s) => Number(s.total_exposure_s || 0)), 0),
            devices: [...group.devices],
            rigs: [...new Set([...group.nights].flatMap((id) => rigsByNight.get(id) ?? []))],
            shots: group.shots.map(shotDto)
          }
        })
        .sort((a, b) => a.title.localeCompare(b.title, 'zh'))

      return {
        date,
        nightCount: nights.length,
        shotCount: deepSky.reduce((sum, g) => sum + g.shotCount, 0) + nightscape.reduce((sum, g) => sum + g.shotCount, 0),
        videoCount: nightscape.reduce((sum, g) => sum + g.videos.length, 0),
        exposureS: deepSky.reduce((sum, g) => sum + g.exposureS, 0) + nightscape.reduce((sum, g) => sum + g.exposureS, 0),
        rigs: [...new Set(nights.flatMap((n) => rigsByNight.get(n.id) ?? []))],
        nightList: nights.map((n) => ({
          id: n.id,
          category: n.category,
          subType: n.sub_type || (n.category === 'deep_sky' ? '深空' : '星野'),
          location: n.location ?? '未标注',
          weather: n.weather ?? '',
          seeing: n.seeing ?? '',
          bortle: n.bortle ?? null,
          moon: moonInfo(new Date(`${n.date}T23:00:00`)),
          rigs: rigsByNight.get(n.id) ?? []
        })),
        deepSky,
        nightscape
      }
    })

  return { dates }
}

export function getRigs(db: DB) {
  const rigs = rigRows(db)
  const nights = db.prepare('SELECT id, date FROM nights').all() as Array<{ id: number; date: string }>
  const dateById = new Map(nights.map((n) => [n.id, n.date]))
  const shots = db
    .prepare('SELECT night_id, target_id, device, total_exposure_s FROM shots')
    .all() as Array<{ night_id: number | null; target_id: number | null; device: string | null; total_exposure_s: number }>
  const manual = db.prepare('SELECT night_id, rig_id FROM night_rigs').all() as Array<{
    night_id: number
    rig_id: number
  }>

  return {
    rigs: rigs.map((r) => {
      const manualNights = new Set(
        manual.filter((m) => Number(m.rig_id) === r.id).map((m) => Number(m.night_id))
      )
      const matched = shots.filter(
        (s) =>
          s.night_id != null &&
          ((r.device && s.device === r.device) || manualNights.has(Number(s.night_id)))
      )
      const nightIds = new Set(manualNights)
      const targets = new Set<number>()
      for (const s of matched) {
        nightIds.add(Number(s.night_id))
        if (s.target_id != null) targets.add(Number(s.target_id))
      }
      const lastUsed =
        [...nightIds]
          .map((id) => dateById.get(id))
          .filter((d): d is string => !!d)
          .sort()
          .pop() ?? ''
      return {
        id: r.id,
        name: r.name,
        type: r.type,
        focalMm: r.focal_mm,
        apertureF: r.aperture_f,
        device: r.device,
        notes: r.notes,
        nights: nightIds.size,
        targets: targets.size,
        exposureS: matched.reduce((sum, s) => sum + Number(s.total_exposure_s || 0), 0),
        lastUsed
      }
    })
  }
}

export function getNightDetail(db: DB, root: string, nightId: number) {
  const night = db.prepare('SELECT * FROM nights WHERE id = ?').get(nightId) as unknown as NightFullRow | undefined
  if (!night) return null

  const shots = db
    .prepare(`SELECT ${SHOT_COLS} FROM shots WHERE night_id = ? ORDER BY COALESCE(captured_at, ''), mtime`)
    .all(nightId) as unknown as ShotRow[]
  const targetRows = db.prepare('SELECT * FROM targets').all() as unknown as TargetRow[]
  const targetById = new Map(targetRows.map((t) => [t.id, t]))

  const groups = new Map<number, ShotRow[]>()
  for (const s of shots) {
    if (s.target_id == null) continue
    const list = groups.get(s.target_id) ?? []
    list.push(s)
    groups.set(s.target_id, list)
  }
  const targets = [...groups.entries()]
    .map(([targetId, list]) => {
      const t = targetById.get(targetId)
      return {
        targetId,
        title: t ? targetTitle(t.catalog_id, t.name_cn) : '未命名目标',
        nameEn: t?.name_en ?? '',
        shotCount: list.length,
        frameCount: list.reduce((sum, s) => sum + Number(s.frame_count || 0), 0),
        exposureS: Math.max(...list.map((s) => Number(s.total_exposure_s || 0)), 0),
        thumbUrl: shotThumb(list[0], 320)
      }
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'zh'))

  const manualRigIds = new Set(
    (db.prepare('SELECT rig_id FROM night_rigs WHERE night_id = ?').all(nightId) as Array<{ rig_id: number }>).map(
      (r) => Number(r.rig_id)
    )
  )
  const autoDevices = new Set(shots.map((s) => s.device).filter((d): d is string => !!d))
  const rigs = rigRows(db).map((r) => {
    const auto = !!r.device && autoDevices.has(r.device)
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      focalMm: r.focal_mm,
      apertureF: r.aperture_f,
      device: r.device,
      notes: r.notes,
      auto,
      selected: auto || manualRigIds.has(r.id)
    }
  })

  const videos = videosOfNight(db, root, nightId)
  const moon = moonInfo(new Date(`${night.date}T23:00:00`))
  const exposureS = Math.max(
    Number(night.total_exposure_s || 0),
    targets.reduce((sum, t) => sum + t.exposureS, 0)
  )

  return {
    night: {
      id: night.id,
      date: night.date,
      category: night.category,
      subType: night.sub_type || (night.category === 'deep_sky' ? '深空' : '星野'),
      location: night.location ?? '未标注',
      weather: night.weather ?? '',
      seeing: night.seeing ?? '',
      bortle: night.bortle,
      notes: night.notes ?? '',
      postProcess: night.post_process ?? '',
      folderRel: night.folder_rel
    },
    moon,
    rigs,
    targets,
    summary: {
      rigs: rigs.filter((r) => r.selected).map((r) => r.name),
      lens: [...new Set(shots.map((s) => s.lens).filter((x): x is string => !!x))],
      singleExposureS: Math.max(...shots.map((s) => Number(s.exposure_s || 0)), 0),
      isos: [...new Set(shots.map((s) => Number(s.iso || 0)).filter((n) => n > 0))].sort((a, b) => a - b),
      frameCount: shots.reduce((sum, s) => sum + Number(s.frame_count || 0), 0),
      exposureS,
      timelapseFrames: videos.reduce((sum, v) => sum + Number(v.frameCount || 0), 0),
      timelapseDurationS: videos.reduce((sum, v) => sum + Number(v.durationS || 0), 0),
      timelapseFps: videos.length ? Number(videos[0].fps || 0) : 0
    },
    devices: [...autoDevices],
    shots: shots.map((s) => ({
      id: s.id,
      fileName: s.file_name,
      thumbUrl: shotThumb(s, 320),
      ar: s.ar || 1.5,
      rating: s.rating
    })),
    videos,
    folderPath: night.folder_rel ? path.join(root, night.folder_rel) : null,
    stats: {
      shotCount: shots.length,
      targetCount: targets.length,
      videoCount: videos.length,
      exposureS
    }
  }
}

export function getStats(db: DB, root: string) {
  const targets = getTargets(db, root)
  const nights = db.prepare('SELECT * FROM nights').all() as unknown as NightRow[]
  const shots = db.prepare(`SELECT ${SHOT_COLS} FROM shots`).all() as unknown as ShotRow[]
  const assets = db
    .prepare('SELECT kind, COUNT(*) AS count, SUM(bytes) AS bytes FROM assets GROUP BY kind')
    .all() as Array<{ kind: string; count: number; bytes: number }>

  const nightById = new Map(nights.map((n) => [n.id, n]))
  const deepShots = shots.filter((s) => s.target_id !== null)
  const nsShots = shots.filter((s) => s.target_id === null)

  const now = new Date()
  const months: Array<{ month: string; label: string; finals: number; nights: number; exposureS: number }> = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: `${d.getMonth() + 1}月`,
      finals: 0,
      nights: 0,
      exposureS: 0
    })
  }
  const monthMap = new Map(months.map((m) => [m.month, m]))

  for (const n of nights) {
    const bucket = monthMap.get(n.date.slice(0, 7))
    if (bucket) bucket.nights++
  }
  for (const s of shots) {
    const date = s.night_id ? nightById.get(s.night_id)?.date : (s.captured_at ?? '').slice(0, 10)
    const bucket = monthMap.get((date ?? '').slice(0, 7))
    if (!bucket) continue
    bucket.finals++
    bucket.exposureS += Number(s.total_exposure_s || 0)
  }

  const byType: Record<string, number> = { 银河: 0, 星轨: 0, 延时: 0, 其他: 0 }
  for (const s of nsShots) {
    const key = s.sub_type ?? '其他'
    byType[key] = (byType[key] ?? 0) + 1
  }
  for (const [key, count] of videoCountByType(db)) byType[key] = (byType[key] ?? 0) + count

  const deviceMap = new Map<string, number>()
  for (const s of shots) {
    const key = s.device ?? '未记录'
    deviceMap.set(key, (deviceMap.get(key) ?? 0) + 1)
  }

  const assetMap = new Map(assets.map((a) => [a.kind, a]))
  const rawCount = Number(assetMap.get('raw')?.count ?? 0)
  const assetBytes = assets.reduce((sum, a) => sum + Number(a.bytes ?? 0), 0)
  const shotBytes = shots.reduce((sum, s) => sum + Number(s.bytes ?? 0), 0)

  const historyRows = db.prepare('SELECT * FROM change_log ORDER BY id DESC LIMIT 200').all() as Array<{
    id: number
    at: string
    action: string
    entity: string
    entity_id: number | null
    detail_json: string | null
    undoable: number
    undone: number
  }>
  const historyTotal = Number(
    (db.prepare('SELECT COUNT(*) AS c FROM change_log').get() as { c: number } | undefined)?.c ?? 0
  )

  const history = historyRows.map((row) => {
    let detail: Record<string, unknown> = {}
    try {
      detail = row.detail_json ? (JSON.parse(row.detail_json) as Record<string, unknown>) : {}
    } catch {
      detail = {}
    }
    const kind: 'rename' | 'import' | 'undo' | 'other' =
      row.action === 'rename_folder'
        ? 'rename'
        : row.action === 'import_files'
          ? 'import'
          : row.action.startsWith('undo_')
            ? 'undo'
            : 'other'
    let title = row.action
    let pathText = ''
    let note = ''
    if (row.action === 'rename_folder') {
      title = row.entity === 'target' ? '目标文件夹改名' : '夜次文件夹改名'
      pathText = `${String(detail.oldRel ?? '')} → ${String(detail.newRel ?? '')}`
      note = `${String(detail.oldName ?? '')} → ${String(detail.newName ?? '')}`
    } else if (row.action === 'import_files') {
      const items = Array.isArray(detail.items) ? (detail.items as Array<{ fromRel: string; toRel: string }>) : []
      title = `导入 ${items.length} 个文件`
      pathText = items[0]?.toRel ?? ''
      if (items.length > 1) pathText += ` 等 ${items.length} 个`
      note = items[0]?.fromRel ? `来自 ${path.dirname(items[0].fromRel)}` : '来自收件箱'
    } else if (row.action === 'undo_import') {
      const restored = Array.isArray(detail.restored) ? detail.restored : []
      const items = Array.isArray(detail.items) ? (detail.items as Array<{ fromRel: string }>) : []
      title = `撤销导入 ${restored.length} 个文件`
      pathText = items[0]?.fromRel ?? ''
      note = '已移回收件箱'
    } else if (row.action === 'undo_rename') {
      title = '撤销文件夹改名'
      pathText = `${String(detail.newRel ?? '')} → ${String(detail.oldRel ?? '')}`
      note = `恢复到 ${String(detail.oldName ?? '')}`
    }
    return {
      id: row.id,
      at: row.at,
      action: row.action,
      entity: row.entity,
      kind,
      title,
      path: pathText,
      note,
      undoable: row.undoable === 1,
      undone: row.undone === 1
    }
  })

  return {
    summary: {
      targets: targets.length,
      nights: nights.length,
      deepNights: nights.filter((n) => n.category === 'deep_sky').length,
      nsNights: nights.filter((n) => n.category === 'nightscape').length,
      finals: shots.length,
      deepFinals: deepShots.length,
      nsFinals: nsShots.length,
      exposureS: targets.reduce((sum, t) => sum + t.exposureS, 0),
      nsExposureS: nights
        .filter((n) => n.category === 'nightscape')
        .reduce((sum, n) => sum + Number(n.total_exposure_s || 0), 0),
      watermarkFinals: shots.filter((s) => s.exposure_source === 'watermark').length,
      watermarkExposureS: shots
        .filter((s) => s.exposure_source === 'watermark')
        .reduce((sum, s) => sum + Number(s.total_exposure_s || 0), 0),
      pendingReview: shots.filter((s) => s.review_state === 'pending').length,
      rawCount,
      assetCount: assets.reduce((sum, a) => sum + Number(a.count ?? 0), 0),
      totalBytes: shotBytes + assetBytes,
      byType
    },
    months,
    topTargets: targets
      .slice()
      .sort((a, b) => b.finals - a.finals || b.exposureS - a.exposureS)
      .slice(0, 5)
      .map((t) => ({ id: t.id, title: t.title, finals: t.finals, nights: t.nights, exposureS: t.exposureS, thumbUrl: t.thumbUrl })),
    devices: [...deviceMap.entries()]
      .map(([device, count]) => ({ device, count }))
      .sort((a, b) => b.count - a.count),
    history: { total: historyTotal, items: history }
  }
}

export interface PendingReview {
  id: number
  fileName: string
  fileUrl: string
  thumbUrl: string | null
  ar: number
  targetId: number | null
  title: string
  nightId: number | null
  nightDate: string | null
  location: string | null
  totalExposureS: number
  exposureSource: string | null
  watermarkText: string | null
}

/** 待确认 / 已核对成片列表：水印缺字段或低置信度时集中供人工核对 */
export function getPendingReviews(db: DB, root: string, state: 'pending' | 'manual' = 'pending'): PendingReview[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.file_name, s.file_rel, s.mtime, s.bytes, s.ar,
              s.target_id, s.night_id, s.total_exposure_s, s.exposure_source, s.watermark_text,
              t.catalog_id, t.name_cn, n.date AS night_date, n.location
       FROM shots s
       LEFT JOIN targets t ON t.id = s.target_id
       LEFT JOIN nights n ON n.id = s.night_id
       WHERE s.review_state = ?
       ORDER BY COALESCE(n.date, '') DESC, s.file_name`
    )
    .all(state) as unknown as Array<{
    id: number
    file_name: string
    file_rel: string
    mtime: number
    bytes: number
    ar: number
    target_id: number | null
    night_id: number | null
    total_exposure_s: number | null
    exposure_source: string | null
    watermark_text: string | null
    catalog_id: string | null
    name_cn: string | null
    night_date: string | null
    location: string | null
  }>

  return rows.map((row) => ({
    id: row.id,
    fileName: row.file_name,
    fileUrl: localUrl(path.join(root, row.file_rel)),
    thumbUrl: shotThumb(row, 320),
    ar: row.ar || 1.5,
    targetId: row.target_id,
    title: row.catalog_id ? targetTitle(row.catalog_id, row.name_cn ?? '') : row.night_date ? `夜次 ${row.night_date}` : row.file_name,
    nightId: row.night_id,
    nightDate: row.night_date,
    location: row.location,
    totalExposureS: row.total_exposure_s ?? 0,
    exposureSource: row.exposure_source,
    watermarkText: row.watermark_text
  }))
}

export function getNightscape(db: DB, root: string, type: string) {
  const nights = db
    .prepare(`SELECT * FROM nights WHERE category = 'nightscape' AND sub_type = ? ORDER BY date DESC`)
    .all(type) as unknown as NightRow[]
  const sourceMap = new Map<number, number[]>()
  const sourceRows = db
    .prepare(
      `SELECT vs.version_shot_id, vs.night_id FROM version_sources vs
       JOIN shots s ON s.id = vs.version_shot_id
       JOIN nights n ON n.id = s.night_id
       WHERE n.category = 'nightscape' AND n.sub_type = ?`
    )
    .all(type) as Array<{ version_shot_id: number; night_id: number }>
  for (const row of sourceRows) {
    const list = sourceMap.get(Number(row.version_shot_id)) ?? []
    list.push(Number(row.night_id))
    sourceMap.set(Number(row.version_shot_id), list)
  }

  const rows = nights.map((n) => {
    const shots = db
      .prepare(`SELECT ${SHOT_COLS} FROM shots WHERE night_id = ? ORDER BY COALESCE(captured_at, ''), mtime`)
      .all(n.id) as unknown as ShotRow[]
    const ordered = [...shots].sort(
      (a, b) =>
        Number(b.is_final_version) - Number(a.is_final_version) ||
        Number(a.version_order) - Number(b.version_order) ||
        Number(a.version_no) - Number(b.version_no)
    )
    const videos = videosOfNight(db, root, n.id)
    return {
      id: n.id,
      date: n.date,
      location: n.location ?? '未标注',
      folderRel: n.folder_rel,
      exposureS: Number(n.total_exposure_s ?? 0),
      videoCount: videos.length,
      videos,
      shots: ordered.map((s, index) => ({
        id: s.id,
        fileName: s.file_name,
        thumbUrl: shotThumb(s, 124),
        fullUrl: localUrl(path.join(root, s.file_rel)),
        ar: s.ar || 1.5,
        rating: s.rating,
        versionNo: Number(s.version_no || index + 1),
        versionName: s.version_name ?? '',
        versionTags: versionTags(s.version_tags),
        software: s.version_software ?? '',
        processedAt: s.version_processed_at ?? '',
        versionNote: s.version_note ?? '',
        isFinalVersion: Number(s.is_final_version) === 1,
        versionOrder: Number(s.version_order ?? 0),
        versionEdited: Number(s.version_edited) === 1,
        sourceNightIds: sourceMap.get(s.id) ?? (s.night_id ? [s.night_id] : [])
      }))
    }
  })
  return { type, nights: rows, folderPath: path.join(root, '02_星野', type) }
}

export function getVideoDetail(db: DB, root: string, id: number) {
  const row = db.prepare(`SELECT * FROM assets WHERE id = ? AND kind = 'video'`).get(id) as unknown as AssetRow | undefined
  if (!row) return null
  const night = row.night_id
    ? (db.prepare('SELECT * FROM nights WHERE id = ?').get(row.night_id) as unknown as NightRow | undefined)
    : undefined
  const absPath = path.join(root, row.file_rel)
  return {
    video: {
      id: row.id,
      fileName: path.basename(row.file_rel),
      fileUrl: localUrl(absPath),
      bytes: Number(row.bytes ?? 0),
      durationS: Number(row.duration_s ?? 0),
      width: row.width,
      height: row.height,
      fps: row.fps,
      codec: row.codec
    },
    context: {
      title: night ? `${night.sub_type || '星野'} · ${night.location ?? '未标注'}` : '星野视频',
      subtitle: night ? `${night.date} · ${night.category === 'deep_sky' ? '深空' : night.sub_type || '星野'}` : ''
    },
    folderPath: path.dirname(absPath),
    nightId: row.night_id
  }
}

export type SearchSort = 'date' | 'rating' | 'exposure' | 'bytes'

export interface SearchParams {
  q?: string
  category?: 'all' | 'deep_sky' | 'nightscape'
  subType?: string
  kind?: 'all' | 'photo' | 'video'
  rating?: number
  from?: string
  to?: string
  targetId?: number
  rigId?: number
  versionState?: 'all' | 'final' | 'other'
  sort?: SearchSort
  order?: 'desc' | 'asc'
}

export interface SearchItem {
  kind: 'photo' | 'video'
  id: number
  fileName: string
  date: string
  title: string
  subType: string | null
  ar: number
  rating?: number
  thumbUrl?: string
  fileUrl?: string
  bytes?: number
  durationS?: number
  exposureS?: number
  isFinalVersion?: boolean
}

interface SearchPhotoRow {
  id: number
  file_rel: string
  file_name: string
  bytes: number
  mtime: number
  ar: number
  rating: number
  total_exposure_s: number
  is_final_version: number
  captured_at: string | null
  target_id: number | null
  catalog_id: string | null
  name_cn: string | null
  night_date: string | null
  location: string | null
  sub_type: string | null
}

interface SearchVideoRow extends AssetRow {
  night_date: string | null
  location: string | null
  sub_type: string | null
}

export function searchLibrary(db: DB, root: string, params: SearchParams) {
  const q = String(params.q ?? '').trim()
  const category = params.category ?? 'all'
  const kind = params.kind ?? 'all'
  const subType = params.subType && params.subType !== 'all' ? params.subType : ''
  const rating = Math.max(0, Math.min(5, Number(params.rating ?? 0) || 0))
  const from = String(params.from ?? '').slice(0, 10)
  const to = String(params.to ?? '').slice(0, 10)
  const targetId = Math.max(0, Math.round(Number(params.targetId ?? 0) || 0))
  const rigId = Math.max(0, Math.round(Number(params.rigId ?? 0) || 0))
  const versionState =
    params.versionState === 'final' || params.versionState === 'other' ? params.versionState : 'all'
  const sort: SearchSort =
    params.sort === 'rating' || params.sort === 'exposure' || params.sort === 'bytes' ? params.sort : 'date'
  const order: 'desc' | 'asc' = params.order === 'asc' ? 'asc' : 'desc'
  const dir = order === 'asc' ? 'ASC' : 'DESC'
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

  let photos: SearchPhotoRow[] = []
  if (kind !== 'video') {
    const where: string[] = ['1 = 1']
    const args: Array<string | number> = []
    if (q) {
      where.push(
        `(s.file_name LIKE ? ESCAPE '\\' OR t.name_cn LIKE ? ESCAPE '\\' OR t.catalog_id LIKE ? ESCAPE '\\' OR n.location LIKE ? ESCAPE '\\')`
      )
      args.push(like, like, like, like)
    }
    if (category === 'deep_sky') where.push('s.target_id IS NOT NULL')
    if (category === 'nightscape') where.push('s.target_id IS NULL')
    if (subType) {
      where.push('n.sub_type = ?')
      args.push(subType)
    }
    if (rating > 0) {
      where.push('s.rating >= ?')
      args.push(rating)
    }
    if (targetId > 0) {
      where.push('s.target_id = ?')
      args.push(targetId)
    }
    if (versionState === 'final') where.push('s.is_final_version = 1')
    if (versionState === 'other') where.push('COALESCE(s.is_final_version, 0) = 0')
    if (rigId > 0) {
      // 器材口径与统计页一致：夜次手工关联 ∪ 成片设备自动匹配
      where.push(
        `(s.night_id IN (SELECT night_id FROM night_rigs WHERE rig_id = ?)
          OR (s.device IS NOT NULL AND s.device = (SELECT device FROM rigs WHERE id = ?)))`
      )
      args.push(rigId, rigId)
    }
    const dateExpr = `COALESCE(NULLIF(substr(s.captured_at, 1, 10), ''), n.date)`
    if (from) {
      where.push(`${dateExpr} >= ?`)
      args.push(from)
    }
    if (to) {
      where.push(`${dateExpr} <= ?`)
      args.push(to)
    }
    const sortExpr =
      sort === 'rating'
        ? 's.rating'
        : sort === 'exposure'
          ? 's.total_exposure_s'
          : sort === 'bytes'
            ? 's.bytes'
            : dateExpr
    photos = db
      .prepare(
        `SELECT s.id, s.file_rel, s.file_name, s.bytes, s.mtime, s.ar, s.rating,
                s.total_exposure_s, s.is_final_version, s.captured_at,
                s.target_id, t.catalog_id, t.name_cn,
                n.date AS night_date, n.location, n.sub_type
         FROM shots s
         LEFT JOIN targets t ON t.id = s.target_id
         LEFT JOIN nights n ON n.id = s.night_id
         WHERE ${where.join(' AND ')}
         ORDER BY ${sortExpr} ${dir}, ${dateExpr} DESC, s.mtime DESC
         LIMIT 400`
      )
      .all(...args) as unknown as SearchPhotoRow[]
  }

  let videos: SearchVideoRow[] = []
  // 目标 / 版本只作用于照片：视频没有对应维度，筛选时不再混入
  const videoAllowed =
    kind !== 'photo' && category !== 'deep_sky' && rating === 0 && targetId === 0 && versionState === 'all'
  if (videoAllowed) {
    const where: string[] = [`a.kind = 'video'`]
    const args: Array<string | number> = []
    if (q) {
      where.push(`(a.file_rel LIKE ? ESCAPE '\\' OR n.location LIKE ? ESCAPE '\\' OR n.sub_type LIKE ? ESCAPE '\\')`)
      args.push(like, like, like)
    }
    if (subType) {
      where.push('n.sub_type = ?')
      args.push(subType)
    }
    if (from) {
      where.push('n.date >= ?')
      args.push(from)
    }
    if (to) {
      where.push('n.date <= ?')
      args.push(to)
    }
    if (rigId > 0) {
      where.push('a.night_id IN (SELECT night_id FROM night_rigs WHERE rig_id = ?)')
      args.push(rigId)
    }
    const videoSort = sort === 'bytes' ? `a.bytes ${dir}` : `n.date ${sort === 'date' ? dir : 'DESC'}`
    videos = db
      .prepare(
        `SELECT a.*, n.date AS night_date, n.location, n.sub_type
         FROM assets a JOIN nights n ON n.id = a.night_id
         WHERE ${where.join(' AND ')}
         ORDER BY ${videoSort}, a.file_rel
         LIMIT 400`
      )
      .all(...args) as unknown as SearchVideoRow[]
  }

  const items: SearchItem[] = []
  for (const p of photos) {
    items.push({
      kind: 'photo',
      id: p.id,
      fileName: p.file_name,
      date: (p.captured_at ?? p.night_date ?? '').slice(0, 10),
      title: p.target_id
        ? p.name_cn && p.name_cn !== p.catalog_id
          ? `${p.catalog_id ?? ''} · ${p.name_cn}`
          : p.catalog_id ?? p.name_cn ?? ''
        : `${p.sub_type || '星野'}${p.location ? ` · ${p.location}` : ''}`,
      subType: p.sub_type,
      ar: p.ar || 1.5,
      rating: p.rating,
      bytes: Number(p.bytes ?? 0),
      exposureS: Number(p.total_exposure_s ?? 0),
      isFinalVersion: Number(p.is_final_version) === 1,
      thumbUrl: shotThumb(p, 320)
    })
  }
  for (const v of videos) {
    items.push({
      kind: 'video',
      id: v.id,
      fileName: path.basename(v.file_rel),
      date: (v.night_date ?? '').slice(0, 10),
      title: `${v.sub_type || '星野'}${v.location ? ` · ${v.location}` : ''}`,
      subType: v.sub_type,
      ar: v.width && v.height ? v.width / v.height : 16 / 9,
      fileUrl: localUrl(path.join(root, v.file_rel)),
      bytes: Number(v.bytes ?? 0),
      durationS: Number(v.duration_s ?? 0)
    })
  }

  const sign = order === 'asc' ? 1 : -1
  items.sort((a, b) => {
    let cmp = 0
    if (sort === 'date') cmp = (a.date || '').localeCompare(b.date || '')
    else if (sort === 'rating') cmp = Number(a.rating ?? 0) - Number(b.rating ?? 0)
    else if (sort === 'exposure') cmp = Number(a.exposureS ?? 0) - Number(b.exposureS ?? 0)
    else cmp = Number(a.bytes ?? 0) - Number(b.bytes ?? 0)
    if (cmp) return cmp * sign
    return (b.date || '').localeCompare(a.date || '') || a.fileName.localeCompare(b.fileName)
  })

  return {
    items: items.slice(0, 400),
    total: items.length,
    photoCount: photos.length,
    videoCount: videos.length
  }
}
