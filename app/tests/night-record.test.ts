import fs from 'node:fs'
import path from 'node:path'
import { openDatabase } from '../src/main/db'
import { getNightDetail, getNights } from '../src/main/queries'
import { undoLastChange, updateNight } from '../src/main/files'

const base = process.env.TESTBASE!
const root = path.join(base, 'library')
const thumbs = path.join(base, 'thumbs')
const at = '2026-10-05T10:00:00'

function ok(cond: unknown, message: string, extra = '') {
  if (!cond) {
    console.error('FAIL: ' + message + (extra ? ' ' + extra : ''))
    process.exit(1)
  }
  console.log('ok - ' + message)
}

const db = openDatabase(path.join(base, 'data'))

// ---------- v8 迁移 ----------
const version = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
ok(version === 8, 'schema 升级到 v8')
const columns = (db.prepare('PRAGMA table_info(nights)').all() as Array<{ name: string }>).map((c) => c.name)
ok(columns.includes('post_process'), 'nights 表包含 post_process 字段')
const assetColumns = (db.prepare('PRAGMA table_info(assets)').all() as Array<{ name: string }>).map((c) => c.name)
ok(assetColumns.includes('mtime'), 'assets 表包含 mtime 指纹字段')

// ---------- 造数 ----------
const targetId = Number(
  db
    .prepare('INSERT INTO targets(catalog_id, name_cn, folder_rel, created_at, updated_at) VALUES(?,?,?,?,?)')
    .run('M31', '仙女座星系', '01_深空/M31_仙女座星系', at, at).lastInsertRowid
)
const nightId = Number(
  db
    .prepare(
      `INSERT INTO nights(date, category, sub_type, location, weather, seeing, bortle, notes, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`
    )
    .run('2026-10-04', 'deep_sky', '', '测试点A', '晴，微风', '良好', 4, '测试备注', at, at).lastInsertRowid
)
const rig = db.prepare("SELECT id, name FROM rigs WHERE device = 'DWARFMINI'").get() as {
  id: number
  name: string
}
db.prepare('INSERT INTO night_rigs(night_id, rig_id) VALUES(?,?)').run(nightId, rig.id)
db.prepare(
  `INSERT INTO shots(night_id, target_id, file_rel, file_name, ext, bytes, captured_at, device, lens, iso,
     exposure_s, frame_count, total_exposure_s, rating, ar, mtime, created_at, updated_at, version_no, is_final_version, version_order)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,1)`
).run(
  nightId,
  targetId,
  'test/M31_final.jpg',
  'M31_final.jpg',
  '.jpg',
  1024,
  '2026-10-04T22:00:00',
  'DWARFMINI',
  '200mm',
  1600,
  30,
  80,
  2400,
  5,
  1.5,
  0,
  at,
  at
)
db.prepare(
  `INSERT INTO assets(shot_id, night_id, kind, file_rel, bytes, width, height, duration_s, fps, codec, created_at)
   VALUES(NULL, ?, 'video', 'test/timelapse.mp4', 2048, 1920, 1080, 12, 30, 'h264', ?)`
).run(nightId, at)

// ---------- 夜次列表：月相与观测条件 ----------
const data = getNights(db)
const date = data.dates.find((d) => d.date === '2026-10-04')
ok(!!date, '夜次列表包含新增日期')
const brief = date!.nightList[0]
ok(!!brief.moon?.phase && brief.moon.illum >= 0 && brief.moon.illum <= 100, '记录卡带月相与照明度', JSON.stringify(brief.moon))
ok(brief.bortle === 4 && brief.seeing === '良好' && brief.weather.includes('晴'), '记录卡带 Bortle / 视宁度 / 天气')

// ---------- 夜次详情：拍摄汇总 ----------
let detail = getNightDetail(db, root, nightId)
ok(detail.night.postProcess === '', '初期后期处理为空')
ok(detail.summary.rigs.includes(rig.name), '汇总包含参与器材', JSON.stringify(detail.summary.rigs))
ok(detail.summary.lens.join() === '200mm', '汇总包含镜头')
ok(detail.summary.singleExposureS === 30, '汇总包含单张曝光')
ok(detail.summary.isos.join() === '1600', '汇总包含 ISO/Gain')
ok(detail.summary.frameCount === 80, '汇总包含张数')
ok(detail.summary.exposureS === 2400, '汇总包含累计曝光')
ok(
  detail.summary.timelapseFrames === 360 && detail.summary.timelapseDurationS === 12 && detail.summary.timelapseFps === 30,
  '延时补齐帧数 / 时长 / 帧率',
  JSON.stringify({
    frames: detail.summary.timelapseFrames,
    duration: detail.summary.timelapseDurationS,
    fps: detail.summary.timelapseFps
  })
)

// ---------- 后期处理可写可撤销 ----------
const saved = updateNight(db, nightId, { postProcess: 'DSS 堆栈 80 张 + PI 拉伸' })
ok(saved.ok, '保存后期处理成功')
detail = getNightDetail(db, root, nightId)
ok(detail.night.postProcess.includes('DSS'), '后期处理写入成功')

const undone = undoLastChange(db, root, thumbs)
ok(undone.ok, '后期处理可撤销')
detail = getNightDetail(db, root, nightId)
ok(detail.night.postProcess === '', '撤销后后期处理恢复为空')

db.close()
fs.rmSync(base, { recursive: true, force: true })
console.log('night-record 测试完成')
