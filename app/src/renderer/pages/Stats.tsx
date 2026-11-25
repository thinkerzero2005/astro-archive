import { useEffect, useMemo, useState } from 'react'
import api from '../api'
import { Icon } from '../components/Icons'
import { ReviewDialog } from '../components/ReviewDialog'
import { bytesLabel, deviceLabel, durationLabel } from '../util'
import type { HistoryItem, StatsData } from '../types'

interface StatsProps {
  refreshKey: string
  onOpenTarget: (id: number) => void
  pushToast: (message: string, kind?: 'info' | 'error' | 'ok') => void
}

type Filter = 'all' | 'rename' | 'import' | 'undo'

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'rename', label: '改名' },
  { key: 'import', label: '导入' },
  { key: 'undo', label: '撤销' }
]

function timeLabel(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(5, 16).replace('T', ' ')
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function entityLabel(entity: string) {
  if (entity === 'target') return '深空目标'
  if (entity === 'night') return '星野夜次'
  if (entity === 'inbox') return '收件箱'
  return entity
}

function HistoryRow({ item }: { item: HistoryItem }) {
  const status = item.undone ? '已撤销' : item.undoable ? '可撤销' : ''
  return (
    <div className="hist-row">
      <span className="ht">{timeLabel(item.at)}</span>
      <span className={`ha ${item.kind}`}>{item.title}</span>
      <span className="he">{entityLabel(item.entity)}</span>
      <span className="hp" title={item.path}>
        {item.path || '—'}
      </span>
      <span className="hn">
        {item.note}
        {status && <em className={item.undone ? 'off' : ''}>{status}</em>}
      </span>
    </div>
  )
}

export function Stats({ refreshKey, onOpenTarget, pushToast }: StatsProps) {
  const [data, setData] = useState<StatsData | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(50)
  const [exporting, setExporting] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [localRev, setLocalRev] = useState(0)

  useEffect(() => {
    api
      .stats()
      .then((d) => setData(d))
      .catch(() => setData(null))
  }, [refreshKey, localRev])

  useEffect(() => {
    setLimit(50)
  }, [filter, query])

  const filtered = useMemo(() => {
    const items = data?.history.items ?? []
    const kw = query.trim().toLowerCase()
    return items.filter((it) => {
      if (filter !== 'all' && it.kind !== filter) return false
      if (!kw) return true
      return `${it.title} ${it.path} ${it.note} ${entityLabel(it.entity)}`.toLowerCase().includes(kw)
    })
  }, [data, filter, query])

  const exportCsv = async () => {
    if (!filtered.length || exporting) return
    setExporting(true)
    try {
      const res = await api.exportHistory(
        filtered.map((it) => ({
          time: timeLabel(it.at),
          action: it.title,
          entity: entityLabel(it.entity),
          path: it.path,
          note: it.note
        }))
      )
      if (res.ok) pushToast(`已导出 ${filtered.length} 条记录`, 'ok')
      else if (!res.canceled) pushToast(res.error ?? '导出失败', 'error')
    } finally {
      setExporting(false)
    }
  }

  if (!data) {
    return (
      <div className="empty">
        <b>正在统计档案…</b>
      </div>
    )
  }

  const s = data.summary
  const maxFinals = Math.max(1, ...data.months.map((m) => m.finals))
  const maxTarget = Math.max(1, ...data.topTargets.map((t) => t.finals))
  const maxDevice = Math.max(1, ...data.devices.map((d) => d.count))
  const nsTypes = (['银河', '星轨', '延时', '其他'] as const).filter((t) => (s.byType[t] ?? 0) > 0)
  const nsMax = Math.max(1, ...nsTypes.map((t) => s.byType[t] ?? 0))

  return (
    <>
      <div className="page-head">
        <div>
          <div className="ph-t">Archive</div>
          <h3>
            统计与历史<span>拍摄总量、曝光分布与每次文件操作</span>
          </h3>
        </div>
        <div className="acts">
          <span className="pill mute">
            <i />
            历史记录 {data.history.total} 条
          </span>
        </div>
      </div>

      <div className="stats six">
        <div className="stat">
          <div className="k">深空目标</div>
          <div className="v">{s.targets}</div>
          <div className="d">{s.deepFinals} 张成片</div>
        </div>
        <div className="stat">
          <div className="k">拍摄夜次</div>
          <div className="v">{s.nights}</div>
          <div className="d">
            深空 {s.deepNights} · 星野 {s.nsNights}
          </div>
        </div>
        <div className="stat">
          <div className="k">深空累计曝光</div>
          <div className="v">
            {s.exposureS > 0 ? (s.exposureS / 3600).toFixed(1) : '—'}
            {s.exposureS > 0 && <small>h</small>}
          </div>
          <div className="d">
            按目标最高累计
            {s.watermarkFinals > 0 ? ` · 水印补全 ${s.watermarkFinals} 张` : ''}
            {s.pendingReview > 0 && (
              <button className="stat-link" onClick={() => setReviewOpen(true)}>
                {` · 待确认 ${s.pendingReview} 张 · 去核对`}
              </button>
            )}
          </div>
        </div>
        <div className="stat">
          <div className="k">星野作品</div>
          <div className="v">{s.nsFinals}</div>
          <div className="d">
            银河 {s.byType['银河'] ?? 0} · 星轨 {s.byType['星轨'] ?? 0} · 延时 {s.byType['延时'] ?? 0}
          </div>
        </div>
        <div className="stat">
          <div className="k">RAW 原始帧</div>
          <div className="v">{s.rawCount}</div>
          <div className="d">素材共 {s.assetCount} 个文件</div>
        </div>
        <div className="stat">
          <div className="k">归档体积</div>
          <div className="v">{bytesLabel(s.totalBytes)}</div>
          <div className="d">成片 + RAW + 工程文件</div>
        </div>
      </div>

      <div className="stats-panels">
        <div className="block">
          <div className="block-head">
            <div className="t">
              最近 12 个月 <em>成片数 · 夜次数</em>
            </div>
          </div>
          {data.months.some((m) => m.finals > 0 || m.nights > 0) ? (
            <div className="monthbars">
              {data.months.map((m) => (
                <div
                  className={`mb ${m.finals > 0 ? 'has' : ''}`}
                  key={m.month}
                  title={`${m.month} · ${m.finals} 张成片 · ${m.nights} 个夜次${
                    m.exposureS > 0 ? ` · 累计 ${durationLabel(m.exposureS)}` : ''
                  }`}
                >
                  <span className="mv">{m.finals || ''}</span>
                  <div className="bar">
                    <i style={{ height: `${m.finals > 0 ? Math.max(6, Math.round((m.finals / maxFinals) * 100)) : 0}%` }} />
                  </div>
                  <span className="mn">{m.nights || ''}</span>
                  <span className="ml">{m.label}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-line">最近 12 个月还没有拍摄记录。</div>
          )}
          <div className="month-legend">
            <span>
              <i className="lg finals" />
              成片数
            </span>
            <span>
              <i className="lg nights" />
              夜次数
            </span>
          </div>
        </div>

        <div className="block">
          <div className="block-head">
            <div className="t">
              深空目标 <em>按成片数</em>
            </div>
          </div>
          {data.topTargets.length ? (
            <div className="top-targets">
              {data.topTargets.map((t, i) => (
                <div className="tt" key={t.id}>
                  <span className="rk">{i + 1}</span>
                  {t.thumbUrl ? <img src={t.thumbUrl} alt={t.title} /> : <div className="tt-no">无</div>}
                  <div className="tt-main">
                    <button className="tt-title" onClick={() => onOpenTarget(t.id)}>
                      {t.title}
                    </button>
                    <div className="tt-bar">
                      <i style={{ width: `${Math.max(4, Math.round((t.finals / maxTarget) * 100))}%` }} />
                    </div>
                  </div>
                  <span className="tt-meta">
                    {t.finals} 张 · {t.nights} 夜
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-line">还没有深空成片。</div>
          )}
        </div>

        <div className="block">
          <div className="block-head">
            <div className="t">
              星野与设备 <em>作品构成</em>
            </div>
          </div>
          {nsTypes.length ? (
            <div className="dist">
              {nsTypes.map((t) => (
                <div className="dist-row" key={t}>
                  <span className="dn">{t}</span>
                  <div className="db">
                    <i style={{ width: `${Math.max(4, Math.round(((s.byType[t] ?? 0) / nsMax) * 100))}%` }} />
                  </div>
                  <b>{s.byType[t] ?? 0}</b>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-line">还没有星野作品。</div>
          )}
          <div className="dist-head">设备分布</div>
          {data.devices.length ? (
            <div className="dist">
              {data.devices.map((d) => (
                <div className="dist-row" key={d.device}>
                  <span className="dn">{deviceLabel(d.device === '未记录' ? null : d.device)}</span>
                  <div className="db">
                    <i style={{ width: `${Math.max(4, Math.round((d.count / maxDevice) * 100))}%` }} />
                  </div>
                  <b>{d.count}</b>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-line">还没有成片。</div>
          )}
        </div>
      </div>

      <div className="block hist-block">
        <div className="hist-head">
          <div className="t">
            历史记录 <em>只读 · 最近 {data.history.items.length} 条</em>
          </div>
          <div className="hist-tools">
            {FILTERS.map((f) => (
              <button
                className={`chip ${filter === f.key ? 'on' : ''}`}
                key={f.key}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
            <div className="search hist-search">
              <Icon name="search" size={14} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索路径或备注" />
            </div>
            <button className="btn ghost sm" onClick={exportCsv} disabled={!filtered.length || exporting}>
              导出 CSV
            </button>
          </div>
        </div>

        <div className="hist-table">
          <div className="hist-row head">
            <span>时间</span>
            <span>操作</span>
            <span>对象</span>
            <span>路径</span>
            <span>备注 / 状态</span>
          </div>
          {filtered.length ? (
            filtered.slice(0, limit).map((it) => <HistoryRow item={it} key={it.id} />)
          ) : (
            <div className="hist-empty">
              {data.history.total === 0 ? '还没有文件操作记录。导入文件或改名后会记录在这里。' : '没有符合筛选条件的记录。'}
            </div>
          )}
        </div>

        <div className="hist-foot">
          <span>
            共 {data.history.total} 条 · 当前筛选 <b>{filtered.length}</b> 条
          </span>
          {filtered.length > limit && (
            <button className="btn ghost sm" onClick={() => setLimit((n) => n + 50)}>
              显示更多
            </button>
          )}
        </div>
      </div>

      {reviewOpen && (
        <ReviewDialog
          onClose={() => setReviewOpen(false)}
          onChanged={() => setLocalRev((n) => n + 1)}
          pushToast={pushToast}
        />
      )}
    </>
  )
}
