import fs from 'node:fs'
import path from 'node:path'
import { openDatabase } from '../src/main/db'
import { getStats, searchLibrary } from '../src/main/queries'
import { undoLastChange, updateShots } from '../src/main/files'

const base = process.env.TESTBASE!
const lib = path.join(base, 'library')
const thumbs = path.join(base, 'thumbs')

function ok(cond: unknown, message: string) {
  if (!cond) {
    console.error('FAIL: ' + message)
    process.exit(1)
  }
  console.log('ok - ' + message)
}

const db = openDatabase(path.join(base, 'data'))
const at = '2026-10-01T22:00:00'

function addNight(date: string, category: 'deep_sky' | 'nightscape', subType = '') {
  const info = db
    .prepare(
      'INSERT INTO nights(date, category, sub_type, location, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)'
    )
    .run(date, category, subType, '测试地点', at, at)
  return Number(info.lastInsertRowid)
}

function addTarget(catalogId: string, nameCn: string) {
  const info = db
    .prepare(
      'INSERT INTO targets(catalog_id, name_cn, folder_rel, created_at, updated_at) VALUES(?, ?, ?, ?, ?)'
    )
    .run(catalogId, nameCn, `01_深空/${catalogId}_${nameCn}`, at, at)
  return Number(info.lastInsertRowid)
}

interface ShotInput {
  targetId: number | null
  nightId: number
  subType?: string
  device: string
  rating: number
  exposure: number
  bytes: number
  final: boolean
  date: string
}

function addShot(input: ShotInput) {
  const info = db
    .prepare(
      `INSERT INTO shots(night_id, target_id, sub_type, file_rel, file_name, ext, bytes, captured_at,
         device, total_exposure_s, rating, ar, mtime, created_at, updated_at, version_no, is_final_version, version_order)
       VALUES(?, ?, ?, ?, ?, '.jpg', ?, ?, ?, ?, ?, 1.5, 0, ?, ?, 1, ?, 1)`
    )
    .run(
      input.nightId,
      input.targetId,
      input.subType ?? null,
      `test/${input.device}_${input.rating}_${input.exposure}.jpg`,
      `${input.device}_${input.rating}_${input.exposure}.jpg`,
      input.bytes,
      `${input.date}T22:00:00`,
      input.device,
      input.exposure,
      input.rating,
      at,
      at,
      input.final ? 1 : 0
    )
  return Number(info.lastInsertRowid)
}

// ---------- 造数：两个深空目标 + 一个星野夜次 ----------
const m31 = addTarget('M31', '仙女座星系')
const m42 = addTarget('M42', '猎户座大星云')
const n1 = addNight('2026-10-01', 'deep_sky')
const n2 = addNight('2026-10-02', 'deep_sky')
const n3 = addNight('2026-10-03', 'nightscape', '银河')

const rig = db.prepare("SELECT id FROM rigs WHERE device = 'DWARFMINI'").get() as { id: number } | undefined
ok(!!rig, '预置器材已生成')
db.prepare('INSERT INTO night_rigs(night_id, rig_id) VALUES(?, ?)').run(n1, rig!.id)
db.prepare(
  `INSERT INTO assets(shot_id, night_id, kind, file_rel, bytes, width, height, duration_s, fps, codec, created_at)
   VALUES(NULL, ?, 'video', 'test/timelapse.mp4', 4096, 1920, 1080, 12, 30, 'h264', ?)`
).run(n3, at)

const s1 = addShot({ targetId: m31, nightId: n1, device: 'DWARFMINI', rating: 5, exposure: 3600, bytes: 1000, final: true, date: '2026-10-01' })
const s2 = addShot({ targetId: m31, nightId: n2, device: 'CANON', rating: 3, exposure: 1800, bytes: 3000, final: false, date: '2026-10-02' })
const s3 = addShot({ targetId: m42, nightId: n2, device: 'DWARFMINI', rating: 1, exposure: 900, bytes: 2000, final: false, date: '2026-10-02' })
const s4 = addShot({ targetId: null, nightId: n3, subType: '银河', device: 'PHONE', rating: 0, exposure: 600, bytes: 500, final: true, date: '2026-10-03' })

// ---------- 基础检索 ----------
const all = searchLibrary(db, lib, {})
ok(all.photoCount === 4 && all.videoCount === 1, '默认检索返回 4 张照片 + 1 段视频')
ok(all.items[0]?.date === '2026-10-03', '默认按日期降序')
ok(all.items.every((item) => item.kind === 'photo' || item.durationS === 12), '视频条目带上时长')

// ---------- 分类口径与统计一致 ----------
const stats = getStats(db, lib)
const deep = searchLibrary(db, lib, { category: 'deep_sky' })
const ns = searchLibrary(db, lib, { category: 'nightscape' })
ok(deep.photoCount === stats.summary.deepFinals, '深空筛选数量与统计一致')
ok(ns.photoCount === stats.summary.nsFinals, '星野筛选数量与统计一致')

// ---------- 目标筛选 ----------
const byTarget = searchLibrary(db, lib, { targetId: m31 })
ok(byTarget.photoCount === 2, '按目标筛选只返回该目标成片')
ok(byTarget.videoCount === 0, '目标筛选时不混入视频')
ok(
  byTarget.items.every((item) => item.id === s1 || item.id === s2),
  '目标筛选结果正确'
)

// ---------- 器材筛选（手工关联 ∪ 设备自动匹配） ----------
const byRig = searchLibrary(db, lib, { rigId: rig!.id })
const rigIds = byRig.items.map((item) => item.id).sort((a, b) => a - b)
ok(
  rigIds.length === 2 && rigIds[0] === s1 && rigIds[1] === s3,
  '器材筛选包含手工关联夜次与同设备成片'
)

// ---------- 版本筛选 ----------
const finals = searchLibrary(db, lib, { versionState: 'final' })
const others = searchLibrary(db, lib, { versionState: 'other' })
ok(finals.photoCount === 2 && others.photoCount === 2, '最终版 / 普通版筛选数量正确')
ok(finals.items.every((item) => item.isFinalVersion === true), '最终版筛选结果标记正确')

// ---------- 组合筛选 ----------
const combo = searchLibrary(db, lib, { targetId: m31, versionState: 'other' })
ok(combo.photoCount === 1 && combo.items[0].id === s2, '目标 + 版本组合筛选结果正确')

// ---------- 排序 ----------
const photosOf = (result: ReturnType<typeof searchLibrary>) =>
  result.items.filter((item) => item.kind === 'photo')
const byExposure = searchLibrary(db, lib, { sort: 'exposure' })
ok(
  photosOf(byExposure)
    .map((item) => item.id)
    .join(',') === [s1, s2, s3, s4].join(','),
  '按曝光降序排序正确'
)
const byExposureAsc = searchLibrary(db, lib, { sort: 'exposure', order: 'asc' })
ok(photosOf(byExposureAsc)[0].id === s4, '按曝光升序排序正确')
const byBytes = searchLibrary(db, lib, { sort: 'bytes' })
ok(photosOf(byBytes)[0].id === s2, '按文件大小降序排序正确')
const byRating = searchLibrary(db, lib, { sort: 'rating' })
ok(photosOf(byRating)[0].id === s1, '按评级降序排序正确')

// ---------- 批量编辑一次撤销 ----------
const batch = updateShots(db, [s1, s2], { rating: 4, notes: '批量备注' })
ok(batch.ok, '批量编辑成功')
const edited = db
  .prepare('SELECT id, rating, notes FROM shots WHERE id IN (?, ?) ORDER BY id')
  .all(s1, s2) as Array<{ id: number; rating: number; notes: string | null }>
ok(
  edited.every((row) => row.rating === 4 && row.notes === '批量备注'),
  '批量评分与备注已写入'
)
const editLogs = Number(
  (db.prepare("SELECT COUNT(*) AS c FROM change_log WHERE action = 'edit_shot'").get() as { c: number }).c
)
ok(editLogs === 1, '整批修改只记录一条变更日志')

const undoneRes = undoLastChange(db, lib, thumbs)
ok(undoneRes.ok && undoneRes.kind === 'edit', '批量编辑可撤销')
const restored = db
  .prepare('SELECT id, rating, notes FROM shots WHERE id IN (?, ?) ORDER BY id')
  .all(s1, s2) as Array<{ id: number; rating: number; notes: string | null }>
ok(
  restored[0].rating === 5 && restored[0].notes === null && restored[1].rating === 3 && restored[1].notes === null,
  '一次撤销还原全部选中照片'
)

// ---------- 收尾 ----------
db.close()
fs.rmSync(base, { recursive: true, force: true })
console.log('search 测试完成')
