import { useEffect, useRef } from 'react'
import { Icon } from './Icons'
import { lastScanLabel } from '../util'

interface TopbarProps {
  crumb: React.ReactNode
  search: string
  onSearch: (value: string) => void
  onSearchSubmit: () => void
  onScan: () => void
  scanning: boolean
  progress: number
  scanStage?: 'parse' | 'thumb' | 'watermark'
  onCancelScan: () => void
  lastScanAt: string
  onUndo: () => void
  onImport: () => void
  onSync: () => void
  pendingInbox: number
}

const STAGE_LABEL: Record<'parse' | 'thumb' | 'watermark', string> = {
  parse: '解析文件',
  thumb: '生成缩略图',
  watermark: '水印识别'
}

export function Topbar({
  crumb,
  search,
  onSearch,
  onSearchSubmit,
  onScan,
  scanning,
  progress,
  scanStage,
  onCancelScan,
  lastScanAt,
  onUndo,
  onImport,
  onSync,
  pendingInbox
}: TopbarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="topbar">
      <div className="crumb">{crumb}</div>
      <div className="tb-right">
        <div className="search">
          <Icon name="search" />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSearchSubmit()
              if (e.key === 'Escape') onSearch('')
            }}
            placeholder="搜索目标 / 文件名 / 夜次"
            spellCheck={false}
          />
          <kbd>Ctrl F</kbd>
        </div>
        <span className="topbar-status">
          {scanning ? (scanStage ? `扫描中 · ${STAGE_LABEL[scanStage]}` : '扫描中…') : lastScanLabel(lastScanAt)}
        </span>
        {scanning && (
          <button className="btn ghost sm" onClick={onCancelScan} title="停止当前扫描，已写入的记录会保留">
            取消
          </button>
        )}
        <button className="btn ghost sm" onClick={onImport} title="导入 _收件箱 中的新素材">
          <Icon name="inbox" size={12} />
          导入
          {pendingInbox > 0 && <span className="tb-badge">{pendingInbox}</span>}
        </button>
        <button className="btn ghost sm" onClick={onSync} title="从 Dwarf 设备增量同步素材">
          <Icon name="scan" size={12} />
          同步
        </button>
        <button className="btn ghost sm" onClick={onUndo} title="撤销最近一次导入、同步或文件夹重命名">
          <Icon name="history" size={12} />
          撤销
        </button>
        <button className="btn primary sm" onClick={onScan} disabled={scanning}>
          <Icon name="sync" size={12} />
          {scanning ? '扫描中' : '重新扫描'}
        </button>
      </div>
      {scanning && (
        <div className="scan-bar">
          <i style={{ width: `${Math.max(4, Math.min(100, progress))}%` }} />
        </div>
      )}
    </div>
  )
}
