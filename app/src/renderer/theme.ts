import type { AccentKey, Appearance, ThemePref } from './types'

const KEYS = { theme: 'astro.theme', accent: 'astro.accent', motion: 'astro.motion' } as const

export const ACCENT_OPTIONS: Array<{ key: AccentKey; label: string }> = [
  { key: 'cyan', label: '极光青' },
  { key: 'violet', label: '星云紫' },
  { key: 'amber', label: '猎户金' },
  { key: 'green', label: '极光绿' },
  { key: 'rose', label: '玫瑰红' },
  { key: 'indigo', label: '深空蓝' }
]

export const THEME_OPTIONS: Array<{ key: ThemePref; label: string }> = [
  { key: 'dark', label: '深色' },
  { key: 'light', label: '浅色' },
  { key: 'system', label: '跟随系统' }
]

const THEME_KEYS: ThemePref[] = ['dark', 'light', 'system']
const ACCENT_KEYS: AccentKey[] = ['cyan', 'violet', 'amber', 'green', 'rose', 'indigo']

export function readCachedAppearance(): Appearance {
  let theme: ThemePref = 'dark'
  let accent: AccentKey = 'cyan'
  let reduceMotion = false
  try {
    const t = localStorage.getItem(KEYS.theme) as ThemePref | null
    const a = localStorage.getItem(KEYS.accent) as AccentKey | null
    if (t && THEME_KEYS.includes(t)) theme = t
    if (a && ACCENT_KEYS.includes(a)) accent = a
    reduceMotion = localStorage.getItem(KEYS.motion) === '1'
  } catch {
    /* 禁用 localStorage 时使用默认值 */
  }
  return { theme, accent, reduceMotion }
}

export function prefersLight() {
  return window.matchMedia('(prefers-color-scheme: light)').matches
}

export function isLightTheme(appearance: Appearance) {
  return appearance.theme === 'light' || (appearance.theme === 'system' && prefersLight())
}

/** 把外观设置落到 <html> 并缓存到 localStorage，供下次启动的首屏脚本读取 */
export function applyAppearance(appearance: Appearance) {
  const root = document.documentElement
  const light = isLightTheme(appearance)
  root.dataset.theme = light ? 'light' : 'dark'
  root.dataset.themePref = appearance.theme
  root.dataset.accent = appearance.accent
  if (appearance.reduceMotion) root.dataset.motion = 'reduce'
  else delete root.dataset.motion
  root.style.background = light ? '#f2f6fc' : '#05070e'
  try {
    localStorage.setItem(KEYS.theme, appearance.theme)
    localStorage.setItem(KEYS.accent, appearance.accent)
    localStorage.setItem(KEYS.motion, appearance.reduceMotion ? '1' : '0')
  } catch {
    /* 忽略缓存失败 */
  }
}
