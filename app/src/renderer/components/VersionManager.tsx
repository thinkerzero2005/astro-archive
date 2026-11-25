import { useEffect, useState } from 'react'
import api from '../api'
import type { TargetShot } from '../types'

const TAG_PRESETS = ['16:9 裁剪', '强化 OIII', '重做去噪', '重新调色', 'HOO 合成', 'RGB 合成', '裁剪重构图', 'PI 处理']

interface VersionManagerProps {
  targetTitle: string
  shots: TargetShot[]
  nights: Array<{ nightId: number; date: string }>
  initialShotId?: number
  busy: boolean
  onBusy: (value: boolean) => void
  onClose: () => void
  onChanged: () => void
  pushToast: (message: string, kind?: 'info' | 'error' | 'ok') => void
}

export function VersionManager({
  targetTitle,
  shots,
  nights,
  initialShotId,
  busy,
  onBusy,
  onClose,
  onChanged,
  pushToast
}: VersionManagerProps) {
  const [selectedId, setSelectedId] = useState(initialShotId ?? shots[0]?.id ?? 0)
  const selected = shots.find((s) => s.id === selectedId) ?? shots[0]

  const [name, setName] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [software, setSoftware] = useState('')
  const [processedAt, setProcessedAt] = useState('')
  const [note, setNote] = useState('')
  const [nightIds, setNightIds] = useState<number[]>([])
  const [final, setFinal] = useState(false)

  useEffect(() => {
    if (!selected) return
    setName(selected.versionName)
    setTags(selected.versionTags)
    setSoftware(selected.software)
    setProcessedAt(selected.processedAt)
    setNote(selected.versionNote)
    setNightIds(selected.sourceNightIds)
    setFinal(selected.isFinalVersion)
  }, [selected])

  const run = async (shotId: number, patch: Parameters<typeof api.updateVersion>[1], message: string) => {
    if (busy) return false
    onBusy(true)
    try {
      const res = await api.updateVersion(shotId, patch)
      if (!res.ok) {
        pushToast(res.error ?? '保存失败', 'error')
        return false
      }
      pushToast(message, 'ok')
      onChanged()
      return true
    } finally {
      onBusy(false)
    }
  }

  const toggleTag = (tag: string) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
  }

  const toggleNight = (id: number) => {
    setNightIds((prev) => (prev.includes(id) ? prev.filter((n) => n !== id) : [...prev, id]))
  }

  const save = () =>
    run(
      selected.id,
      {
        versionName: name,
        tags,
        software,
        processedAt,
        note,
        nightIds,
        final
      },
      '版本信息已保存'
    )

  const move = (shotId: number, direction: 'up' | 'down') =>
    run(shotId, { move: direction }, direction === 'up' ? '已上移' : '已下移')

  if (!selected) return null
  const index = shots.findIndex((s) => s.id === selected.id)

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal version-modal" role="dialog" aria-modal>
        <div className="modal-head">
          <b>版本管理 · {targetTitle}</b>
          <span>版本差异、最终版与来源夜次；同组自动合并，重新扫描不会覆盖手工值。</span>
        </div>

        <div className="vm-body">
          <div className="vm-list">
            {shots.map((s) => (
              <div
                key={s.id}
                className={`vm-item ${s.id === selected.id ? 'on' : ''}`}
                onClick={() => setSelectedId(s.id)}
              >
                <img src={s.thumbUrl} alt={s.fileName} />
                <div className="vm-item-main">
                  <b>
                    v{s.versionNo}
                    {s.versionName && <em>{s.versionName}</em>}
                  </b>
                  <span>{s.versionTags.length ? s.versionTags.join(' · ') : s.fileName}</span>
                </div>
                {s.isFinalVersion && <span className="vm-final">最终版</span>}
                <div className="vm-order">
                  <button
                    className="icon-btn"
                    title="上移"
                    disabled={busy || s.isFinalVersion || shots.indexOf(s) === 0}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedId(s.id)
                      move(s.id, 'up')
                    }}
                  >
                    ↑
                  </button>
                  <button
                    className="icon-btn"
                    title="下移"
                    disabled={busy || s.isFinalVersion || shots.indexOf(s) === shots.length - 1}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedId(s.id)
                      move(s.id, 'down')
                    }}
                  >
                    ↓
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="vm-form">
            <div className="vm-preview">
              <img src={selected.thumbUrl} alt={selected.fileName} />
              <span>
                v{selected.versionNo} · 第 {index + 1} / {shots.length} 版
              </span>
            </div>

            <label className="mg-field">
              <span>版本名</span>
              <input
                className="input"
                value={name}
                placeholder={`留空显示 v${selected.versionNo}`}
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <div className="mg-field">
              <span>差异标签</span>
              <div className="tag-picks">
                {TAG_PRESETS.map((tag) => (
                  <button
                    key={tag}
                    className={`chip ${tags.includes(tag) ? 'on' : ''}`}
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            <div className="vm-row">
              <label className="mg-field">
                <span>处理日期</span>
                <input className="input" type="date" value={processedAt} onChange={(e) => setProcessedAt(e.target.value)} />
              </label>
              <label className="mg-field">
                <span>使用软件</span>
                <input
                  className="input"
                  value={software}
                  placeholder="如 PixInsight / Siril"
                  onChange={(e) => setSoftware(e.target.value)}
                />
              </label>
            </div>

            <label className="mg-field">
              <span>差异备注</span>
              <textarea className="input area" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>

            {nights.length > 0 && (
              <div className="mg-field">
                <span>来源拍摄组</span>
                <div className="night-picks">
                  {nights.map((n) => (
                    <label key={n.nightId} className={`night-pick ${nightIds.includes(n.nightId) ? 'on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={nightIds.includes(n.nightId)}
                        onChange={() => toggleNight(n.nightId)}
                      />
                      {n.date}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <label className="final-check">
              <input type="checkbox" checked={final} onChange={(e) => setFinal(e.target.checked)} />
              设为最终版（同组仅一个，旧最终版会自动降级）
            </label>
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            关闭
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? '保存中…' : '保存版本'}
          </button>
        </div>
      </div>
    </div>
  )
}
