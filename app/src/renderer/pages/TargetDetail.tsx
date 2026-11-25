import { useEffect, useState } from 'react'
import api from '../api'
import { EditDialog } from '../components/EditDialog'
import { Icon } from '../components/Icons'
import { ProfileDialog } from '../components/ProfileDialog'
import { VersionCompare } from '../components/VersionCompare'
import { VersionManager } from '../components/VersionManager'
import { durationLabel, hoursLabel } from '../util'
import type {
  EncyclopediaSite,
  OnlineProfileResult,
  OpResult,
  ShotPatch,
  TargetDetail as TargetDetailData,
  TargetProfilePatch,
  TargetShot
} from '../types'

function distanceLabel(ly: number | null) {
  if (ly === null || !Number.isFinite(ly) || ly <= 0) return '未录入'
  if (ly >= 10000) {
    const wan = Math.round(ly / 10000)
    return `约 ${wan.toLocaleString()} 万光年`
  }
  return `约 ${Math.round(ly).toLocaleString()} 光年`
}

function magnitudeLabel(magnitude: number | null) {
  if (magnitude === null || !Number.isFinite(magnitude)) return '未录入'
  return `${Math.round(magnitude * 10) / 10} 等`
}

interface TargetDetailProps {
  targetId: number
  refreshKey: string
  onBack: () => void
  onOpenShot: (shotId: number) => void
  onChanged: () => void
  pushToast: (message: string, kind?: 'info' | 'error' | 'ok') => void
}

export function TargetDetail({ targetId, refreshKey, onBack, onOpenShot, onChanged, pushToast }: TargetDetailProps) {
  const [data, setData] = useState<TargetDetailData | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<number[]>([])
  const [notesOpen, setNotesOpen] = useState(false)
  const [batchBusy, setBatchBusy] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [profileBusy, setProfileBusy] = useState(false)
  const [versionGroup, setVersionGroup] = useState<{ nightId: number | null; date: string } | null>(null)
  const [versionBusy, setVersionBusy] = useState(false)
  const [compareShots, setCompareShots] = useState<TargetShot[] | null>(null)
  const [online, setOnline] = useState<OnlineProfileResult | null>(null)
  const [onlineBusy, setOnlineBusy] = useState(false)

  const load = () => {
    api
      .targetDetail(targetId)
      .then((d) => setData(d))
      .catch(() => setData(null))
  }

  const loadOnline = (force = false) => {
    setOnlineBusy(true)
    api
      .targetProfileOnline(targetId, force)
      .then((res) => setOnline(res))
      .catch(() => setOnline(null))
      .finally(() => setOnlineBusy(false))
  }

  useEffect(load, [targetId, refreshKey])

  useEffect(() => {
    setOnline(null)
    loadOnline(false)
  }, [targetId, refreshKey])

  useEffect(() => {
    setPicking(false)
    setPicked([])
    setVersionGroup(null)
    setCompareShots(null)
  }, [targetId])

  const allShotIds = data ? data.groups.flatMap((g) => g.shots.map((s) => s.id)) : []
  const versionShots =
    versionGroup && data
      ? data.groups.find((g) => g.nightId === versionGroup.nightId && g.date === versionGroup.date)?.shots ?? null
      : null
  const versionNights = data
    ? [
        ...new Map(
          data.groups
            .filter((g) => g.nightId)
            .map((g) => [g.nightId as number, { nightId: g.nightId as number, date: g.date }])
        ).values()
      ]
    : []

  const togglePick = (id: number) => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const applyBatch = async (patch: ShotPatch, message: string) => {
    if (!picked.length) return
    setBatchBusy(true)
    try {
      const res = await api.updateShots(picked, patch)
      if (!res.ok) {
        pushToast(res.error ?? '保存失败', 'error')
        return
      }
      pushToast(`${message}（${res.updated ?? picked.length} 张）`, 'ok')
      load()
      onChanged()
    } finally {
      setBatchBusy(false)
    }
  }

  const openFolder = async (kind: 'finals' | 'root') => {
    const res: OpResult = kind === 'finals' ? await api.openTargetFinals(targetId) : await api.openTargetRoot(targetId)
    if (!res.ok) {
      pushToast(`${res.error ?? '打开失败'}。请检查素材库路径后使用「重新定位」。`, 'error')
    }
  }

  const openExternal = async (site: EncyclopediaSite) => {
    const res = await api.openEncyclopedia(targetId, site)
    if (!res.ok) pushToast(res.error ?? '打开外部资料失败', 'error')
  }

  const submitProfile = async (patch: TargetProfilePatch) => {
    setProfileBusy(true)
    try {
      const res = await api.updateTargetProfile(targetId, patch)
      if (!res.ok) {
        pushToast(res.error ?? '保存失败', 'error')
        return
      }
      setProfileOpen(false)
      pushToast('天体名片已保存', 'ok')
      load()
      onChanged()
    } finally {
      setProfileBusy(false)
    }
  }

  const submitRename = async (name: string) => {
    setBusy(true)
    try {
      const res = await api.renameTarget(targetId, name)
      if (!res.ok) {
        pushToast(res.error ?? '重命名失败', 'error')
        return
      }
      setEditing(false)
      pushToast(res.renamed ? `已重命名为「${name}」，文件夹已同步` : '名称未变化', 'ok')
      load()
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  if (!data) {
    return (
      <div className="empty">
        <b>正在读取目标…</b>
      </div>
    )
  }

  const { target, summary, groups } = data

  return (
    <>
      <div className="page-head">
        <div>
          <div className="ph-t">
            <button className="crumb-link" onClick={onBack}>
              深空
            </button>{' '}
            / 目标详情
          </div>
          <h3>
            {target.title}
            {target.nameEn && <span>{target.nameEn}</span>}
          </h3>
        </div>
        <div className="acts">
          <button className="btn ghost sm" onClick={() => openFolder('root')}>
            <Icon name="folder" size={12} />
            打开目标目录
          </button>
          <button className="btn ghost sm" onClick={() => setProfileOpen(true)}>
            <Icon name="edit" size={12} />
            编辑名片
          </button>
          <button className="btn ghost sm" onClick={() => setEditing(true)}>
            <Icon name="edit" size={12} />
            改中文名
          </button>
          <button className="btn primary sm" onClick={() => openFolder('finals')}>
            <Icon name="folder" size={12} />
            打开成片文件夹
          </button>
        </div>
      </div>

      <div className="detail">
        <div className="celest">
          <div className="cover">
            {target.coverUrl ? <img src={target.coverUrl} alt={target.title} /> : <div className="no-thumb tall">暂无成片</div>}
            <div className="cn">
              <b>{target.title}</b>
              <small>{target.nameEn || 'Deep Sky Object'}</small>
            </div>
          </div>
          <div className="body">
            {target.alias && <div className="alias">俗称：{target.alias}</div>}
            <div className="kv-grid">
              <div className="kv">
                <div className="k">类型</div>
                <div className="v">{target.objectType || '未录入'}</div>
              </div>
              <div className="kv">
                <div className="k">星座</div>
                <div className="v">{target.constellation || '未录入'}</div>
              </div>
              <div className="kv">
                <div className="k">距离</div>
                <div className="v">{distanceLabel(target.distanceLy)}</div>
              </div>
              <div className="kv">
                <div className="k">视星等</div>
                <div className="v">{magnitudeLabel(target.magnitude)}</div>
              </div>
              <div className="kv">
                <div className="k">编号</div>
                <div className="v">{target.catalogId}</div>
              </div>
            </div>
            <p className={`desc ${target.description ? '' : 'muted'}`}>
              {target.description || '还没有这个天体的简介。点击「编辑名片」补充资料。'}
            </p>
            <div className="profile-src">
              {target.source
                ? `${target.source}${target.profileUpdatedAt ? ` · 更新于 ${target.profileUpdatedAt.slice(0, 10)}` : ''}`
                : '资料待补充'}
            </div>
            {online?.profile && (
              <div className="online-profile">
                <div className="online-head">
                  <span className="online-src">{online.profile.source}</span>
                  {online.cached && <span className="online-tag">缓存</span>}
                  {online.profile.updatedAt && (
                    <span className="online-date">{online.profile.updatedAt.slice(0, 10)}</span>
                  )}
                  {online.enabled && (
                    <button className="mini-link" disabled={onlineBusy} onClick={() => loadOnline(true)}>
                      {onlineBusy ? '获取中…' : '刷新'}
                    </button>
                  )}
                </div>
                {online.profile.imageUrl && (
                  <img
                    className="online-img"
                    src={online.profile.imageUrl}
                    alt={online.profile.title}
                    loading="lazy"
                  />
                )}
                <p className="online-text">{online.profile.extract}</p>
                {online.error && (
                  <div className="online-err">
                    {online.error}
                    {online.enabled && (
                      <button className="mini-link" disabled={onlineBusy} onClick={() => loadOnline(true)}>
                        重试
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {!online?.profile && (
              <div className="online-empty">
                {online === null
                  ? '正在读取在线资料…'
                  : online.error
                    ? online.error
                    : online.enabled
                      ? '暂无在线资料，当前显示内置天体资料。'
                      : '联网资料未开启，当前显示内置天体资料；可在设置中允许联网获取。'}
                {online?.enabled && (
                  <button className="mini-link" disabled={onlineBusy} onClick={() => loadOnline(true)}>
                    {onlineBusy ? '获取中…' : '重试'}
                  </button>
                )}
              </div>
            )}
            <div className="ext-links">
              <span className="ext-label">外部资料</span>
              <button className="ext-link" data-site="wikipedia" onClick={() => openExternal('wikipedia')}>
                维基百科
              </button>
              <span className="ext-dot">·</span>
              <button className="ext-link" data-site="baike" onClick={() => openExternal('baike')}>
                百度百科
              </button>
            </div>
            <p className="desc mono-line">
              <span className="mono">{data.folders.root}</span>
            </p>
            <div className="tools">
              <span className="pill info">
                <i />
                {summary.nights} 个夜次
              </span>
              <span className="pill mute">
                <i />
                RAW {summary.rawFrames} 帧
              </span>
            </div>
          </div>
        </div>

        <div>
          <div className="works-head">
            <div className="sum">
              共 <b>{summary.nights}</b> 个夜次 · <b>{summary.finals}</b> 张成片 · <b>{hoursLabel(summary.exposureS)}</b> · RAW{' '}
              <b>{summary.rawFrames}</b> 帧
            </div>
            <div className="right">
              {picking ? (
                <>
                  <span className="selbox on">已选 {picked.length} 张</span>
                  <button
                    className="btn ghost sm"
                    onClick={() => {
                      setPicking(false)
                      setPicked([])
                    }}
                  >
                    退出选择
                  </button>
                </>
              ) : (
                <button className="btn ghost sm" onClick={() => setPicking(true)}>
                  选择照片
                </button>
              )}
            </div>
          </div>

          {picking && (
            <div className="batch-bar">
              <span className="bb-label">批量评分</span>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className="star-btn"
                  disabled={!picked.length || batchBusy}
                  title={`评 ${n} 星`}
                  onClick={() => applyBatch({ rating: n }, `已评 ${n} 星`)}
                >
                  ★
                </button>
              ))}
              <button
                className="btn ghost sm"
                disabled={!picked.length || batchBusy}
                onClick={() => applyBatch({ rating: 0 }, '已清除评分')}
              >
                清除
              </button>
              <span className="bb-div" />
              <button
                className="btn ghost sm"
                disabled={!picked.length || batchBusy}
                onClick={() => applyBatch({ isPinned: true }, '已置顶')}
              >
                置顶
              </button>
              <button
                className="btn ghost sm"
                disabled={!picked.length || batchBusy}
                onClick={() => applyBatch({ isPinned: false }, '已取消置顶')}
              >
                取消置顶
              </button>
              <button className="btn ghost sm" disabled={!picked.length || batchBusy} onClick={() => setNotesOpen(true)}>
                批量备注
              </button>
              <span className="bb-div" />
              <button className="mini-link" disabled={batchBusy} onClick={() => setPicked(allShotIds)}>
                全选
              </button>
              <button className="mini-link" disabled={batchBusy} onClick={() => setPicked([])}>
                清空
              </button>
            </div>
          )}

          {groups.length === 0 && <div className="empty-line">还没有成片，放入 成片 文件夹后重新扫描。</div>}

          {groups.map((g, gi) => (
            <div className="night-group" key={`${g.date}-${gi}`}>
              <div className="gh">
                <b>{g.date}</b>
                <span className="sep">·</span>
                <span>{g.device}</span>
                <span className="sep">·</span>
                <span>累计 {durationLabel(g.exposureS)}</span>
                {g.nightId && (
                  <button className="mini-link" onClick={() => api.openNightFolder(g.nightId!).then((r) => !r.ok && pushToast(r.error ?? '打开失败', 'error'))}>
                    打开文件夹
                  </button>
                )}
                {g.shots.length > 0 && (
                  <button className="mini-link" onClick={() => setVersionGroup({ nightId: g.nightId, date: g.date })}>
                    版本管理
                  </button>
                )}
                {g.shots.length > 1 && (
                  <button className="mini-link" onClick={() => setCompareShots(g.shots)}>
                    版本对比
                  </button>
                )}
                <span className="more">
                  {g.shots.length} 张成片 · RAW{' '}
                  {summary.rawFrames > 0 ? Math.round(summary.rawFrames / Math.max(1, groups.length)) : 0} 帧 ›
                </span>
              </div>
              <div className="thumbs">
                {g.shots.map((s) => (
                  <button
                    className={`shot hoverable ${picked.includes(s.id) ? 'picked' : ''}`}
                    key={s.id}
                    style={{ ['--ar' as string]: s.ar }}
                    onClick={() => (picking ? togglePick(s.id) : onOpenShot(s.id))}
                  >
                    <img src={s.thumbUrl} alt={s.fileName} />
                    <span className="ver-chip">{s.versionName || `v${s.versionNo}`}</span>
                    {s.isFinalVersion && <span className="final-chip">最终版</span>}
                    {picking && <span className={`pick-dot ${picked.includes(s.id) ? 'on' : ''}`}>{picked.includes(s.id) ? '✓' : ''}</span>}
                    <div className="ph-cap">
                      <span>{s.fileName.replace(/\.[^.]+$/, '')}</span>
                      <span>{s.versionTags[0] ?? ('★'.repeat(s.rating) || '')}</span>
                    </div>
                  </button>
                ))}
                {summary.rawFrames > 0 && gi === 0 && (
                  <div className="shot raw" style={{ ['--ar' as string]: 0.78 }}>
                    <span>
                      RAW 光帧
                      <br />
                      {summary.rawFrames} 帧
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {notesOpen && (
        <EditDialog
          title="批量设置备注"
          hint={`将覆盖选中的 ${picked.length} 张照片的备注`}
          label="备注"
          initial=""
          multiline
          confirmText="保存备注"
          busy={batchBusy}
          onCancel={() => setNotesOpen(false)}
          onConfirm={async (value) => {
            setBatchBusy(true)
            try {
              const res = await api.updateShots(picked, { notes: value })
              if (!res.ok) {
                pushToast(res.error ?? '保存失败', 'error')
                return
              }
              setNotesOpen(false)
              pushToast(`备注已写入 ${res.updated ?? picked.length} 张照片`, 'ok')
              load()
              onChanged()
            } finally {
              setBatchBusy(false)
            }
          }}
        />
      )}

      {profileOpen && (
        <ProfileDialog
          initial={{
            nameEn: target.nameEn,
            alias: target.alias,
            objectType: target.objectType,
            constellation: target.constellation,
            distanceLy: target.distanceLy === null ? '' : String(target.distanceLy),
            magnitude: target.magnitude === null ? '' : String(target.magnitude),
            description: target.description
          }}
          busy={profileBusy}
          onCancel={() => setProfileOpen(false)}
          onConfirm={submitProfile}
        />
      )}

      {versionShots && (
        <VersionManager
          targetTitle={target.title}
          shots={versionShots}
          nights={versionNights}
          busy={versionBusy}
          onBusy={setVersionBusy}
          onClose={() => setVersionGroup(null)}
          onChanged={() => {
            load()
            onChanged()
          }}
          pushToast={pushToast}
        />
      )}

      {compareShots && <VersionCompare shots={compareShots} onClose={() => setCompareShots(null)} />}

      {editing && (
        <EditDialog
          title="修改目标中文名"
          hint="保存后会同步重命名目标文件夹，编号保持不变。"
          label="中文名"
          initial={target.nameCn}
          busy={busy}
          onConfirm={submitRename}
          onCancel={() => setEditing(false)}
        />
      )}
    </>
  )
}
