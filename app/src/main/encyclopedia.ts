import type { DB } from './db'

export type EncyclopediaSite = 'wikipedia' | 'baike'

const SITES: readonly EncyclopediaSite[] = ['wikipedia', 'baike']

export function isEncyclopediaSite(value: unknown): value is EncyclopediaSite {
  return typeof value === 'string' && (SITES as readonly string[]).includes(value)
}

export interface TargetNames {
  catalogId: string
  nameCn: string
  nameEn: string | null
}

/** 归一化目录编号：M42 → M 42，NGC1499 → NGC 1499，IC434 → IC 434 */
function normalizeCatalogId(catalogId: string) {
  const compact = catalogId.trim().replace(/\s+/g, ' ').toUpperCase()
  const match = compact.match(/^(M|NGC|IC)\s*(\d+)$/)
  return match ? `${match[1]} ${match[2]}` : compact
}

function wikipediaUrl(target: TargetNames) {
  const id = normalizeCatalogId(target.catalogId)
  const direct = id.match(/^(M|NGC|IC) (\d+)$/)
  if (direct) {
    const page = direct[1] === 'M' ? `Messier_${direct[2]}` : `${direct[1]}_${direct[2]}`
    return `https://en.wikipedia.org/wiki/${page}`
  }
  const query = target.nameEn?.trim() || id || target.nameCn.trim()
  return `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(query)}`
}

function baikeUrl(target: TargetNames) {
  const term = target.nameCn.trim() || normalizeCatalogId(target.catalogId)
  return `https://baike.baidu.com/item/${encodeURIComponent(term)}`
}

/** 只在主进程拼接受控 URL，渲染进程不接触地址 */
export function buildEncyclopediaUrl(target: TargetNames, site: EncyclopediaSite) {
  return site === 'wikipedia' ? wikipediaUrl(target) : baikeUrl(target)
}

interface TargetNameRow {
  catalog_id: string
  name_cn: string
  name_en: string | null
}

export async function openEncyclopedia(db: DB, targetId: number, site: unknown) {
  if (!Number.isInteger(targetId) || targetId <= 0) return { ok: false, error: '天体编号无效' }
  if (!isEncyclopediaSite(site)) return { ok: false, error: '不支持的外部资料站点' }

  const row = db
    .prepare('SELECT catalog_id, name_cn, name_en FROM targets WHERE id = ?')
    .get(targetId) as unknown as TargetNameRow | undefined
  if (!row) return { ok: false, error: '天体不存在' }

  const url = buildEncyclopediaUrl(
    { catalogId: row.catalog_id, nameCn: row.name_cn, nameEn: row.name_en },
    site
  )
  try {
    const { shell } = await import('electron')
    await shell.openExternal(url)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `打开浏览器失败：${(err as Error).message}` }
  }
}
