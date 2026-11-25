import sharp from 'sharp'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** 缩略图三档：124 以高度为准（详情胶片带），320/1600 以宽度为准 */
export const THUMB_SIZES = [124, 320, 1600] as const
export type ThumbSize = (typeof THUMB_SIZES)[number]

export interface ImageProbe {
  width: number
  height: number
  ar: number
  stripRatio: number
  key: string
}

export function thumbKey(rel: string, mtimeMs: number, bytes: number) {
  return crypto
    .createHash('sha1')
    .update(`${rel}|${Math.round(mtimeMs)}|${bytes}`)
    .digest('hex')
    .slice(0, 20)
}

export function thumbPath(thumbsDir: string, key: string, size: number) {
  return path.join(thumbsDir, `${key}_${size}.webp`)
}

/**
 * 识别 Dwarf 成片底部的白色水印条。
 * 只取原图底部 22% 逐行判断：足够亮且几乎无彩色，视为白条。
 */
async function detectWhiteBar(absPath: string, width: number, height: number): Promise<number> {
  const probeH = Math.min(400, Math.max(24, Math.round(height * 0.22)))
  const { data, info } = await sharp(absPath)
    .extract({ left: 0, top: height - probeH, width, height: probeH })
    .resize({ width: 48 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const channels = info.channels
  const rows = info.height
  let whiteRows = 0

  for (let y = rows - 1; y >= 0; y--) {
    let sum = 0
    let min = 255
    let max = 0
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * channels
      const r = data[i]
      const g = data[i + 1] ?? r
      const b = data[i + 2] ?? r
      const lum = (r + g + b) / 3
      sum += lum
      if (lum < min) min = lum
      if (lum > max) max = lum
    }
    const avg = sum / info.width
    if (avg > 195 && max - min < 32) whiteRows++
    else break
  }

  const stripPx = Math.round((whiteRows / rows) * probeH)
  const ratio = stripPx / height
  return ratio > 0.004 && ratio < 0.25 ? ratio : 0
}

/** 读取尺寸、识别白条并生成三档 WebP 缩略图；失败返回 null（不阻断扫描） */
export async function probeAndThumb(
  absPath: string,
  rel: string,
  mtimeMs: number,
  bytes: number,
  thumbsDir: string
): Promise<ImageProbe | null> {
  try {
    const meta = await sharp(absPath).metadata()
    const orientation = meta.orientation ?? 1
    const rotated = orientation >= 5 && orientation <= 8
    const width = Number(rotated ? meta.height : meta.width) || 0
    const height = Number(rotated ? meta.width : meta.height) || 0
    if (!width || !height) return null

    let stripRatio = 0
    try {
      stripRatio = await detectWhiteBar(absPath, width, height)
    } catch {
      stripRatio = 0
    }

    const key = thumbKey(rel, mtimeMs, bytes)
    const cropH = Math.max(1, Math.round(height * (1 - stripRatio)))

    for (const size of THUMB_SIZES) {
      const out = thumbPath(thumbsDir, key, size)
      if (fs.existsSync(out)) continue
      let pipeline = sharp(absPath).rotate()
      if (stripRatio > 0) {
        pipeline = pipeline.extract({ left: 0, top: 0, width, height: cropH })
      }
      pipeline =
        size === 124
          ? pipeline.resize({ height: size, withoutEnlargement: true })
          : pipeline.resize({ width: size, withoutEnlargement: true })
      await pipeline.webp({ quality: 82 }).toFile(out)
    }

    return { width, height: cropH, ar: width / cropH, stripRatio, key }
  } catch {
    return null
  }
}
