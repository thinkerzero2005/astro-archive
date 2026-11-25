import { useEffect, useMemo, useState } from 'react'
import type { TargetShot } from '../types'

interface VersionCompareProps {
  shots: TargetShot[]
  onClose: () => void
}

export function VersionCompare({ shots, onClose }: VersionCompareProps) {
  const items = useMemo(() => shots.slice(0, 3), [shots])
  const [mode, setMode] = useState<'side' | 'flicker'>('side')
  const [active, setActive] = useState(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === ' ' && mode === 'flicker') {
        e.preventDefault()
        setActive((n) => (n + 1) % Math.min(2, items.length))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items.length, mode, onClose])

  useEffect(() => {
    if (mode !== 'flicker' || items.length < 2) return
    const timer = window.setInterval(() => setActive((n) => (n + 1) % 2), 900)
    return () => window.clearInterval(timer)
  }, [mode, items.length])

  const label = (shot: TargetShot) => shot.versionName || `v${shot.versionNo}`

  return (
    <div className="modal-mask compare-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="compare" role="dialog" aria-modal>
        <div className="compare-head">
          <div>
            <b>版本对比</b>
            <span>{items.map(label).join(' / ')}</span>
          </div>
          <div className="compare-tools">
            <button className={`chip ${mode === 'side' ? 'on' : ''}`} onClick={() => setMode('side')}>
              并排
            </button>
            <button
              className={`chip ${mode === 'flicker' ? 'on' : ''}`}
              disabled={items.length < 2}
              onClick={() => setMode('flicker')}
            >
              闪烁
            </button>
            <button className="btn ghost sm" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>

        {mode === 'side' ? (
          <div className={`compare-grid n${items.length}`}>
            {items.map((shot) => (
              <figure key={shot.id} className={shot.isFinalVersion ? 'final' : ''}>
                <img src={shot.fullUrl} alt={shot.fileName} />
                <figcaption>
                  <b>{label(shot)}</b>
                  {shot.isFinalVersion && <span className="vm-final">最终版</span>}
                  {shot.versionTags.length > 0 && <em>{shot.versionTags.join(' · ')}</em>}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="compare-flicker">
            <img src={items[active % Math.min(2, items.length)].fullUrl} alt={items[active % Math.min(2, items.length)].fileName} />
            <div className="flicker-bar">
              {items.slice(0, 2).map((shot, i) => (
                <button
                  key={shot.id}
                  className={`chip ${i === active % 2 ? 'on' : ''}`}
                  onClick={() => setActive(i)}
                >
                  {label(shot)}
                </button>
              ))}
              <span className="flicker-hint">每 0.9 秒自动切换 · 空格键手动切换</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
