import { useEffect, useMemo, useState } from 'react'
import api from '../api'
import { VideoTile } from '../components/VideoTile'
import { bytesLabel, durationLabel } from '../util'
import type { SearchItem, SearchResult, SearchSort, ShotPatch } from '../types'

interface SearchProps {
  query: string
  refreshKey: string
  onOpenShot: (id: number) => void
  onOpenVideo: (id: number) => void
  onChanged: () => void
  pushToast: (message: string, kind?: 'info' | 'error' | 'ok') => void
}

const CATEGORIES = [
  { key: 'all', label: '全部' },
  { key: 'deep_sky', label: '深空' },
  { key: 'nightscape', label: '星野' }
] as const

const KINDS = [
  { key: 'all', label: '全部' },
  { key: 'photo', label: '照片' },
  { key: 'video', label: '视频' }
] as const

const SUBTYPES = ['全部', '银河', '星轨', '延时', '其他']

const VERSIONS = [
  { key: 'all', label: '全部' },
  { key: 'final', label: '最终版' },
  { key: 'other', label: '普通版' }
] as const

const SORTS: Array<{ key: SearchSort; label: string }> = [
  { key: 'date', label: '日期' },
  { key: 'rating', label: '评级' },
  { key: 'exposure', label: '曝光' },
  { key: 'bytes', label: '文件大小' }
]

function basename(name: string) {
  return name.replace(/\.[^.]+$/, '')
}

function metricLabel(item: SearchItem) {
  if (item.kind === 'video') return item.durationS ? durationLabel(item.durationS) : '—'
  return item.exposureS ? durationLabel(item.exposureS) : '—'
}

export function Search({ query, refreshKey, onOpenShot, onOpenVideo, onChanged, pushToast }: SearchProps) {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]['key']>('all')
  const [subType, setSubType] = useState('全部')
  const [kind, setKind] = useState<(typeof KINDS)[number]['key']>('all')
  const [rating, setRating] = useState(0)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [targetId, setTargetId] = useState(0)
  const [rigId, setRigId] = useState(0)
  const [versionState, setVersionState] = useState<(typeof VERSIONS)[number]['key']>('all')
  const [sort, setSort] = useState<SearchSort>('date')
  const [order, setOrder] = useState<'desc' | 'asc'>('desc')
  const [view, setView] = useState<'grid' | 'table'>('grid')
  const [data, setData] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [notes, setNotes] = useState('')
  const [batchBusy, setBatchBusy] = useState(false)
  const [targets, setTargets] = useState<Array<{ id: number; title: string }>>([])
  const [rigs, setRigs] = useState<Array<{ id: number; name: string }>>([])

  useEffect(() => {
    let alive = true
    setLoading(true)
    const timer = window.setTimeout(() => {
      api
        .search({
          q: query,
          category,
          subType: subType === '全部' ? '' : subType,
          kind,
          rating,
          from,
          to,
          targetId,
          rigId,
          versionState,
          sort,
          order
        })
        .then((res) => {
          if (alive) setData(res)
        })
        .catch(() => {
          if (alive) setData(null)
        })
        .finally(() => {
          if (alive) setLoading(false)
        })
    }, 220)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [query, category, subType, kind, rating, from, to, targetId, rigId, versionState, sort, order, refreshKey])

  useEffect(() => {
    api
      .targets()
      .then((list) => setTargets(list.map((t) => ({ id: t.id, title: t.title }))))
      .catch(() => undefined)
    api
      .rigs()
      .then((res) => setRigs(res.rigs.map((r) => ({ id: r.id, name: r.name }))))
      .catch(() => undefined)
  }, [refreshKey])

  // 筛选条件变化后，旧的选择可能已经不在结果里，直接清空
  useEffect(() => {
    setSelected([])
  }, [query, category, subType, kind, rating, from, to, targetId, rigId, versionState])

  const photoIds = useMemo(
    () => (data?.items ?? []).filter((item) => item.kind === 'photo').map((item) => item.id),
    [data]
  )

  const filtered =
    category !== 'all' ||
    subType !== '全部' ||
    kind !== 'all' ||
    rating > 0 ||
    !!from ||
    !!to ||
    targetId > 0 ||
    rigId > 0 ||
    versionState !== 'all'

  const reset = () => {
    setCategory('all')
    setSubType('全部')
    setKind('all')
    setRating(0)
    setFrom('')
    setTo('')
    setTargetId(0)
    setRigId(0)
    setVersionState('all')
  }

  const toggle = (id: number) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const applyBatch = async (patch: ShotPatch, message: string) => {
    if (!selected.length || batchBusy) return
    setBatchBusy(true)
    try {
      const res = await api.updateShots(selected, patch)
      if (!res.ok) {
        pushToast(res.error ?? '保存失败', 'error')
        return
      }
      pushToast(`${message}（${res.updated ?? selected.length} 张）`, 'ok')
      setSelected([])
      onChanged()
    } catch (err) {
      pushToast(`保存失败：${(err as Error).message}`, 'error')
    } finally {
      setBatchBusy(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="ph-t">Search</div>
          <h3>
            检索
            <span>{query ? `“${query}”` : '全部素材'}</span>
          </h3>
        </div>
        <div className="acts">
          {loading ? (
            <span className="sf-count">检索中…</span>
          ) : data ? (
            <span className="sf-count">
              {data.photoCount} 张照片 · {data.videoCount} 段视频
            </span>
          ) : null}
          <div className="tabs">
            {(['grid', 'table'] as const).map((mode) => (
              <button
                key={mode}
                className={`tab ${view === mode ? 'on' : ''}`}
                onClick={() => setView(mode)}
                title={mode === 'grid' ? '网格视图' : '表格视图'}
              >
                {mode === 'grid' ? '网格' : '表格'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="search-filters">
        <div className="sf-group">
          <span className="sf-label">分类</span>
          <div className="tabs">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                className={`tab ${category === c.key ? 'on' : ''}`}
                onClick={() => {
                  setCategory(c.key)
                  if (c.key === 'deep_sky') setSubType('全部')
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sf-group">
          <span className="sf-label">子类</span>
          <select
            className="sf-select"
            value={subType}
            disabled={category === 'deep_sky'}
            onChange={(e) => setSubType(e.target.value)}
          >
            {SUBTYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="sf-group">
          <span className="sf-label">类型</span>
          <div className="tabs">
            {KINDS.map((k) => (
              <button key={k.key} className={`tab ${kind === k.key ? 'on' : ''}`} onClick={() => setKind(k.key)}>
                {k.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sf-group">
          <span className="sf-label">目标</span>
          <select className="sf-select" value={targetId} onChange={(e) => setTargetId(Number(e.target.value))}>
            <option value={0}>全部</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>

        <div className="sf-group">
          <span className="sf-label">器材</span>
          <select className="sf-select" value={rigId} onChange={(e) => setRigId(Number(e.target.value))}>
            <option value={0}>全部</option>
            {rigs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <div className="sf-group">
          <span className="sf-label">版本</span>
          <select
            className="sf-select"
            value={versionState}
            onChange={(e) => setVersionState(e.target.value as (typeof VERSIONS)[number]['key'])}
          >
            {VERSIONS.map((v) => (
              <option key={v.key} value={v.key}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        <div className="sf-group">
          <span className="sf-label">评分</span>
          <div className="sf-stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className={`star-btn ${n <= rating ? 'on' : ''}`}
                title={`评分 ≥ ${n} 星`}
                onClick={() => setRating(rating === n ? 0 : n)}
              >
                ★
              </button>
            ))}
            {rating > 0 && (
              <button className="mini-link" onClick={() => setRating(0)}>
                不限
              </button>
            )}
          </div>
        </div>

        <div className="sf-group">
          <span className="sf-label">日期</span>
          <input type="date" className="sf-date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="sf-dash">—</span>
          <input type="date" className="sf-date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>

        <div className="sf-group">
          <span className="sf-label">排序</span>
          <select className="sf-select" value={sort} onChange={(e) => setSort(e.target.value as SearchSort)}>
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            className="mini-link"
            title={order === 'desc' ? '当前降序，点击切换升序' : '当前升序，点击切换降序'}
            onClick={() => setOrder(order === 'desc' ? 'asc' : 'desc')}
          >
            {order === 'desc' ? '降序 ↓' : '升序 ↑'}
          </button>
        </div>

        {filtered && (
          <button className="btn ghost sm sf-reset" onClick={reset}>
            清除筛选
          </button>
        )}
      </div>

      {selected.length > 0 && (
        <div className="batch-bar">
          <span className="bb-label">已选 {selected.length} 张</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              className="star-btn"
              disabled={batchBusy}
              title={`评 ${n} 星`}
              onClick={() => applyBatch({ rating: n }, `已评 ${n} 星`)}
            >
              ★
            </button>
          ))}
          <button className="btn ghost sm" disabled={batchBusy} onClick={() => applyBatch({ rating: 0 }, '已清除评分')}>
            清除
          </button>
          <span className="bb-div" />
          <input
            className="bb-input"
            value={notes}
            placeholder="批量备注…"
            onChange={(e) => setNotes(e.target.value)}
          />
          <button
            className="btn ghost sm"
            disabled={batchBusy}
            onClick={() => applyBatch({ notes }, notes.trim() ? '已写入备注' : '已清空备注')}
          >
            应用备注
          </button>
          <span className="bb-div" />
          <button className="mini-link" disabled={batchBusy} onClick={() => setSelected(photoIds)}>
            全选
          </button>
          <button className="mini-link" disabled={batchBusy} onClick={() => setSelected([])}>
            清空
          </button>
        </div>
      )}

      {!data ? (
        <div className="empty">正在读取素材…</div>
      ) : data.items.length === 0 ? (
        <div className="empty">
          <b>没有匹配的素材</b>
          换个关键词，或放宽分类、目标、器材与日期条件。
        </div>
      ) : view === 'grid' ? (
        <div className="search-grid">
          {data.items.map((item: SearchItem) =>
            item.kind === 'photo' ? (
              <div className="sitem" key={`p-${item.id}`}>
                <button
                  className={`shot hoverable ${selected.includes(item.id) ? 'picked' : ''}`}
                  style={{ ['--ar' as string]: item.ar }}
                  onClick={() => onOpenShot(item.id)}
                  title={item.fileName}
                >
                  <img src={item.thumbUrl} alt={item.fileName} />
                  <span
                    className={`pick-dot ${selected.includes(item.id) ? 'on' : ''}`}
                    title={selected.includes(item.id) ? '取消选择' : '选中以批量编辑'}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggle(item.id)
                    }}
                  >
                    {selected.includes(item.id) ? '✓' : ''}
                  </span>
                  {item.isFinalVersion && <span className="final-chip">最终版</span>}
                  <div className="ph-cap">
                    <span>{basename(item.fileName)}</span>
                    <span>{'★'.repeat(item.rating ?? 0) || '—'}</span>
                  </div>
                </button>
                <div className="smeta">
                  <span className="sd">{item.date || '日期未知'}</span>
                  <span className="st">{item.title}</span>
                </div>
              </div>
            ) : (
              <div className="sitem" key={`v-${item.id}`}>
                <VideoTile
                  video={{
                    id: item.id,
                    fileName: item.fileName,
                    fileUrl: item.fileUrl ?? '',
                    bytes: item.bytes ?? 0,
                    durationS: item.durationS ?? 0,
                    ar: item.ar
                  }}
                  onOpen={onOpenVideo}
                />
                <div className="smeta">
                  <span className="sd">{item.date || '日期未知'}</span>
                  <span className="st">{item.title}</span>
                </div>
              </div>
            )
          )}
        </div>
      ) : (
        <div className="search-table">
          <div className="st-head">
            <span />
            <span>文件</span>
            <span>日期</span>
            <span>目标 / 标题</span>
            <span>评分</span>
            <span>曝光</span>
            <span>大小</span>
          </div>
          {data.items.map((item) => (
            <div className={`st-row ${selected.includes(item.id) ? 'picked' : ''}`} key={`${item.kind}-${item.id}`}>
              {item.kind === 'photo' ? (
                <button
                  className={`st-check ${selected.includes(item.id) ? 'on' : ''}`}
                  title={selected.includes(item.id) ? '取消选择' : '选中以批量编辑'}
                  onClick={() => toggle(item.id)}
                >
                  {selected.includes(item.id) ? '✓' : ''}
                </button>
              ) : (
                <span />
              )}
              <button
                className="st-name"
                title={item.fileName}
                onClick={() => (item.kind === 'photo' ? onOpenShot(item.id) : onOpenVideo(item.id))}
              >
                {item.fileName}
              </button>
              <span>{item.date || '—'}</span>
              <span className="st-title">{item.title}</span>
              <span className="st-stars">{'★'.repeat(item.rating ?? 0) || '—'}</span>
              <span>{metricLabel(item)}</span>
              <span>{bytesLabel(item.bytes ?? 0)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
