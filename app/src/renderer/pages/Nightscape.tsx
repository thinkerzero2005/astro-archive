import { useEffect, useMemo, useState } from 'react'
import api from '../api'
import { EditDialog } from '../components/EditDialog'
import { Icon } from '../components/Icons'
import { VideoTile } from '../components/VideoTile'
import { VersionCompare } from '../components/VersionCompare'
import { VersionManager } from '../components/VersionManager'
import { durationLabel } from '../util'
import type { NightscapeData, TargetShot } from '../types'

interface NightscapeProps {
  type: string
  counts: Record<string, number>
  refreshKey: string
  onChangeType: (type: string) => void
  onOpenShot: (shotId: number) => void
  onOpenVideo: (videoId: number) => void
  onChanged: () => void
  pushToast: (message: string, kind?: 'info' | 'error' | 'ok') => void
}

const TYPES = ['银河', '星轨', '延时', '其他']

export function Nightscape({ type, counts, refreshKey, onChangeType, onOpenShot, onOpenVideo, onChanged, pushToast }: NightscapeProps) {
  const [data, setData] = useState<NightscapeData | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [versionNightId, setVersionNightId] = useState<number | null>(null)
  const [versionBusy, setVersionBusy] = useState(false)
  const [compareShots, setCompareShots] = useState<TargetShot[] | null>(null)

  const load = () => {
    api
      .nightscape(type)
      .then((d) => {
        setData(d)
        setSelected((prev) => (prev && d.nights.some((n) => n.id === prev) ? prev : d.nights[0]?.id ?? null))
      })
      .catch(() => setData(null))
  }

  useEffect(load, [type, refreshKey])

  useEffect(() => {
    setVersionNightId(null)
    setCompareShots(null)
  }, [type])

  const current = useMemo(() => data?.nights.find((n) => n.id === selected) ?? null, [data, selected])
  const versionNight = data?.nights.find((n) => n.id === versionNightId) ?? null
  const versionNights = (data?.nights ?? []).map((n) => ({ nightId: n.id, date: n.date }))

  const openNight = async (nightId: number) => {
    const res = await api.openNightFolder(nightId)
    if (!res.ok) pushToast(res.error ?? '打开失败', 'error')
  }

  const submitLocation = async (location: string) => {
    if (!current) return
    setBusy(true)
    try {
      const res = await api.renameNight(current.id, location)
      if (!res.ok) {
        pushToast(res.error ?? '重命名失败', 'error')
        return
      }
      setEditing(false)
      pushToast(res.renamed ? `地点已改为「${location}」，文件夹同步重命名` : '地点未变化', 'ok')
      load()
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="ph-t">Nightscape</div>
          <h3>
            星野作品
            <span>不参与深空曝光统计</span>
          </h3>
        </div>
        <div className="acts">
          <button className="btn ghost sm" onClick={() => api.openLibraryRoot()}>
            <Icon name="folder" size={12} />
            打开素材库
          </button>
        </div>
      </div>

      <div className="ns-layout">
        <div>
          <div className="list-top">
            <div className="tabs">
              {TYPES.map((t) => (
                <button className={`tab ${t === type ? 'on' : ''}`} key={t} onClick={() => onChangeType(t)}>
                  {t} <b>{counts[t] ?? 0}</b>
                </button>
              ))}
            </div>
          </div>

          {!data ? (
            <div className="empty">正在读取…</div>
          ) : data.nights.length === 0 ? (
            <div className="empty">
              <b>「{type}」还没有作品</b>
              按 02_星野/{type}/日期_地点/ 的结构放入文件后重新扫描。
            </div>
          ) : (
            data.nights.map((n) => (
              <div
                className={`work-row ${selected === n.id ? 'selected' : ''}`}
                key={n.id}
                onClick={() => setSelected(n.id)}
              >
                <div className="r1">
                  <b>{n.date}</b>
                  <span className="sep">·</span>
                  <span>{n.location}</span>
                  <span className="sep">·</span>
                  <span>{n.shots.length} 张</span>
                  {n.videos.length > 0 && (
                    <>
                      <span className="sep">·</span>
                      <span>{n.videos.length} 段视频</span>
                    </>
                  )}
                  {n.shots.length > 0 && (
                    <button
                      className="mini-link"
                      onClick={(e) => {
                        e.stopPropagation()
                        setVersionNightId(n.id)
                      }}
                    >
                      版本管理
                    </button>
                  )}
                  {n.shots.length > 1 && (
                    <button
                      className="mini-link"
                      onClick={(e) => {
                        e.stopPropagation()
                        setCompareShots(n.shots)
                      }}
                    >
                      版本对比
                    </button>
                  )}
                  {n.folderRel && (
                    <button
                      className="open-dir"
                      onClick={(e) => {
                        e.stopPropagation()
                        openNight(n.id)
                      }}
                    >
                      打开文件夹
                    </button>
                  )}
                  <span className="tagline">{durationLabel(n.exposureS)}</span>
                </div>
                <div className="gallery">
                  {n.shots.map((s) => (
                    <button
                      className="shot hoverable"
                      key={s.id}
                      style={{ ['--ar' as string]: s.ar }}
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenShot(s.id)
                      }}
                    >
                      <img src={s.thumbUrl} alt={s.fileName} />
                      <span className="ver-chip">{s.versionName || `v${s.versionNo}`}</span>
                      {s.isFinalVersion && <span className="final-chip">最终版</span>}
                      <div className="ph-cap">
                        <span>{s.fileName.replace(/\.[^.]+$/, '')}</span>
                        <span>{s.versionTags[0] ?? ('★'.repeat(s.rating) || '')}</span>
                      </div>
                    </button>
                  ))}
                  {n.videos.map((v) => (
                    <VideoTile key={`v-${v.id}`} video={v} onOpen={onOpenVideo} />
                  ))}
                  {n.shots.length === 0 && n.videos.length === 0 && (
                    <div className="empty-line">这个夜次还没有成片</div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="record">
          <div className="rh">
            <b>夜次记录</b>
            <span>{type}</span>
          </div>
          {current ? (
            <>
              <div className="rec-row">
                <span className="k">日期</span>
                <span className="v mono">{current.date}</span>
              </div>
              <div className="rec-row">
                <span className="k">地点</span>
                <span className="v">{current.location}</span>
              </div>
              <div className="rec-row">
                <span className="k">成片</span>
                <span className="v">{current.shots.length} 张</span>
              </div>
              {current.videos.length > 0 && (
                <div className="rec-row">
                  <span className="k">视频</span>
                  <span className="v">{current.videos.length} 段</span>
                </div>
              )}
              <div className="rec-row">
                <span className="k">累计曝光</span>
                <span className="v">{durationLabel(current.exposureS)}</span>
              </div>
              <div className="rec-row">
                <span className="k">文件夹</span>
                <span className="v mono ellipsis">{current.folderRel ?? '—'}</span>
              </div>
              <div className="rt">
                <button className="btn ghost sm" onClick={() => setEditing(true)}>
                  <Icon name="edit" size={12} />
                  改地点
                </button>
                <button className="btn sm" onClick={() => openNight(current.id)}>
                  <Icon name="folder" size={12} />
                  打开
                </button>
              </div>
            </>
          ) : (
            <div className="empty-line">选择一个夜次查看记录</div>
          )}
        </div>
      </div>

      {editing && current && (
        <EditDialog
          title="修改拍摄地点"
          hint="保存后文件夹按「日期_地点」自动重命名，日期保持不变。"
          label="地点"
          initial={current.location === '未标注' ? '' : current.location}
          busy={busy}
          onConfirm={submitLocation}
          onCancel={() => setEditing(false)}
        />
      )}

      {versionNight && (
        <VersionManager
          targetTitle={`${versionNight.date} · ${versionNight.location}`}
          shots={versionNight.shots}
          nights={versionNights}
          busy={versionBusy}
          onBusy={setVersionBusy}
          onClose={() => setVersionNightId(null)}
          onChanged={() => {
            load()
            onChanged()
          }}
          pushToast={pushToast}
        />
      )}

      {compareShots && <VersionCompare shots={compareShots} onClose={() => setCompareShots(null)} />}
    </>
  )
}
