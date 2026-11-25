import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

export type DB = DatabaseSync

/** 当前 schema 版本，未来迁移只做增量 */
const SCHEMA_VERSION = 8

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  catalog_id TEXT NOT NULL UNIQUE,
  name_cn TEXT NOT NULL,
  name_en TEXT,
  object_type TEXT,
  constellation TEXT,
  distance_ly REAL,
  ra TEXT,
  dec TEXT,
  folder_rel TEXT NOT NULL,
  cover_shot_id INTEGER,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('deep_sky','nightscape')),
  sub_type TEXT NOT NULL DEFAULT '',
  location TEXT,
  moon_illum REAL,
  moon_phase TEXT,
  seeing TEXT,
  bortle INTEGER,
  notes TEXT,
  folder_rel TEXT,
  total_exposure_s REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (date, category, sub_type)
);

CREATE TABLE IF NOT EXISTS shots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  night_id INTEGER,
  target_id INTEGER,
  sub_type TEXT,
  file_rel TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  ext TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  captured_at TEXT,
  device TEXT,
  camera_model TEXT,
  lens TEXT,
  exposure_s REAL,
  iso INTEGER,
  f_number REAL,
  frame_count INTEGER NOT NULL DEFAULT 0,
  total_exposure_s REAL NOT NULL DEFAULT 0,
  rating INTEGER NOT NULL DEFAULT 0,
  is_final INTEGER NOT NULL DEFAULT 1,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  location_override TEXT,
  notes TEXT,
  ar REAL NOT NULL DEFAULT 1,
  strip_ratio REAL NOT NULL DEFAULT 0,
  content_hash TEXT,
  mtime INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shot_id INTEGER,
  night_id INTEGER,
  kind TEXT NOT NULL,
  file_rel TEXT NOT NULL UNIQUE,
  bytes INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  duration_s REAL,
  fps REAL,
  codec TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calibrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device TEXT,
  kind TEXT NOT NULL,
  camera TEXT,
  gain INTEGER,
  ir INTEGER,
  bin INTEGER,
  frames INTEGER NOT NULL DEFAULT 0,
  folder_rel TEXT NOT NULL UNIQUE,
  captured_at TEXT,
  copied_at TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT
);

CREATE TABLE IF NOT EXISTS shot_tags (
  shot_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (shot_id, tag_id)
);

CREATE TABLE IF NOT EXISTS rigs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT '',
  focal_mm REAL,
  aperture_f REAL,
  device TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS night_rigs (
  night_id INTEGER NOT NULL,
  rig_id INTEGER NOT NULL,
  PRIMARY KEY (night_id, rig_id)
);

CREATE TABLE IF NOT EXISTS change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  detail_json TEXT,
  undoable INTEGER NOT NULL DEFAULT 0,
  undone INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_shots_target ON shots(target_id);
CREATE INDEX IF NOT EXISTS idx_shots_night ON shots(night_id);
CREATE INDEX IF NOT EXISTS idx_nights_date ON nights(date);
CREATE INDEX IF NOT EXISTS idx_assets_shot ON assets(shot_id);
CREATE INDEX IF NOT EXISTS idx_assets_night ON assets(night_id);
CREATE INDEX IF NOT EXISTS idx_night_rigs_rig ON night_rigs(rig_id);
`

export function openDatabase(dataDir: string): DB {
  fs.mkdirSync(dataDir, { recursive: true })
  const db = new DatabaseSync(path.join(dataDir, 'archive.db'))
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db: DB) {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
  const current = Number(row?.user_version ?? 0)
  if (current >= SCHEMA_VERSION) return
  db.exec('BEGIN')
  try {
    db.exec(SCHEMA_SQL)
    if (current < 2) {
      // v2：天体名片字段。新建库同样走这里补齐，保证表结构一致。
      db.exec(`
        ALTER TABLE targets ADD COLUMN alias TEXT;
        ALTER TABLE targets ADD COLUMN magnitude REAL;
        ALTER TABLE targets ADD COLUMN description TEXT;
        ALTER TABLE targets ADD COLUMN source TEXT;
        ALTER TABLE targets ADD COLUMN profile_updated_at TEXT;
        ALTER TABLE targets ADD COLUMN profile_edited INTEGER NOT NULL DEFAULT 0;
      `)
    }
    if (current < 3) {
      // v3：器材库与夜次器材关联，夜次增加天气备注。
      db.exec(`
        ALTER TABLE nights ADD COLUMN weather TEXT;
      `)
      const seeded = Number((db.prepare('SELECT COUNT(*) AS c FROM rigs').get() as { c: number } | undefined)?.c ?? 0)
      if (seeded === 0) {
        const at = nowIso()
        const insert = db.prepare(
          'INSERT INTO rigs(name, type, focal_mm, aperture_f, device, notes, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)'
        )
        insert.run('Dwarf Mini', '一体式智能望远镜', null, null, 'DWARFMINI', '预置器材，可按实机补全焦距与光圈', at, at)
        insert.run('佳能 + 15mm', '广角星野组合', 15, 2.8, 'CANON', '机身型号可后续补充', at, at)
        insert.run('手机', '手机星野', null, null, 'PHONE', null, at, at)
      }
    }
    if (current < 4) {
      // v4：成品版本登记。版本是成片自身的一组附加字段，来源拍摄组另存关联表。
      db.exec(`
        ALTER TABLE shots ADD COLUMN version_no INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE shots ADD COLUMN version_name TEXT;
        ALTER TABLE shots ADD COLUMN version_tags TEXT;
        ALTER TABLE shots ADD COLUMN version_software TEXT;
        ALTER TABLE shots ADD COLUMN version_processed_at TEXT;
        ALTER TABLE shots ADD COLUMN version_note TEXT;
        ALTER TABLE shots ADD COLUMN is_final_version INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE shots ADD COLUMN version_order INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE shots ADD COLUMN version_edited INTEGER NOT NULL DEFAULT 0;
        CREATE TABLE IF NOT EXISTS version_sources (
          version_shot_id INTEGER NOT NULL,
          night_id INTEGER NOT NULL,
          PRIMARY KEY (version_shot_id, night_id)
        );
        CREATE INDEX IF NOT EXISTS idx_version_sources_night ON version_sources(night_id);
      `)
      backfillVersions(db)
    }
    if (current < 5) {
      // v5：Dwarf 增量同步记录。以「会话相对路径 + 文件大小」为去重键，
      // 记录每个副本来自哪次同步（batch_id），撤销时按批次删除。
      db.exec(`
        CREATE TABLE IF NOT EXISTS synced_files (
          key TEXT PRIMARY KEY,
          source_rel TEXT NOT NULL,
          dest_rel TEXT NOT NULL,
          bytes INTEGER NOT NULL,
          batch_id TEXT NOT NULL,
          copied_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_synced_batch ON synced_files(batch_id);
      `)
    }
    if (current < 6) {
      // v6：水印识别结果。曝光来源标明总曝光是按原始帧、EXIF 还是水印推算；
      // 水印文本留档便于回溯，review_state 标记待确认（识别不可靠时）。
      db.exec(`
        ALTER TABLE shots ADD COLUMN exposure_source TEXT;
        ALTER TABLE shots ADD COLUMN watermark_text TEXT;
        ALTER TABLE shots ADD COLUMN review_state TEXT NOT NULL DEFAULT 'ok';
      `)
    }
    if (current < 7) {
      // v7：夜次后期处理备注，记录堆栈/拼接与调色思路
      db.exec(`ALTER TABLE nights ADD COLUMN post_process TEXT;`)
    }
    if (current < 8) {
      // v8：素材文件 mtime，用于增量扫描指纹（路径 + 大小 + mtime）
      db.exec(`ALTER TABLE assets ADD COLUMN mtime INTEGER NOT NULL DEFAULT 0;`)
    }
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/** 迁移回填：同目标同日期按导入时间编号 v1…vn；星野按夜次+子类编号。 */
function backfillVersions(db: DB) {
  const rows = db
    .prepare(
      `SELECT s.id, s.night_id, s.target_id, COALESCE(n.date, substr(s.captured_at, 1, 10), '') AS day, s.created_at
       FROM shots s LEFT JOIN nights n ON n.id = s.night_id
       WHERE s.is_final = 1
       ORDER BY s.target_id, s.sub_type, day, s.created_at, s.id`
    )
    .all() as Array<{ id: number; night_id: number | null; target_id: number | null; day: string }>
  const counters = new Map<string, number>()
  const update = db.prepare('UPDATE shots SET version_no = ?, version_order = ? WHERE id = ?')
  const link = db.prepare('INSERT OR IGNORE INTO version_sources(version_shot_id, night_id) VALUES(?, ?)')
  for (const row of rows) {
    const key = row.target_id !== null ? `t${row.target_id}|${row.day}` : `n${row.night_id ?? row.id}`
    const no = (counters.get(key) ?? 0) + 1
    counters.set(key, no)
    update.run(no, no, row.id)
    if (row.night_id) link.run(row.id, row.night_id)
  }
}

export function getSetting(db: DB, key: string): string | null {  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(db: DB, key: string, value: string | null) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}

export function ensureDefaults(db: DB) {
  // 素材库根目录由建库向导写入，未设置时启动会弹出向导
  if (getSetting(db, 'last_scan_at') === null) setSetting(db, 'last_scan_at', '')
}

export function nowIso() {
  return new Date().toISOString()
}
