import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { openDatabase, ensureDefaults } from '../src/main/db'
import { Scanner } from '../src/main/scanner'
import { getOverview, getTargetDetail, getShotDetail } from '../src/main/queries'

const libraryRoot = process.env.ASTRO_PROBE_LIBRARY
if (!libraryRoot) {
  console.error('请先设置 ASTRO_PROBE_LIBRARY 指向要扫描的素材库目录')
  process.exit(1)
}

const dataDir = path.join(os.tmpdir(), 'astro-scan-probe')
fs.rmSync(dataDir, { recursive: true, force: true })
const thumbsDir = path.join(dataDir, 'thumbs')
fs.mkdirSync(thumbsDir, { recursive: true })
const db = openDatabase(dataDir)
ensureDefaults(db)

const scanner = new Scanner(db, libraryRoot, thumbsDir, (p) => console.log('progress', p.phase, `${p.done}/${p.total}`, p.label ?? ''))
const result = await scanner.scan()
console.log('SCAN', JSON.stringify(result, null, 2))

const overview = getOverview(db, libraryRoot)
console.log('OVERVIEW', JSON.stringify({ stats: overview.stats, hero: overview.hero, targets: overview.targets, ns: overview.nightscape, nights: overview.recentNights }, null, 2))

const t = overview.targets[0]
if (t) {
  const detail = getTargetDetail(db, libraryRoot, t.id)
  console.log('TARGET', JSON.stringify(detail, null, 2))
  const shotId = detail?.groups[0]?.shots[0]?.id
  if (shotId) console.log('SHOT', JSON.stringify(getShotDetail(db, libraryRoot, shotId), null, 2))
}

console.log('THUMBS', fs.readdirSync(thumbsDir).length)
