import type { ReactNode } from 'react'
import { Icon } from '../components/Icons'
import { CONTENT_MODULES } from '../homeModules'
import { durationLabel, hoursLabel, lastScanLabel } from '../util'
import type { HomeModuleKey, HomeModules, Overview } from '../types'

interface HomeProps {
  overview: Overview
  modules: HomeModules
  onOpenTarget: (id: number) => void
  onOpenShot: (shotId: number) => void
  onOpenDeepSky: () => void
  onOpenNightscape: (type: string) => void
  onOpenNight: (date: string) => void
  onOpenLibrary: () => void
  onScan: () => void
  onOpenImport: () => void
  onOpenSettings: () => void
}

export function Home({
  overview,
  modules,
  onOpenTarget,
  onOpenShot,
  onOpenDeepSky,
  onOpenNightscape,
  onOpenNight,
  onOpenLibrary,
  onScan,
  onOpenImport,
  onOpenSettings
}: HomeProps) {
  const { hero, stats, calendar } = overview
  const marks = new Set(calendar.marks)

  const first = new Date(calendar.year, calendar.month - 1, 1)
  const offset = (first.getDay() + 6) % 7
  const daysInMonth = new Date(calendar.year, calendar.month, 0).getDate()
  const cells: Array<number | null> = []
  for (let i = 0; i < offset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const ns = overview.nightscape

  const renderHero = (): ReactNode =>
    hero ? (
      <div className="hero" key="hero">
        <img src={hero.thumbUrl} alt={hero.nameCn} />
        {hero.pinned && (
          <div className="pin">
            <Icon name="pin" size={10} />
            已置顶 · 最近成片
          </div>
        )}
        <div className="copy">
          <div className="k">Deep Sky · {hero.date || '日期待补'}</div>
          <div className="nm">{hero.nameCn}</div>
          <div className="en">
            {[hero.nameEn, hero.constellation, hero.distanceLy ? `${hero.distanceLy.toLocaleString()} 光年` : '']
              .filter(Boolean)
              .join(' · ') || '深空成片'}
          </div>
          <div className="facts">
            {hero.facts.map((f) => (
              <span key={f}>{f}</span>
            ))}
          </div>
        </div>
        <div className="acts">
          {hero.targetId && (
            <button className="btn sm" onClick={() => onOpenTarget(hero.targetId!)}>
              信息
            </button>
          )}
          <button className="btn primary sm" onClick={() => onOpenShot(hero.shotId)}>
            查看大图
          </button>
        </div>
      </div>
    ) : (
      <div className="empty hero-empty" key="hero">
        <b>素材库还没有成片</b>
        <span>
          把深空成片放进 <code>01_深空/&lt;编号_中文名&gt;/成片</code>，然后重新扫描。
        </span>
        <div className="empty-acts">
          <button className="btn ghost sm" onClick={onOpenLibrary}>
            打开素材库
          </button>
          <button className="btn primary sm" onClick={onScan}>
            重新扫描
          </button>
        </div>
      </div>
    )

  const renderStats = (): ReactNode => (
    <div className="stats" key="stats">
      <div className="stat">
        <div className="k">深空目标</div>
        <div className="v">{stats.targets}</div>
        <div className="d">{stats.deepSkyFinals} 张成片</div>
      </div>
      <div className="stat">
        <div className="k">拍摄夜次</div>
        <div className="v">{stats.nights}</div>
        <div className="d">{overview.recentNights.length ? `最近 ${overview.recentNights[0].date}` : '还没有记录'}</div>
      </div>
      <div className="stat">
        <div className="k">深空累计曝光</div>
        <div className="v">
          {stats.exposureS > 0 ? (stats.exposureS / 3600).toFixed(1) : '—'}
          {stats.exposureS > 0 && <small>h</small>}
        </div>
        <div className="d">按原始帧数 × 单帧曝光</div>
      </div>
      <div className="stat">
        <div className="k">星野作品</div>
        <div className="v">{stats.nightscapeWorks}</div>
        <div className="d">
          银河 {stats.byType['银河'] ?? 0} · 星轨 {stats.byType['星轨'] ?? 0} · 延时 {stats.byType['延时'] ?? 0}
        </div>
      </div>
    </div>
  )

  const renderTargets = (): ReactNode => (
    <div className="block" key="targets">
      <div className="block-head">
        <div className="t">
          深空目标 <em>按最近拍摄</em>
        </div>
        <a className="link" onClick={onOpenDeepSky} role="button">
          查看全部 →
        </a>
      </div>
      {overview.targets.length ? (
        <div className="target-grid">
          {overview.targets.slice(0, 4).map((t) => (
            <button className="tcard" key={t.id} onClick={() => onOpenTarget(t.id)}>
              {t.thumbUrl ? <img className="img" src={t.thumbUrl} alt={t.title} /> : <div className="img no-thumb">暂无成片</div>}
              <div className="ov" />
              {t.pinned === 1 && <div className="star">★</div>}
              {t.isNew && <div className="new">NEW</div>}
              <div className="txt">
                <b>{t.title}</b>
                <small>
                  {t.nights} 夜次 · {hoursLabel(t.exposureS)}
                </small>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-line">还没有深空目标，按目录规范放入文件夹后重新扫描。</div>
      )}
    </div>
  )

  const renderNightscape = (): ReactNode => (
    <div className="block" key="nightscape">
      <div className="block-head">
        <div className="t">
          星野作品{' '}
          <em>
            银河 {stats.byType['银河'] ?? 0} · 星轨 {stats.byType['星轨'] ?? 0} · 延时 {stats.byType['延时'] ?? 0}
          </em>
        </div>
        <a className="link" onClick={() => onOpenNightscape('银河')} role="button">
          查看全部 →
        </a>
      </div>
      <div className="ns-strip">
        {ns.items.map((item) => (
          <button className="it" key={item.type} onClick={() => onOpenNightscape(item.type)}>
            {item.thumbUrl ? <img src={item.thumbUrl} alt={item.type} /> : <div className="img no-thumb">暂无成片</div>}
            <span className="n">{item.count}</span>
            <div className="l">
              {item.type}
              <small>{item.date ? `${item.date} · ${item.location}` : '还没有作品'}</small>
            </div>
          </button>
        ))}
      </div>
    </div>
  )

  const renderNights = (): ReactNode => (
    <div className="block fill" key="nights">
      <div className="block-head">
        <div className="t">
          夜次 <em>{`${calendar.year} 年 ${calendar.month} 月`}</em>
        </div>
      </div>
      <div className="moon-row">
        <span className="moon">
          <span className="disc" />
          {calendar.moon.phase} · {calendar.moon.illum}%
        </span>
        <span>{calendar.marks.length} 个拍摄夜</span>
      </div>
      <div className="cal">
        {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
          <div className="wd" key={w}>
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div className="d mute" key={`m${i}`} />
          const on = marks.has(d)
          const today = d === calendar.today
          if (on) {
            const dateStr = `${calendar.year}-${String(calendar.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
            return (
              <button
                className={`d on clickable ${today ? 'today' : ''}`}
                key={d}
                title={`查看 ${dateStr} 的夜次`}
                onClick={() => onOpenNight(dateStr)}
              >
                {d}
              </button>
            )
          }
          return (
            <div className={`d ${today ? 'today' : ''}`} key={d}>
              {d}
            </div>
          )
        })}
      </div>
      <div className="night-head">
        <span>最近夜次</span>
      </div>
      <div className="night-list">
        {overview.recentNights.length ? (
          overview.recentNights.map((n) => (
            <button className="nr clickable" key={n.id} onClick={() => onOpenNight(n.date)}>
              <span className="dd">{n.date.slice(5)}</span>
              <span className="loc">
                {n.category === 'deep_sky' ? '深空 · ' : `${n.subType} · `}
                {n.location}
              </span>
              <b>{durationLabel(n.exposureS)}</b>
            </button>
          ))
        ) : (
          <div className="nr">
            <span className="loc">还没有夜次记录</span>
          </div>
        )}
      </div>
      <div className="mini-list">
        <button className="it clickable" onClick={onOpenImport}>
          <span className="dot2 a" />
          收件箱待整理
          <b>{overview.pendingInbox}</b>
        </button>
        <div className="it">
          <span className="dot2 g" />
          深空成片
          <b>{stats.deepSkyFinals}</b>
        </div>
        <div className="it">
          <span className="dot2" style={{ background: 'var(--ink-7)' }} />
          素材库
          <b style={{ fontSize: 12 }}>{overview.libraryRoot}</b>
        </div>
      </div>
    </div>
  )

  const renderModule = (key: HomeModuleKey): ReactNode => {
    if (key === 'targets') return renderTargets()
    if (key === 'nightscape') return renderNightscape()
    return renderNights()
  }

  const visible = modules.order.filter((key) => !modules.hidden.includes(key))
  const nodes: ReactNode[] = []
  let chunk: HomeModuleKey[] = []

  const flush = () => {
    if (!chunk.length) return
    const list = chunk
    chunk = []
    const half = Math.ceil(list.length / 2)
    const left = list.slice(0, half)
    const right = list.slice(half)
    const cls =
      list.length === 1
        ? 'home-grid single'
        : right.length === 1 && right[0] === 'nights'
          ? 'home-grid'
          : 'home-grid even'
    nodes.push(
      <div className={cls} key={`grid-${list.join('-')}`}>
        <div className="home-col">{left.map(renderModule)}</div>
        {right.length > 0 && <div className="home-col">{right.map(renderModule)}</div>}
      </div>
    )
  }

  for (const key of visible) {
    if (CONTENT_MODULES.includes(key)) {
      chunk.push(key)
    } else {
      flush()
      nodes.push(key === 'hero' ? renderHero() : renderStats())
    }
  }
  flush()

  return (
    <>
      <div className="page-head">
        <div>
          <div className="ph-t">Home</div>
          <h3>
            今晚，从哪一张开始看？<span>最近成片与总量一眼可见</span>
          </h3>
        </div>
        <div className="acts">
          <span className="pill mute">
            <i />
            {lastScanLabel(overview.lastScanAt)}
          </span>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="empty">
          <b>首页模块已全部隐藏</b>
          <span>可以在设置里重新开启需要的模块。隐藏不会删除任何素材或记录。</span>
          <div className="empty-acts">
            <button className="btn primary sm" onClick={onOpenSettings}>
              去设置
            </button>
          </div>
        </div>
      ) : (
        <div className="home-stack">{nodes}</div>
      )}
    </>
  )
}
