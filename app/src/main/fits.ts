import fsp from 'node:fs/promises'

/** FITS 头里对归档有用的字段；解析失败时为 null 或空字符串 */
export interface FitsHeader {
  /** 原始 DATE-OBS 字符串，通常为 UTC */
  dateObs: string | null
  /** 观测夜次日期，取 DATE-OBS 的日期部分（按夜间归属惯例，UTC 日期与「当晚」一致） */
  nightDate: string | null
  exposureS: number | null
  gain: number | null
  filter: string | null
  object: string | null
}

const CARD = 80
/** 头部通常不超过几十张卡片；8 个 2880 字节块足够覆盖 */
const HEAD_BYTES = CARD * 36 * 8

function parseCardValue(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  if (text.startsWith("'")) {
    // 字符串值以单引号包围，内部 '' 表示一个单引号
    let out = ''
    for (let i = 1; i < text.length; i++) {
      if (text[i] === "'") {
        if (text[i + 1] === "'") {
          out += "'"
          i++
          continue
        }
        return out.trim()
      }
      out += text[i]
    }
    return out.trim()
  }
  return text.split(/\s+/)[0] ?? null
}

function parseNumber(raw: string | null): number | null {
  if (raw === null) return null
  // FITS 数值可能用 D 表示双精度指数
  const value = Number(raw.replace(/[dD]/, 'e'))
  return Number.isFinite(value) ? value : null
}

/** DATE-OBS 可以是 ISO 时间、纯日期或紧凑日期；只取日期部分 */
export function fitsDateToDay(dateObs: string | null): string | null {
  if (!dateObs) return null
  const iso = dateObs.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const compact = dateObs.match(/^(\d{4})(\d{2})(\d{2})/)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  return null
}

/** 解析一个已读入内存的 FITS 头；没有 SIMPLE/END 视为损坏或截断 */
export function parseFitsHeader(buf: Buffer): FitsHeader | null {
  if (buf.length < CARD) return null
  let simple = false
  const header: FitsHeader = {
    dateObs: null,
    nightDate: null,
    exposureS: null,
    gain: null,
    filter: null,
    object: null
  }
  for (let offset = 0; offset + CARD <= buf.length; offset += CARD) {
    const card = buf.toString('latin1', offset, offset + CARD)
    const key = card.slice(0, 8).trim().toUpperCase()
    if (!key) continue
    if (offset === 0) {
      if (key !== 'SIMPLE') return null
      simple = true
      continue
    }
    if (key === 'END') return simple ? header : null
    if (card[8] !== '=') continue
    // 字符串值经常超过 20 字符并占用注释区，按整张卡片解析
    const value = parseCardValue(card.slice(10))
    switch (key) {
      case 'DATE-OBS':
        header.dateObs = value
        header.nightDate = fitsDateToDay(value)
        break
      case 'EXPTIME':
        header.exposureS = parseNumber(value)
        break
      case 'GAIN':
        header.gain = parseNumber(value)
        break
      case 'FILTER':
        header.filter = value ?? null
        break
      case 'OBJECT':
        header.object = value ?? null
        break
      default:
        break
    }
  }
  // 没读到 END：头被截断
  return null
}

/** 只读取文件头，不加载像素数据 */
export async function readFitsHeader(file: string, maxBytes = HEAD_BYTES): Promise<FitsHeader | null> {
  try {
    const handle = await fsp.open(file, 'r')
    try {
      const buf = Buffer.alloc(maxBytes)
      const { bytesRead } = await handle.read(buf, 0, maxBytes, 0)
      return parseFitsHeader(buf.subarray(0, bytesRead))
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

export function isFitsFile(name: string) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return ext === '.fits' || ext === '.fit' || ext === '.fts'
}
