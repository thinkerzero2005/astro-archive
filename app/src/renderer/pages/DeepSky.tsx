import { useEffect, useMemo, useState } from 'react'
import api from '../api'
import { Icon } from '../components/Icons'
import { hoursLabel } from '../util'
import type { TargetCard } from '../types'

interface DeepSkyProps {
  query: string
  refreshKey: string
  onOpenTarget: (id: number) => void
  onScan: () => void
}

export function DeepSky({ query, refreshKey, onOpenTarget, onScan }: DeepSkyProps) {
  const [targets, setTargets] = useState<TargetCard[] | null>(null)

  useEffect(() => {
    let alive = true
    api
      .targets()
      .then((rows) => {
        if (alive) setTargets(rows)
      })
      .catch(() => {
        if (alive) setTargets([])
      })
    return () => {
      alive = false
    }
  }, [refreshKey])

  const filtered = useMemo(() => {
    if (!targets) return []
    const q = query.trim().toLowerCase()
    if (!q) return targets
    return targets.filter((t) => `${t.catalogId} ${t.nameCn} ${t.nameEn ?? ''}`.toLowerCase().includes(q))
  }, [targets, query])

  const totals = useMemo(() => {
    const rows = targets ?? []
    return {
      targets: rows.length,
      nights: rows.reduce((s, t) => s + t.nights, 0),
      finals: rows.reduce((s, t) => s + t.finals, 0),
      exposureS: rows.reduce((s, t) => s + t.exposureS, 0)
    }
  }, [targets])

  return (
    <>
      <div className="page-head">
        <div>
          <div className="ph-t">Deep Sky</div>
          <h3>
            深空目标
            <span>
              {totals.targets} 个目标 · {totals.nights} 个夜次 · {totals.finals} 张成片
            </span>
          </h3>
        </div>
        <div className="acts">
          <span className="pill cyan">
            <i />
            累计 {hoursLabel(totals.exposureS)}
          </span>
        </div>
      </div>

      {targets === null ? (
        <div className="empty">正在读取素材库…</div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <b>{query ? '没有匹配的目标' : '素材库还没有深空目标'}</b>
          {query ? '换个编号或中文名试试。' : '按 01_深空/<编号_中文名>/成片 的结构放入文件后重新扫描。'}
          <div className="empty-acts">
            <button className="btn primary sm" onClick={onScan}>
              <Icon name="scan" size={12} />
              重新扫描
            </button>
          </div>
        </div>
      ) : (
        <div className="target-grid deep-grid">
          {filtered.map((t) => (
            <button className="tcard" key={t.id} onClick={() => onOpenTarget(t.id)}>
              {t.thumbUrl ? <img className="img" src={t.thumbUrl} alt={t.title} /> : <div className="img no-thumb">暂无成片</div>}
              <div className="ov" />
              {t.pinned === 1 && <div className="star">★</div>}
              {t.isNew && <div className="new">NEW</div>}
              <div className="txt">
                <b>{t.title}</b>
                <small>
                  {t.nights} 夜次 · {t.finals} 张成片 · {hoursLabel(t.exposureS)}
                </small>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  )
}
