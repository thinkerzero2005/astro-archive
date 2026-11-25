import { useCallback, useEffect, useRef, useState } from 'react'
import api from './api'
import { Sidebar, NavKey } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { Home } from './pages/Home'
import { DeepSky } from './pages/DeepSky'
import { TargetDetail } from './pages/TargetDetail'
import { Nightscape } from './pages/Nightscape'
import { Night } from './pages/Night'
import { Stats } from './pages/Stats'
import { Calibration } from './pages/Calibration'
import { Settings } from './pages/Settings'
import { Search } from './pages/Search'
import { Viewer } from './pages/Viewer'
import { VideoPlayer } from './pages/VideoPlayer'
import { ImportDialog } from './components/ImportDialog'
import { SyncDialog } from './components/SyncDialog'
import { LibraryWizard } from './components/LibraryWizard'
import { DEFAULT_HOME_MODULES } from './homeModules'
import { applyAppearance, readCachedAppearance } from './theme'
import type { Appearance, HomeModules, Overview } from './types'

type Route =
  | { name: 'home' }
  | { name: 'deepsky' }
  | { name: 'target'; id: number }
  | { name: 'nightscape'; type: string }
  | { name: 'night'; date?: string }
  | { name: 'search' }
  | { name: 'stats' }
  | { name: 'calibration' }
  | { name: 'settings' }

type Toast = { id: number; message: string; kind: 'info' | 'error' | 'ok' }

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'home' })
  const [overview, setOverview] = useState<Overview | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [scanStage, setScanStage] = useState<'parse' | 'thumb' | 'watermark' | undefined>()
  const [search, setSearch] = useState('')
  const [viewerShot, setViewerShot] = useState<number | null>(null)
  const [viewerVideo, setViewerVideo] = useState<number | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState('')
  const [appearance, setAppearance] = useState<Appearance>(() => readCachedAppearance())
  const [homeModules, setHomeModules] = useState<HomeModules>(DEFAULT_HOME_MODULES)
  const toastTimer = useRef<number | null>(null)

  const pushToast = useCallback((message: string, kind: 'info' | 'error' | 'ok' = 'info') => {
    setToast({ id: Date.now(), message, kind })
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 4200)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const data = await api.overview()
      setOverview(data)
      setRefreshKey(String(Date.now()))
    } catch (err) {
      pushToast(`读取素材库失败：${(err as Error).message}`, 'error')
    }
  }, [pushToast])

  useEffect(() => {
    api
      .bootstrap()
      .then(({ overview: data, libraryRootExists }) => {
        setOverview(data)
        if (!libraryRootExists) setWizardOpen(true)
      })
      .catch((err) => pushToast(`启动失败：${(err as Error).message}`, 'error'))

    api
      .appearanceGet()
      .then((saved) => setAppearance(saved))
      .catch(() => {
        /* 读取外观失败时沿用本地缓存 */
      })

    api
      .homeModulesGet()
      .then((saved) => setHomeModules(saved))
      .catch(() => {
        /* 读取失败时沿用默认顺序 */
      })

    const offChanged = api.onLibraryChanged(() => {
      refresh()
    })
    const offProgress = api.onScanProgress((p) => {
      if (p.phase === 'done') {
        setProgress(100)
        setScanStage(undefined)
        return
      }
      setScanStage(p.stage)
      const ratio = p.total > 0 ? p.done / p.total : 0
      setProgress(p.phase === 'deep_sky' ? ratio * 50 : 50 + ratio * 50)
    })
    return () => {
      offChanged()
      offProgress()
    }
  }, [pushToast, refresh])

  useEffect(() => {
    applyAppearance(appearance)
  }, [appearance])

  useEffect(() => {
    if (appearance.theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => applyAppearance(appearance)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [appearance])

  const changeAppearance = async (patch: Partial<Appearance>) => {
    const next = { ...appearance, ...patch }
    setAppearance(next)
    applyAppearance(next)
    const res = await api.appearanceSet(next)
    if (!res.ok) pushToast(res.error ?? '保存外观设置失败', 'error')
    else if (res.appearance) setAppearance(res.appearance)
  }

  const changeHomeModules = async (next: HomeModules) => {
    setHomeModules(next)
    try {
      const res = await api.homeModulesSet(next)
      if (!res.ok) pushToast(res.error ?? '保存首页模块设置失败', 'error')
      else if (res.modules) setHomeModules(res.modules)
    } catch (err) {
      pushToast((err as Error).message, 'error')
    }
  }

  const scan = async (full?: boolean) => {
    if (scanning) return
    // 按钮直接绑定 onScan 时 React 会把事件当第一个参数传进来
    const fullScan = full === true
    setScanning(true)
    setProgress(2)
    setScanStage('parse')
    try {
      const res = await api.scan(fullScan)
      if (res.ok) {
        const skipped = res.skipped ? `，跳过 ${res.skipped} 个未变化文件` : ''
        pushToast(`扫描完成：${res.shotCount} 张成片${skipped}，用时 ${(res.durationMs / 1000).toFixed(1)} s`, 'ok')
      } else if (res.cancelled) {
        pushToast('扫描已取消', 'info')
      } else {
        pushToast(res.errors?.[0] ?? res.error ?? '扫描失败', 'error')
      }
      await refresh()
    } catch (err) {
      pushToast(`扫描失败：${(err as Error).message}`, 'error')
    } finally {
      setScanning(false)
      setProgress(0)
      setScanStage(undefined)
    }
  }

  const cancelScan = async () => {
    const res = await api.cancelScan()
    if (!res.ok) pushToast(res.error ?? '当前没有正在进行的扫描', 'info')
    else pushToast('正在停止扫描…', 'info')
  }

  const undo = async () => {
    const res = await api.undoLast()
    if (!res.ok) {
      pushToast(res.error ?? '没有可撤销的操作', 'info')
      return
    }
    const extra = res.errors?.length ? `，${res.errors.length} 个未能恢复` : ''
    pushToast(
      res.kind === 'import'
        ? `已撤销导入，${res.restored ?? 0} 个文件已回到收件箱${extra}`
        : res.kind === 'edit'
          ? `已撤销照片信息修改（${res.restored ?? 0} 张）${extra}`
          : res.kind === 'profile'
            ? `已撤销天体名片修改${extra}`
            : res.kind === 'night'
              ? `已撤销夜次记录修改${extra}`
              : res.kind === 'rig'
                ? `已撤销器材修改${extra}`
                : res.kind === 'sync'
                  ? `已撤销同步，删除了素材库内 ${res.restored ?? 0} 个副本（设备原件未动）${extra}`
                  : `已撤销最近一次文件夹重命名${extra}`,
      'ok'
    )
    await refresh()
  }

  const openLibrary = async () => {
    const res = await api.openLibraryRoot()
    if (!res.ok) pushToast(res.error ?? '打开素材库失败', 'error')
  }

  const navigate = (key: NavKey) => {
    setSearch('')
    if (key === 'home') setRoute({ name: 'home' })
    if (key === 'deepsky') setRoute({ name: 'deepsky' })
    if (key === 'nightscape') setRoute({ name: 'nightscape', type: '银河' })
    if (key === 'night') setRoute({ name: 'night' })
    if (key === 'stats') setRoute({ name: 'stats' })
    if (key === 'calibration') setRoute({ name: 'calibration' })
    if (key === 'settings') setRoute({ name: 'settings' })
  }

  const active: NavKey | null =
    route.name === 'target'
      ? 'deepsky'
      : route.name === 'search'
        ? null
        : route.name === 'home' ||
            route.name === 'deepsky' ||
            route.name === 'night' ||
            route.name === 'stats' ||
            route.name === 'calibration' ||
            route.name === 'settings'
          ? route.name
          : 'nightscape'

  const crumb = (() => {
    if (route.name === 'home') {
      const today = new Date()
      const week = ['日', '一', '二', '三', '四', '五', '六'][today.getDay()]
      const p = (n: number) => String(n).padStart(2, '0')
      return (
        <>
          <span>星空档案馆</span>
          <span className="sep">/</span>
          <b>首页</b>
          <span className="sep">·</span>
          <span>
            {today.getFullYear()}-{p(today.getMonth() + 1)}-{p(today.getDate())} 周{week}
          </span>
        </>
      )
    }
    if (route.name === 'deepsky') {
      return (
        <>
          <span>星空档案馆</span>
          <span className="sep">/</span>
          <b>深空</b>
          <span className="sep">·</span>
          <span>{overview?.stats.targets ?? 0} 个目标</span>
        </>
      )
    }
    if (route.name === 'target') {
      return (
        <>
          <button
            className="crumb-link"
            onClick={() => {
              setSearch('')
              setRoute({ name: 'deepsky' })
            }}
          >
            深空
          </button>
          <span className="sep">/</span>
          <b>目标详情</b>
        </>
      )
    }
    if (route.name === 'night') {
      return (
        <>
          <span>星空档案馆</span>
          <span className="sep">/</span>
          <b>夜次</b>
          {route.date && (
            <>
              <span className="sep">·</span>
              <span>{route.date}</span>
            </>
          )}
        </>
      )
    }
    if (route.name === 'stats') {
      return (
        <>
          <span>星空档案馆</span>
          <span className="sep">/</span>
          <b>统计与历史</b>
          <span className="sep">·</span>
          <span>只读</span>
        </>
      )
    }
    if (route.name === 'calibration') {
      return (
        <>
          <span>星空档案馆</span>
          <span className="sep">/</span>
          <b>校准场</b>
          <span className="sep">·</span>
          <span>只读</span>
        </>
      )
    }
    if (route.name === 'settings') {
      return (
        <>
          <span>星空档案馆</span>
          <span className="sep">/</span>
          <b>设置</b>
        </>
      )
    }
    if (route.name === 'search') {
      return (
        <>
          <span>星空档案馆</span>
          <span className="sep">/</span>
          <b>检索</b>
          {search && (
            <>
              <span className="sep">·</span>
              <span>“{search}”</span>
            </>
          )}
        </>
      )
    }
    return (
      <>
        <span>星空档案馆</span>
        <span className="sep">/</span>
        <b>星野</b>
        <span className="sep">·</span>
        <span>{route.type}</span>
      </>
    )
  })()

  return (
    <div className="app-shell">
      <Sidebar
        active={active}
        overview={overview}
        onNavigate={navigate}
        onOpenLibrary={openLibrary}
        onScan={scan}
        scanning={scanning}
      />

      <div className="main">
        <Topbar
          crumb={crumb}
          search={search}
          onSearch={setSearch}
          onSearchSubmit={() => setRoute({ name: 'search' })}
          onScan={scan}
          scanning={scanning}
          progress={progress}
          scanStage={scanStage}
          onCancelScan={cancelScan}
          lastScanAt={overview?.lastScanAt ?? ''}
          onUndo={undo}
          onImport={() => setImportOpen(true)}
          onSync={() => setSyncOpen(true)}
          pendingInbox={overview?.pendingInbox ?? 0}
        />

        <div className="content">
          {!overview ? (
            <div className="boot">
              <div className="boot-mark">✦</div>
              <b>正在读取星空档案馆…</b>
            </div>
          ) : route.name === 'home' ? (
            <Home
              overview={overview}
              modules={homeModules}
              onOpenTarget={(id) => setRoute({ name: 'target', id })}
              onOpenShot={(id) => setViewerShot(id)}
              onOpenDeepSky={() => setRoute({ name: 'deepsky' })}
              onOpenNightscape={(type) => setRoute({ name: 'nightscape', type })}
              onOpenNight={(date) => setRoute({ name: 'night', date })}
              onOpenLibrary={openLibrary}
              onScan={scan}
              onOpenImport={() => setImportOpen(true)}
              onOpenSettings={() => setRoute({ name: 'settings' })}
            />
          ) : route.name === 'deepsky' ? (
            <DeepSky
              query={search}
              refreshKey={refreshKey}
              onOpenTarget={(id) => setRoute({ name: 'target', id })}
              onScan={scan}
            />
          ) : route.name === 'target' ? (
            <TargetDetail
              targetId={route.id}
              refreshKey={refreshKey}
              onBack={() => setRoute({ name: 'deepsky' })}
              onOpenShot={(id) => setViewerShot(id)}
              onChanged={refresh}
              pushToast={pushToast}
            />
          ) : route.name === 'nightscape' ? (
            <Nightscape
              type={route.type}
              counts={overview.stats.byType}
              refreshKey={refreshKey}
              onChangeType={(type) => setRoute({ name: 'nightscape', type })}
              onOpenShot={(id) => setViewerShot(id)}
              onOpenVideo={(id) => setViewerVideo(id)}
              onChanged={refresh}
              pushToast={pushToast}
            />
          ) : route.name === 'night' ? (
            <Night
              date={route.date}
              refreshKey={refreshKey}
              onOpenTarget={(id) => setRoute({ name: 'target', id })}
              onOpenShot={(id) => setViewerShot(id)}
              onOpenVideo={(id) => setViewerVideo(id)}
              onChanged={refresh}
              pushToast={pushToast}
            />
          ) : route.name === 'search' ? (
            <Search
              query={search}
              refreshKey={refreshKey}
              onOpenShot={setViewerShot}
              onOpenVideo={setViewerVideo}
              onChanged={refresh}
              pushToast={pushToast}
            />
          ) : route.name === 'calibration' ? (
            <Calibration refreshKey={refreshKey} pushToast={pushToast} />
          ) : route.name === 'settings' ? (
            <Settings
              refreshKey={refreshKey}
              scanning={scanning}
              onScan={scan}
              onSync={() => setSyncOpen(true)}
              appearance={appearance}
              onChangeAppearance={changeAppearance}
              homeModules={homeModules}
              onChangeHomeModules={changeHomeModules}
              onOpenLibraryWizard={() => setWizardOpen(true)}
              pushToast={pushToast}
            />
          ) : (
            <Stats
              refreshKey={refreshKey}
              onOpenTarget={(id) => setRoute({ name: 'target', id })}
              pushToast={pushToast}
            />
          )}
        </div>
      </div>

      {viewerShot !== null && (
        <Viewer
          shotId={viewerShot}
          onClose={() => setViewerShot(null)}
          onOpenShot={setViewerShot}
          onChanged={refresh}
          pushToast={pushToast}
        />
      )}

      {viewerVideo !== null && (
        <VideoPlayer videoId={viewerVideo} onClose={() => setViewerVideo(null)} pushToast={pushToast} />
      )}

      {importOpen && (
        <ImportDialog onClose={() => setImportOpen(false)} onDone={refresh} pushToast={pushToast} />
      )}

      {syncOpen && (
        <SyncDialog onClose={() => setSyncOpen(false)} onDone={refresh} pushToast={pushToast} />
      )}

      {wizardOpen && (
        <LibraryWizard
          initialPath={overview?.libraryRoot ?? ''}
          scanning={scanning}
          onClose={() => setWizardOpen(false)}
          onScan={scan}
          onOpenImport={() => {
            setWizardOpen(false)
            setImportOpen(true)
          }}
          onOpenSync={() => {
            setWizardOpen(false)
            setSyncOpen(true)
          }}
          pushToast={pushToast}
        />
      )}

      {toast && (
        <div className={`toast ${toast.kind}`} key={toast.id}>
          {toast.message}
        </div>
      )}
    </div>
  )
}
