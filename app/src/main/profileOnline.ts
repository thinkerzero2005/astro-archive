import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { DB, getSetting, nowIso } from './db'

export interface OnlineProfileData {
  title: string
  extract: string
  shortDescription: string
  imageUrl: string | null
  source: string
  updatedAt: string
  lang: 'zh' | 'en' | null
}

export interface OnlineProfileResult {
  ok: boolean
  /** 设置里是否允许联网；关闭时只读缓存 */
  enabled: boolean
  cached: boolean
  /** true 表示没有在线资料，页面沿用内置天体资料 */
  builtin: boolean
  profile: OnlineProfileData | null
  error?: string
}

interface TargetRow {
  catalog_id: string
  name_cn: string
  name_en: string | null
  alias: string | null
  description: string | null
  profile_edited: number
}

interface CacheRecord {
  title: string
  extract: string
  shortDescription: string
  imageFile: string | null
  source: string
  lang: 'zh' | 'en'
  updatedAt: string
  fetchedAt: string
}

interface WikiSummary {
  title: string
  extract: string
  description: string
  imageUrl: string | null
  lang: 'zh' | 'en'
}

const CACHE_MAX_AGE_MS = 7 * 24 * 3600 * 1000
const FETCH_TIMEOUT_MS = 8000
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const USER_AGENT = 'AstroArchive/0.4.0 (local astrophotography archive)'

function slug(catalogId: string) {
  return catalogId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'target'
}

export function profileCachePath(cacheDir: string, catalogId: string) {
  return path.join(cacheDir, `${slug(catalogId)}.json`)
}

function cacheUrl(imageFile: string | null) {
  return imageFile ? `astro://cache/${encodeURIComponent(imageFile)}` : null
}

function readCache(cacheDir: string, catalogId: string): CacheRecord | null {
  try {
    const raw = fs.readFileSync(profileCachePath(cacheDir, catalogId), 'utf8')
    const data = JSON.parse(raw) as Partial<CacheRecord>
    if (!data || typeof data.title !== 'string' || typeof data.extract !== 'string') return null
    const imageFile = data.imageFile && fs.existsSync(path.join(cacheDir, data.imageFile)) ? data.imageFile : null
    return {
      title: data.title,
      extract: data.extract,
      shortDescription: String(data.shortDescription ?? ''),
      imageFile,
      source: String(data.source ?? '维基百科'),
      lang: data.lang === 'en' ? 'en' : 'zh',
      updatedAt: String(data.updatedAt ?? ''),
      fetchedAt: String(data.fetchedAt ?? '')
    }
  } catch {
    return null
  }
}

function toData(record: CacheRecord): OnlineProfileData {
  return {
    title: record.title,
    extract: record.extract,
    shortDescription: record.shortDescription,
    imageUrl: cacheUrl(record.imageFile),
    source: record.source,
    updatedAt: record.updatedAt,
    lang: record.lang
  }
}

/** 只把目标名称发给维基百科：中文优先，英文兜底 */
function nameCandidates(row: TargetRow) {
  const zh: string[] = []
  const en: string[] = []
  const cn = row.name_cn.trim()
  const english = (row.name_en ?? '').trim()
  const catalog = row.catalog_id.trim()
  if (cn) zh.push(cn)
  if (english) zh.push(english)
  if (catalog) zh.push(catalog)
  if (english) en.push(english)
  if (catalog) en.push(catalog)
  if (cn) en.push(cn)
  const dedupe = (list: string[]) => list.filter((name, i) => name && list.indexOf(name) === i)
  return { zh: dedupe(zh), en: dedupe(en) }
}

async function fetchJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const res = await fetchImpl(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function lookup(lang: 'zh' | 'en', term: string, fetchImpl: typeof fetch): Promise<WikiSummary | null> {
  const base = lang === 'zh' ? 'https://zh.wikipedia.org' : 'https://en.wikipedia.org'
  const search = await fetchJson(
    fetchImpl,
    `${base}/w/api.php?action=query&format=json&list=search&srlimit=1&srsearch=${encodeURIComponent(term)}`
  )
  const hit = (search as { query?: { search?: Array<{ title?: string }> } })?.query?.search?.[0]
  const title = hit?.title?.trim()
  if (!title) return null
  const summary = (await fetchJson(
    fetchImpl,
    `${base}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/\s+/g, '_'))}`
  )) as {
    type?: string
    title?: string
    extract?: string
    description?: string
    originalimage?: { source?: string }
    thumbnail?: { source?: string }
  }
  if (!summary || summary.type === 'disambiguation' || !summary.extract) return null
  return {
    title: summary.title ?? title,
    extract: summary.extract,
    description: summary.description ?? '',
    imageUrl: summary.originalimage?.source ?? summary.thumbnail?.source ?? null,
    lang
  }
}

async function downloadImage(
  fetchImpl: typeof fetch,
  cacheDir: string,
  catalogId: string,
  imageUrl: string
): Promise<string | null> {
  try {
    const res = await fetchImpl(imageUrl, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? ''
    if (!/^image\//.test(type)) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length || buf.length > MAX_IMAGE_BYTES) return null
    const ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : '.jpg'
    const file = `${slug(catalogId)}${ext}`
    await fsp.mkdir(cacheDir, { recursive: true })
    await fsp.writeFile(path.join(cacheDir, file), buf)
    return file
  } catch {
    return null
  }
}

async function saveCache(cacheDir: string, catalogId: string, record: CacheRecord) {
  await fsp.mkdir(cacheDir, { recursive: true })
  await fsp.writeFile(profileCachePath(cacheDir, catalogId), JSON.stringify(record, null, 2), 'utf8')
}

function saveToTarget(db: DB, targetId: number, summary: WikiSummary) {
  const source = summary.lang === 'zh' ? '维基百科（中文）' : '维基百科（英文）'
  const now = nowIso()
  db.prepare(
    `UPDATE targets SET
       name_en = CASE WHEN COALESCE(name_en, '') = '' THEN ? ELSE name_en END,
       description = ?,
       source = ?,
       profile_updated_at = ?,
       updated_at = ?
     WHERE id = ? AND profile_edited = 0`
  ).run(summary.lang === 'en' ? summary.title : null, summary.extract.slice(0, 4000), source, now, now, targetId)
}

/**
 * 取天体在线名片。默认不联网（隐私优先）：设置关闭时只读数据目录缓存。
 * 联网失败不抛错，返回缓存或内置资料回退，由页面显示重试。
 */
export async function getOnlineProfile(
  db: DB,
  targetId: number,
  options: { force?: boolean; cacheDir: string; fetchImpl?: typeof fetch; now?: () => Date }
): Promise<OnlineProfileResult> {
  const enabled = getSetting(db, 'allow_online_profile') === '1'
  const row = db
    .prepare('SELECT catalog_id, name_cn, name_en, alias, description, profile_edited FROM targets WHERE id = ?')
    .get(targetId) as unknown as TargetRow | undefined
  if (!row) {
    return { ok: false, enabled, cached: false, builtin: false, profile: null, error: '天体不存在' }
  }

  const cached = readCache(options.cacheDir, row.catalog_id)
  if (!enabled) {
    return {
      ok: !!cached,
      enabled: false,
      cached: !!cached,
      builtin: !cached,
      profile: cached ? toData(cached) : null,
      error: cached ? undefined : '未开启联网资料，可在设置中允许获取'
    }
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? (() => new Date())
  const fetchedAt = cached ? Date.parse(cached.fetchedAt) : NaN
  const fresh = cached && Number.isFinite(fetchedAt) && now().getTime() - fetchedAt < CACHE_MAX_AGE_MS
  if (cached && fresh && !options.force) {
    return { ok: true, enabled: true, cached: true, builtin: false, profile: toData(cached) }
  }

  try {
    const { zh, en } = nameCandidates(row)
    let summary: WikiSummary | null = null
    for (const term of zh) {
      summary = await lookup('zh', term, fetchImpl)
      if (summary) break
    }
    if (!summary) {
      for (const term of en) {
        summary = await lookup('en', term, fetchImpl)
        if (summary) break
      }
    }
    if (!summary) throw new Error('百科没有找到匹配条目')

    const imageFile = summary.imageUrl
      ? await downloadImage(fetchImpl, options.cacheDir, row.catalog_id, summary.imageUrl)
      : null
    const record: CacheRecord = {
      title: summary.title,
      extract: summary.extract,
      shortDescription: summary.description,
      imageFile,
      source: summary.lang === 'zh' ? '维基百科（中文）' : '维基百科（英文）',
      lang: summary.lang,
      updatedAt: nowIso(),
      fetchedAt: nowIso()
    }
    await saveCache(options.cacheDir, row.catalog_id, record)
    saveToTarget(db, targetId, summary)
    return { ok: true, enabled: true, cached: false, builtin: false, profile: toData(record) }
  } catch (err) {
    const message = (err as Error).message || '联网获取失败'
    if (cached) {
      return {
        ok: false,
        enabled: true,
        cached: true,
        builtin: false,
        profile: toData(cached),
        error: `联网失败，已显示缓存：${message}`
      }
    }
    return {
      ok: false,
      enabled: true,
      cached: false,
      builtin: true,
      profile: null,
      error: `联网获取失败：${message}`
    }
  }
}
