export function hoursLabel(seconds: number, digits = 1) {
  if (!seconds || seconds <= 0) return '—'
  return `${(seconds / 3600).toFixed(digits)} h`
}

export function durationLabel(seconds: number) {
  if (!seconds || seconds <= 0) return '—'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.round((total % 3600) / 60)
  if (h > 0 && m > 0) return `${h} h ${m} m`
  if (h > 0) return `${h} h`
  if (m > 0) return `${m} m`
  return `${total} s`
}

export function videoTimeLabel(seconds: number) {
  if (!seconds || seconds <= 0) return '—'
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function exposureLabel(seconds: number | null, frames: number) {
  if (!seconds) return '—'
  const s = seconds >= 1 ? Math.round(seconds) : Number(seconds.toFixed(2))
  return frames > 0 ? `${s} s × ${frames}` : `${s} s`
}

export function bytesLabel(bytes: number) {
  if (!bytes) return '—'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

export function shortDate(iso: string | null) {
  if (!iso) return '—'
  return iso.slice(0, 10)
}

export function timeOf(iso: string | null) {
  if (!iso || iso.length < 16) return ''
  return iso.slice(11, 16)
}

export function deviceLabel(device: string | null) {
  if (!device) return '—'
  if (device === 'DWARFMINI') return 'DWARF mini'
  if (device === 'CANON') return 'Canon'
  if (device === 'PHONE') return '手机'
  return device
}

export function lastScanLabel(iso: string) {
  if (!iso) return '尚未扫描'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `上次同步 ${p(d.getHours())}:${p(d.getMinutes())}`
}
