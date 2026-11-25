import { applyAppearance, readCachedAppearance } from '../src/renderer/theme'

function ok(cond: unknown, message: string) {
  if (!cond) {
    console.error('FAIL: ' + message)
    process.exit(1)
  }
  console.log('ok - ' + message)
}

interface FakeStorage {
  store: Map<string, string>
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

function installDom() {
  const store = new Map<string, string>()
  const localStorage: FakeStorage = {
    store,
    getItem: (key) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key, value) => {
      store.set(key, value)
    }
  }
  const documentElement = { dataset: {} as Record<string, string>, style: {} as Record<string, string> }
  ;(globalThis as unknown as { localStorage: FakeStorage }).localStorage = localStorage
  ;(globalThis as unknown as { document: unknown }).document = { documentElement }
  ;(globalThis as unknown as { window: unknown }).window = {
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  }
  return { store, documentElement }
}

function main() {
  const { store, documentElement } = installDom()

  const fallback = readCachedAppearance()
  ok(fallback.theme === 'dark' && fallback.accent === 'cyan' && fallback.reduceMotion === false, '无缓存时使用深色默认值')

  applyAppearance({ theme: 'light', accent: 'violet', reduceMotion: true })
  ok(documentElement.dataset.theme === 'light', '浅色主题写入 html[data-theme]')
  ok(documentElement.dataset.accent === 'violet', '强调色写入 html[data-accent]')
  ok(documentElement.dataset.motion === 'reduce', '减少动效写入 html[data-motion]')
  ok(store.get('astro.theme') === 'light' && store.get('astro.accent') === 'violet', '主题与强调色缓存到 localStorage')

  const restored = readCachedAppearance()
  ok(restored.theme === 'light' && restored.accent === 'violet' && restored.reduceMotion === true, '重启后从缓存恢复外观')

  store.set('astro.theme', 'neon')
  store.set('astro.accent', 'blue')
  const sanitized = readCachedAppearance()
  ok(sanitized.theme === 'dark' && sanitized.accent === 'cyan', '非法缓存值回退默认主题')

  applyAppearance({ theme: 'dark', accent: 'cyan', reduceMotion: false })
  ok(documentElement.dataset.motion === undefined, '关闭减少动效时移除 html[data-motion]')

  console.log('\nALL PASSED')
}

main()
