import { useEffect, useRef, useState } from 'react'
import api from '../api'
import { VideoTile } from '../components/VideoTile'
import { CreateNightDialog, NightEditDialog } from '../components/NightDialog'
import { RigDialog } from '../components/RigDialog'
import { durationLabel } from '../util'
import type { NightDate, NightShot, NightsData, VideoItem } from '../types'

interface NightProps {
  date?: string
  refreshKey: string
  onOpenTarget: (id: number) => void
  onOpenShot: (id: number) => void
  onOpenVideo: (id: number) => void
  onChanged: () => void
  pushToast: (message: string, kind?: 'info' | 'error' | 'ok') => void
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const MONTH_WEEK = ['一', '二', '三', '四', '五', '六', '日']

function weekdayOf(date: string) {
  const d = new Date(`${date}T12:00:00`)
  return Number.isNaN(d.getTime()) ? '' : WEEK[d.getDay()]
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

/** 周一开头的月历格子，空位为 null */
function calendarCells(month: string): Array<{ day: number; date: string } | null> {
  const [y, m] = month.split('-').map(Number)
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7
  const days = new Date(y, m, 0).getDate()
  const cells: Array<{ day: number; date: string } | null> = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push({ day: d, date: `${month}-${pad2(d)}` })
  return cells
}

function monthLabel(month: string) {
  const [y, m] = month.split('-')
  return `${y} 年 ${Number(m)} 月`
}

function Thumbs({
  shots,
  videos = [],
  onOpenShot,
  onOpenVideo
}: {
  shots: NightShot[]
  videos?: VideoItem[]
  onOpenShot: (id: number) => void
  onOpenVideo: (id: number) => void
}) {
  return (
    <div className="thumbs">
      {shots.map((s) => (
        <button className="shot hoverable" key={s.id} style={{ ['--ar' as string]: s.ar }} onClick={() => onOpenShot(s.id)}>
          <img src={s.thumbUrl} alt={s.fileName} />
          <div className="ph-cap">
            <span>{s.fileName.replace(/\.[^.]+$/, '')}</span>
            <span>{'★'.repeat(s.rating) || ''}</span>
          </div>
        </button>
      ))}
      {videos.map((v) => (
        <VideoTile key={`v-${v.id}`} video={v} onOpen={onOpenVideo} />
      ))}
    </div>
  )
}

export function Night({ date, refreshKey, onOpenTarget, onOpenShot, onOpenVideo, onChanged, pushToast }: NightProps) {
  const [data, setData] = useState<NightsData | null>(null)
  const [active, setActive] = useState<string | null>(date ?? null)
  const [detailDate, setDetailDate] = useState<NightDate | null>(null)
  const [rigOpen, setRigOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [month, setMonth] = useState('')
  const [dayFilter, setDayFilter] = useState<string | null>(null)
  const cardRefs = useRef(new Map<string, HTMLElement>())

  useEffect(() => {
    api
      .nights()
      .then((d) => setData(d))
      .catch(() => setData(null))
  }, [refreshKey])

  useEffect(() => {
    setActive(date ?? null)
  }, [date])

  useEffect(() => {
    if (month || !data || data.dates.length === 0) return
    setMonth(data.dates[0].date.slice(0, 7))
  }, [data, month])

  useEffect(() => {
    if (!date || !data) return
    const el = cardRefs.current.get(date)
    if (!el) return
    const timer = window.setTimeout(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60)
    return () => window.clearTimeout(timer)
  }, [date, data])

  const openFolder = async (nightId: number) => {
    const res = await api.openNightFolder(nightId)
    if (!res.ok) pushToast(res.error ?? '打开文件夹失败', 'error')
  }

  const totals = (data?.dates ?? []).reduce(
    (acc, d) => ({ nights: acc.nights + d.nightCount, shots: acc.shots + d.shotCount }),
    { nights: 0, shots: 0 }
  )

  const byDate = new Map((data?.dates ?? []).map((d) => [d.date, d]))
  const shownDates = dayFilter ? (data?.dates ?? []).filter((d) => d.date === dayFilter) : data?.dates ?? []

  return (
    <>
      <div className="page-head">
        <div>
          <div className="ph-t">Night</div>
          <h3>
            夜次<span>同一晚的深空与星野，一起回看</span>
          </h3>
        </div>
        <div className="acts">
          <div className="tabs">
            <button className={`tab ${view === 'list' ? 'on' : ''}`} onClick={() => setView('list')}>
              列表
            </button>
            <button className={`tab ${view === 'calendar' ? 'on' : ''}`} onClick={() => setView('calendar')}>
              日历
            </button>
          </div>
          <span className="pill mute">
            <i />
            {totals.nights} 个夜次 · {totals.shots} 张成片
          </span>
          <button className="btn ghost sm" onClick={() => setRigOpen(true)}>
            器材库
          </button>
          <button className="btn primary sm" onClick={() => setCreateOpen(true)}>
            记录夜次
          </button>
        </div>
      </div>

      {!data ? (
        <div className="empty">
          <b>正在读取夜次…</b>
        </div>
      ) : data.dates.length === 0 ? (
        <div className="empty">
          <b>还没有夜次记录</b>
          <span>按「日期_地点」整理星野，或在深空目标下放入成片后重新扫描。</span>
          <div className="empty-acts">
            <button className="btn primary sm" onClick={() => setCreateOpen(true)}>
              先记一个夜次
            </button>
          </div>
        </div>
      ) : (
        <>
          {view === 'calendar' && month && (
            <div className="ncal">
              <div className="ncal-head">
                <button className="mini-link" onClick={() => setMonth(shiftMonth(month, -1))}>
                  ‹ 上月
                </button>
                <b>{monthLabel(month)}</b>
                <button className="mini-link" onClick={() => setMonth(shiftMonth(month, 1))}>
                  下月 ›
                </button>
                <span className="ncal-legend">
                  <i className="deep" /> 深空 <i className="ns" /> 星野
                </span>
              </div>
              <div className="ncal-week">
                {MONTH_WEEK.map((w) => (
                  <span key={w}>{w}</span>
                ))}
              </div>
              <div className="ncal-grid">
                {calendarCells(month).map((cell, index) => {
                  if (!cell) return <span className="ncal-cell empty" key={`e-${index}`} />
                  const hit = byDate.get(cell.date)
                  return (
                    <button
                      key={cell.date}
                      className={`ncal-cell ${hit ? 'has' : ''} ${dayFilter === cell.date ? 'on' : ''}`}
                      disabled={!hit}
                      title={hit ? `${hit.nightCount} 个夜次 · ${hit.shotCount} 张成片` : '无夜次'}
                      onClick={() => {
                        setDayFilter(cell.date)
                        setActive(cell.date)
                      }}
                    >
                      <span className="ncal-day">{cell.day}</span>
                      {hit && (
                        <>
                          <span className="ncal-count">{hit.nightCount}</span>
                          <span className="ncal-dots">
                            {hit.deepSky.length > 0 && <i className="deep" />}
                            {hit.nightscape.length > 0 && <i className="ns" />}
                          </span>
                        </>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {dayFilter && (
            <div className="ncal-filter">
              已筛选 <b>{dayFilter}</b>
              <button className="mini-link" onClick={() => setDayFilter(null)}>
                显示全部
              </button>
            </div>
          )}

          {shownDates.map((d) => (
          <section
            className={`ncard ${active === d.date ? 'hl' : ''}`}
            key={d.date}
            ref={(el) => {
              if (el) cardRefs.current.set(d.date, el)
              else cardRefs.current.delete(d.date)
            }}
          >
            <div className="ncard-head">
              <div className="ncard-date">
                <b>{d.date}</b>
                <span>{weekdayOf(d.date)}</span>
              </div>
              <div className="ncard-stats">
                <span>{d.nightCount} 个夜次</span>
                <span className="sep">·</span>
                <span>{d.shotCount} 张成片</span>
                {d.videoCount > 0 && (
                  <>
                    <span className="sep">·</span>
                    <span>{d.videoCount} 段视频</span>
                  </>
                )}
                {d.exposureS > 0 && (
                  <>
                    <span className="sep">·</span>
                    <span>累计 {durationLabel(d.exposureS)}</span>
                  </>
                )}
              </div>
              <div className="ncard-tags">
                {d.rigs.map((name) => (
                  <span className="rig-chip" key={name}>
                    {name}
                  </span>
                ))}
                {d.deepSky.length > 0 && <span className="tag deep">深空 {d.deepSky.length}</span>}
                {d.nightscape.length > 0 && <span className="tag ns">星野 {d.nightscape.length}</span>}
                <button className="mini-link" onClick={() => setDetailDate(d)}>
                  夜次记录
                </button>
              </div>
            </div>

            {d.nightList.length > 0 && (
              <div className="ncard-cond">
                <span>
                  月相 {d.nightList[0].moon.phase} {d.nightList[0].moon.illum}%
                </span>
                {d.nightList[0].bortle ? <span>Bortle {d.nightList[0].bortle}</span> : null}
                {d.nightList[0].seeing ? <span>视宁度 {d.nightList[0].seeing}</span> : null}
                {d.nightList[0].weather ? <span>天气 {d.nightList[0].weather}</span> : null}
              </div>
            )}

            {d.deepSky.length > 0 && (
              <div className="nsec">
                <div className="nsec-t">深空</div>
                {d.deepSky.map((g) => (
                  <div className="night-group" key={`d-${g.targetId}`}>
                    <div className="gh">
                      <button className="gh-title" onClick={() => onOpenTarget(g.targetId)}>
                        {g.title} <span aria-hidden>›</span>
                      </button>
                      <span className="sep">·</span>
                      <span>{g.devices.join(' / ') || '设备未记录'}</span>
                      <span className="sep">·</span>
                      <span>
                        {g.shotCount} 张成片{g.exposureS > 0 ? ` · 累计 ${durationLabel(g.exposureS)}` : ''}
                      </span>
                    </div>
                    <Thumbs shots={g.shots} onOpenShot={onOpenShot} onOpenVideo={onOpenVideo} />
                  </div>
                ))}
              </div>
            )}

            {d.nightscape.length > 0 && (
              <div className="nsec">
                <div className="nsec-t">星野</div>
                {d.nightscape.map((g) => (
                  <div className="night-group" key={`n-${g.nightId}`}>
                    <div className="gh">
                      <b>{g.subType}</b>
                      <span className="sep">·</span>
                      <span>{g.location}</span>
                      <span className="sep">·</span>
                      <span>
                        {g.shotCount} 张{g.videos.length > 0 ? ` · ${g.videos.length} 段视频` : ''}
                        {g.exposureS > 0 ? ` · 累计 ${durationLabel(g.exposureS)}` : ''}
                      </span>
                      {g.folderRel && (
                        <button className="mini-link" onClick={() => openFolder(g.nightId)}>
                          打开文件夹
                        </button>
                      )}
                    </div>
                    <Thumbs shots={g.shots} videos={g.videos} onOpenShot={onOpenShot} onOpenVideo={onOpenVideo} />
                  </div>
                ))}
              </div>
            )}
          </section>
          ))}
        </>
      )}

      {detailDate && (
        <NightEditDialog
          date={detailDate.date}
          briefs={detailDate.nightList}
          onClose={() => setDetailDate(null)}
          onChanged={onChanged}
          pushToast={pushToast}
        />
      )}

      {rigOpen && <RigDialog onClose={() => setRigOpen(false)} onChanged={onChanged} pushToast={pushToast} />}

      {createOpen && (
        <CreateNightDialog
          defaultDate={date}
          onClose={() => setCreateOpen(false)}
          onChanged={onChanged}
          pushToast={pushToast}
        />
      )}
    </>
  )
}
