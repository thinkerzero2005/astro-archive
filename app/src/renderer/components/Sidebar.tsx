import { BrandMark, Icon } from './Icons'
import type { Overview } from '../types'

export type NavKey = 'home' | 'deepsky' | 'nightscape' | 'night' | 'stats' | 'calibration' | 'settings'

interface SidebarProps {
  active: NavKey | null
  overview: Overview | null
  onNavigate: (key: NavKey) => void
  onOpenLibrary: () => void
  onScan: () => void
  scanning: boolean
}

export function Sidebar({ active, overview, onNavigate, onOpenLibrary, onScan, scanning }: SidebarProps) {
  const stats = overview?.stats
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="mark">
          <BrandMark />
        </div>
        <div className="name">
          星空档案馆<small>ASTRO ARCHIVE</small>
        </div>
      </div>

      <div className="nav-label">浏览</div>
      <button className={`navi ${active === 'home' ? 'on' : ''}`} onClick={() => onNavigate('home')}>
        <Icon name="home" />
        首页
      </button>
      <button className={`navi ${active === 'deepsky' ? 'on' : ''}`} onClick={() => onNavigate('deepsky')}>
        <Icon name="deepsky" />
        深空 <span className="cnt">{stats?.targets ?? 0}</span>
      </button>
      <button className={`navi ${active === 'nightscape' ? 'on' : ''}`} onClick={() => onNavigate('nightscape')}>
        <Icon name="nightscape" />
        星野 <span className="cnt">{stats?.nightscapeWorks ?? 0}</span>
      </button>
      <button className={`navi ${active === 'night' ? 'on' : ''}`} onClick={() => onNavigate('night')}>
        <Icon name="night" />
        夜次 <span className="cnt">{stats?.nights ?? 0}</span>
      </button>
      <button className={`navi ${active === 'stats' ? 'on' : ''}`} onClick={() => onNavigate('stats')}>
        <Icon name="history" />
        统计与历史
      </button>

      <div className="nav-label" style={{ paddingTop: 16 }}>
        管理
      </div>
      <button className={`navi ${active === 'calibration' ? 'on' : ''}`} onClick={() => onNavigate('calibration')}>
        <Icon name="star" />
        校准场
      </button>
      <button className="navi" onClick={onScan} disabled={scanning}>
        <Icon name="scan" />
        重新扫描 <span className={`dot ${scanning ? 'warn' : ''}`} />
      </button>
      <button className="navi" onClick={onOpenLibrary}>
        <Icon name="folder" />
        打开素材库
      </button>
      <button className={`navi ${active === 'settings' ? 'on' : ''}`} onClick={() => onNavigate('settings')}>
        <Icon name="settings" />
        设置
      </button>

      <div className="side-foot">
        <button className="device" onClick={onOpenLibrary} title={overview?.libraryRoot ?? ''}>
          <span className="led" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>素材库已连接</b>
            <span className="device-path">{overview?.libraryRoot ?? '读取中…'}</span>
            <div className="bar">
              <i />
            </div>
          </div>
        </button>
      </div>
    </aside>
  )
}
