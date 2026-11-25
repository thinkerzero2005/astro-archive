import { useEffect, useState } from 'react'
import api from '../api'
import { exposureLabel, durationLabel } from '../util'
import type { CreateNightPatch, NightBrief, NightDetail } from '../types'

interface CommonProps {
  onClose: () => void
  onChanged: () => void
  pushToast: (message: string, kind?: 'info' | 'error' | 'ok') => void
}

interface NightEditDialogProps extends CommonProps {
  date: string
  briefs: NightBrief[]
}

interface Draft {
  location: string
  weather: string
  seeing: string
  bortle: string
  notes: string
  postProcess: string
}

export function NightEditDialog({ date, briefs, onClose, onChanged, pushToast }: NightEditDialogProps) {
  const [activeId, setActiveId] = useState<number | null>(briefs[0]?.id ?? null)
  const [detail, setDetail] = useState<NightDetail | null>(null)
  const [draft, setDraft] = useState<Draft>({
    location: '',
    weather: '',
    seeing: '',
    bortle: '',
    notes: '',
    postProcess: ''
  })
  const [manualRigs, setManualRigs] = useState<number[]>([])
  const [busy, setBusy] = useState(false)

  const load = (id: number) => {
    api
      .nightDetail(id)
      .then((d) => {
        setDetail(d)
        if (!d) return
        setDraft({
          location: d.night.location === '未标注' ? '' : d.night.location,
          weather: d.night.weather,
          seeing: d.night.seeing,
          bortle: d.night.bortle === null ? '' : String(d.night.bortle),
          notes: d.night.notes,
          postProcess: d.night.postProcess
        })
        setManualRigs(d.rigs.filter((r) => r.selected && !r.auto).map((r) => r.id))
      })
      .catch(() => setDetail(null))
  }

  useEffect(() => {
    if (activeId !== null) load(activeId)
  }, [activeId])

  const toggleRig = (id: number) => {
    setManualRigs((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const save = async () => {
    if (activeId === null) return
    const bortleText = draft.bortle.trim()
    const bortle = bortleText === '' ? null : Number(bortleText)
    if (bortle !== null && (!Number.isInteger(bortle) || bortle < 1 || bortle > 9)) {
      pushToast('波特尔等级需要是 1 到 9 的整数', 'error')
      return
    }
    setBusy(true)
    const res = await api.updateNight(activeId, {
      location: draft.location.trim(),
      weather: draft.weather.trim(),
      seeing: draft.seeing.trim(),
      bortle,
      notes: draft.notes.trim(),
      postProcess: draft.postProcess.trim(),
      rigIds: detail ? detail.rigs.filter((r) => r.auto || manualRigs.includes(r.id)).map((r) => r.id) : manualRigs
    })
    setBusy(false)
    if (!res.ok) {
      pushToast(res.error ?? '保存夜次失败', 'error')
      return
    }
    pushToast('夜次记录已保存', 'ok')
    onChanged()
    load(activeId)
  }

  const openFolder = async () => {
    if (activeId === null) return
    const res = await api.openNightFolder(activeId)
    if (!res.ok) pushToast(res.error ?? '打开文件夹失败', 'error')
  }

  return (
    <div
      className="modal-mask"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div className="modal night-dialog" role="dialog" aria-modal>
        <div className="modal-head">
          <b>夜次记录 · {date}</b>
          <span>同一晚可分别记录深空与星野；器材可自动关联，也可手工补充。</span>
        </div>

        <div className="nd-tabs">
          {briefs.map((b) => (
            <button
              key={b.id}
              className={`nd-tab ${activeId === b.id ? 'on' : ''}`}
              onClick={() => setActiveId(b.id)}
            >
              {b.category === 'deep_sky' ? '深空' : b.subType}
              {b.location && b.location !== '未标注' ? ` · ${b.location}` : ''}
            </button>
          ))}
        </div>

        {!detail ? (
          <div className="empty">正在读取夜次…</div>
        ) : (
          <>
            <div className="nd-meta">
              <span>
                月相 <b>{detail.moon.phase}</b> · {detail.moon.illum}%
              </span>
              <span>
                目标 <b>{detail.stats.targetCount}</b>
              </span>
              <span>
                成片 <b>{detail.stats.shotCount}</b>
              </span>
              {detail.stats.videoCount > 0 && (
                <span>
                  视频 <b>{detail.stats.videoCount}</b>
                </span>
              )}
              <span>
                累计曝光 <b>{durationLabel(detail.stats.exposureS)}</b>
              </span>
              {detail.folderPath && (
                <button className="mini-link" onClick={openFolder}>
                  打开文件夹
                </button>
              )}
            </div>

            <div className="nd-summary">
              {detail.summary.rigs.length > 0 && (
                <span>
                  器材 <b>{detail.summary.rigs.join(' / ')}</b>
                </span>
              )}
              {detail.summary.lens.length > 0 && (
                <span>
                  镜头 <b>{detail.summary.lens.join(' / ')}</b>
                </span>
              )}
              {detail.summary.singleExposureS > 0 && (
                <span>
                  单张曝光 <b>{exposureLabel(detail.summary.singleExposureS, 0)}</b>
                </span>
              )}
              {detail.summary.isos.length > 0 && (
                <span>
                  ISO/Gain <b>{detail.summary.isos.join(' / ')}</b>
                </span>
              )}
              {detail.summary.frameCount > 0 && (
                <span>
                  张数 <b>{detail.summary.frameCount}</b>
                </span>
              )}
              <span>
                累计曝光 <b>{durationLabel(detail.summary.exposureS)}</b>
              </span>
              {detail.summary.timelapseDurationS > 0 && (
                <span>
                  延时{' '}
                  <b>
                    {detail.summary.timelapseFrames} 帧 · {durationLabel(detail.summary.timelapseDurationS)}
                    {detail.summary.timelapseFps > 0 ? ` @ ${detail.summary.timelapseFps}fps` : ''}
                  </b>
                </span>
              )}
            </div>

            <div className="mg-grid">
              <label className="mg-field">
                <span>地点</span>
                <input
                  className="input"
                  value={draft.location}
                  onChange={(e) => setDraft((p) => ({ ...p, location: e.target.value }))}
                  placeholder="如 阿智村"
                  spellCheck={false}
                />
              </label>
              <label className="mg-field">
                <span>天气备注</span>
                <input
                  className="input"
                  value={draft.weather}
                  onChange={(e) => setDraft((p) => ({ ...p, weather: e.target.value }))}
                  placeholder="晴 / 薄云 / 风大"
                  spellCheck={false}
                />
              </label>
              <label className="mg-field">
                <span>视宁度</span>
                <input
                  className="input"
                  value={draft.seeing}
                  onChange={(e) => setDraft((p) => ({ ...p, seeing: e.target.value }))}
                  placeholder="良好 / 一般 / 差"
                  spellCheck={false}
                />
              </label>
              <label className="mg-field">
                <span>波特尔等级（1–9）</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={9}
                  value={draft.bortle}
                  onChange={(e) => setDraft((p) => ({ ...p, bortle: e.target.value }))}
                />
              </label>
              <label className="mg-field wide">
                <span>备注</span>
                <textarea
                  className="input area"
                  rows={3}
                  value={draft.notes}
                  onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="当晚的天空、计划与遗憾…"
                />
              </label>
              <label className="mg-field wide">
                <span>后期处理</span>
                <textarea
                  className="input area"
                  rows={3}
                  value={draft.postProcess}
                  onChange={(e) => setDraft((p) => ({ ...p, postProcess: e.target.value }))}
                  placeholder="堆栈、拼接与调色思路，如：DSS 堆栈 80 张 + PI 拉伸 + 局部提亮"
                />
              </label>
            </div>

            <div className="modal-label">参与器材</div>
            <div className="nd-rigs">
              {detail.rigs.map((rig) => {
                const on = rig.auto || manualRigs.includes(rig.id)
                return (
                  <button
                    key={rig.id}
                    className={`nd-rig ${on ? 'on' : ''}`}
                    disabled={rig.auto}
                    onClick={() => toggleRig(rig.id)}
                    title={rig.auto ? '按成片设备自动关联' : '点击手工关联'}
                  >
                    {rig.name}
                    {rig.auto && <small>自动</small>}
                  </button>
                )
              })}
              {detail.rigs.length === 0 && <span className="rig-type">器材库为空</span>}
            </div>

            <div className="modal-label">当晚目标</div>
            {detail.targets.length === 0 ? (
              <div className="rig-type">这一夜以星野为主，没有深空目标。</div>
            ) : (
              <div className="nd-targets">
                {detail.targets.map((t) => (
                  <div className="nd-target" key={t.targetId}>
                    <span className="t">{t.title}</span>
                    <span className="m">
                      {t.shotCount} 张{t.frameCount > 0 ? ` · ${t.frameCount} 帧` : ''}
                    </span>
                    <span className="m">累计 {durationLabel(t.exposureS)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            关闭
          </button>
          <button className="btn primary" onClick={save} disabled={busy || !detail}>
            {busy ? '保存中…' : '保存夜次'}
          </button>
        </div>
      </div>
    </div>
  )
}

const NS_TYPES = ['银河', '星轨', '延时', '其他']

function todayText() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

interface CreateNightDialogProps extends CommonProps {
  defaultDate?: string
}

export function CreateNightDialog({ defaultDate, onClose, onChanged, pushToast }: CreateNightDialogProps) {
  const [date, setDate] = useState(defaultDate || todayText())
  const [category, setCategory] = useState<'deep_sky' | 'nightscape'>('nightscape')
  const [subType, setSubType] = useState('银河')
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      pushToast('日期需要是 YYYY-MM-DD 格式', 'error')
      return
    }
    const patch: CreateNightPatch = {
      date: date.trim(),
      category,
      subType: category === 'nightscape' ? subType : '',
      location: location.trim()
    }
    setBusy(true)
    const res = await api.createNight(patch)
    setBusy(false)
    if (!res.ok) {
      pushToast(res.error ?? '新建夜次失败', 'error')
      return
    }
    pushToast('已新建夜次，可继续补充记录', 'ok')
    onChanged()
    onClose()
  }

  return (
    <div
      className="modal-mask"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div className="modal" role="dialog" aria-modal>
        <div className="modal-head">
          <b>新增夜次</b>
          <span>可以先建一个空夜次，之后把成片放进素材库再扫描关联。</span>
        </div>
        <div className="mg-grid">
          <label className="mg-field">
            <span>拍摄日期</span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="mg-field">
            <span>类别</span>
            <select
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value as 'deep_sky' | 'nightscape')}
            >
              <option value="nightscape">星野</option>
              <option value="deep_sky">深空</option>
            </select>
          </label>
          {category === 'nightscape' && (
            <label className="mg-field">
              <span>星野类型</span>
              <select className="input" value={subType} onChange={(e) => setSubType(e.target.value)}>
                {NS_TYPES.map((t) => (
                  <option value={t} key={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="mg-field">
            <span>地点</span>
            <input
              className="input"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="如 阿智村"
              spellCheck={false}
            />
          </label>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? '新建中…' : '新建夜次'}
          </button>
        </div>
      </div>
    </div>
  )
}
