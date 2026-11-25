import { useCallback, useEffect, useState } from 'react'
import api from '../api'
import { Icon } from './Icons'
import type { PendingReview } from '../types'

interface ReviewDialogProps {
  onClose: () => void
  onChanged: () => void
  pushToast: (message: string, kind?: 'info' | 'error' | 'ok') => void
}

type Draft = { h: string; m: string }

function splitExposure(seconds: number): Draft {
  const total = Math.max(0, Math.round(seconds || 0))
  return { h: String(Math.floor(total / 3600)), m: String(Math.floor((total % 3600) / 60)) }
}

const SOURCE_LABEL: Record<string, string> = {
  watermark: '水印总曝光',
  manual: '手工填写',
  frames: '按原始帧',
  exif: '按 EXIF'
}

/** 待确认成片集中核对：查看水印原文、修正总曝光、标记已核对 */
export function ReviewDialog({ onClose, onChanged, pushToast }: ReviewDialogProps) {
  const [rows, setRows] = useState<PendingReview[]>([])
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  const [tab, setTab] = useState<'pending' | 'manual'>('pending')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | 'all' | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.pendingReviews(tab)
      setRows(list)
      const next: Record<number, Draft> = {}
      for (const row of list) next[row.id] = splitExposure(row.totalExposureS)
      setDrafts(next)
    } catch (err) {
      pushToast(`读取成片列表失败：${(err as Error).message}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [pushToast, tab])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const secondsOf = (row: PendingReview) => {
    const draft = drafts[row.id] ?? { h: '0', m: '0' }
    return Math.max(0, (Number(draft.h) || 0) * 3600 + (Number(draft.m) || 0) * 60)
  }

  const updateDraft = (id: number, part: keyof Draft, value: string) => {
    const clean = value.replace(/[^\d]/g, '').slice(0, 4)
    setDrafts((prev) => {
      const draft = prev[id] ?? { h: '0', m: '0' }
      const next = { ...draft, [part]: clean }
      if (part === 'm' && Number(next.m) > 59) next.m = '59'
      if (part === 'h' && Number(next.h) > 240) next.h = '240'
      return { ...prev, [id]: next }
    })
  }

  const removeRow = (id: number) => {
    setRows((prev) => prev.filter((row) => row.id !== id))
    setDrafts((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const saveOne = async (row: PendingReview) => {
    setBusy(row.id)
    try {
      const seconds = secondsOf(row)
      const dirty = seconds !== row.totalExposureS
      const result = await api.resolveReviews(
        [{ id: row.id, ...(dirty ? { totalExposureS: seconds } : {}) }]
      )
      if (!result.ok) {
        pushToast(result.error ?? '保存失败', 'error')
        return
      }
      removeRow(row.id)
      onChanged()
      pushToast(dirty ? `已核对并更新曝光 · ${row.fileName}` : `已核对 · ${row.fileName}`, 'ok')
    } finally {
      setBusy(null)
    }
  }

  const markAll = async () => {
    if (!rows.length) return
    setBusy('all')
    try {
      const result = await api.resolveReviews(
        rows.map((row) => ({ id: row.id }))
      )
      if (!result.ok) {
        pushToast(result.error ?? '保存失败', 'error')
        return
      }
      setRows([])
      onChanged()
      pushToast(`已核对 ${result.updated ?? 0} 张（未改动曝光）`, 'ok')
    } finally {
      setBusy(null)
    }
  }

  const reveal = (row: PendingReview) => {
    api.revealShot(row.id).then((res) => {
      if (!res.ok) pushToast(res.error ?? '无法定位文件', 'error')
    })
  }

  const resetOne = async (row: PendingReview) => {
    setBusy(row.id)
    try {
      const result = await api.resetReviews([row.id])
      if (!result.ok) {
        pushToast(result.error ?? '恢复失败', 'error')
        return
      }
      removeRow(row.id)
      onChanged()
      pushToast(`已恢复自动识别值 · ${row.fileName}`, 'ok')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      className="modal-mask"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="modal review-modal" role="dialog" aria-modal>
        <div className="import-head">
          <div className="import-title">
            <b>成片核对</b>
            <span>
              {loading
                ? '正在读取…'
                : rows.length === 0
                  ? tab === 'pending'
                    ? '全部核对完成'
                    : '还没有人工核对的成片'
                  : tab === 'pending'
                    ? `${rows.length} 张需要人工核对曝光或水印识别结果`
                    : `${rows.length} 张已人工核对，可恢复为自动识别值`}
            </span>
          </div>
          <div className="import-head-acts">
            <button className="btn ghost sm" onClick={() => void load()} disabled={loading || !!busy}>
              <Icon name="sync" size={12} />
              刷新
            </button>
            <button className="icon-btn" onClick={onClose} disabled={!!busy} title="关闭">
              <Icon name="close" size={14} />
            </button>
          </div>
        </div>

        <div className="review-tabs">
          <button
            className={`review-tab${tab === 'pending' ? ' active' : ''}`}
            onClick={() => setTab('pending')}
            disabled={!!busy}
          >
            待确认
          </button>
          <button
            className={`review-tab${tab === 'manual' ? ' active' : ''}`}
            onClick={() => setTab('manual')}
            disabled={!!busy}
          >
            已核对
          </button>
        </div>

        {rows.length > 0 && tab === 'pending' && (
          <div className="import-toolbar">
            <span className="import-count">共 {rows.length} 张</span>
            <button className="btn ghost sm" onClick={() => void markAll()} disabled={!!busy}>
              全部标记已核对
            </button>
            <span className="import-hint">「全部」不改动曝光；修正曝光请用行内「保存并核对」</span>
          </div>
        )}

        <div className="review-list">
          {loading ? (
            <div className="import-empty">正在读取成片…</div>
          ) : rows.length === 0 ? (
            <div className="import-empty">
              {tab === 'pending'
                ? '没有待确认的成片。水印识别缺字段或置信度偏低时会出现在这里。'
                : '还没有人工核对过的成片。在「待确认」里保存后，记录会移到这里。'}
            </div>
          ) : (
            rows.map((row) => {
              const draft = drafts[row.id] ?? { h: '0', m: '0' }
              const dirty = secondsOf(row) !== row.totalExposureS
              return (
                <div className="review-row" key={row.id}>
                  <img className="review-thumb" src={row.thumbUrl ?? row.fileUrl} alt={row.fileName} loading="lazy" />
                  <div className="review-info">
                    <div className="review-title">
                      <b>{row.title}</b>
                      <span>{row.nightDate ?? '日期未知'}{row.location ? ` · ${row.location}` : ''}</span>
                    </div>
                    <div className="review-file" title={row.fileName}>
                      {row.fileName}
                    </div>
                    <div className="review-wm" title={row.watermarkText ?? ''}>
                      {row.watermarkText?.trim() || '未识别到水印原文'}
                    </div>
                    <div className="review-exp">
                      <input
                        className="input review-num"
                        inputMode="numeric"
                        value={draft.h}
                        onChange={(e) => updateDraft(row.id, 'h', e.target.value)}
                        aria-label="曝光小时"
                        disabled={tab === 'manual'}
                      />
                      <span>小时</span>
                      <input
                        className="input review-num"
                        inputMode="numeric"
                        value={draft.m}
                        onChange={(e) => updateDraft(row.id, 'm', e.target.value)}
                        aria-label="曝光分钟"
                        disabled={tab === 'manual'}
                      />
                      <span>分</span>
                      <em>{SOURCE_LABEL[row.exposureSource ?? ''] ?? '来源未知'}</em>
                    </div>
                  </div>
                  <div className="review-acts">
                    {tab === 'pending' ? (
                      <button
                        className={`btn sm ${dirty ? '' : 'ghost'}`}
                        onClick={() => void saveOne(row)}
                        disabled={!!busy}
                      >
                        {busy === row.id ? '保存中…' : dirty ? '保存并核对' : '标记已核对'}
                      </button>
                    ) : (
                      <button className="btn ghost sm" onClick={() => void resetOne(row)} disabled={!!busy}>
                        {busy === row.id ? '恢复中…' : '恢复自动'}
                      </button>
                    )}
                    <button className="btn ghost sm" onClick={() => reveal(row)} disabled={!!busy}>
                      定位文件
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
