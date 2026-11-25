import { useEffect, useState } from 'react'
import api from '../api'
import { deviceLabel, durationLabel } from '../util'
import type { RigInfo, RigPatch } from '../types'

interface RigDialogProps {
  onClose: () => void
  onChanged: () => void
  pushToast: (message: string, kind?: 'info' | 'error' | 'ok') => void
}

interface Draft {
  name: string
  type: string
  focalMm: string
  apertureF: string
  device: string
  notes: string
}

const EMPTY: Draft = { name: '', type: '', focalMm: '', apertureF: '', device: '', notes: '' }

const DEVICE_OPTIONS = [
  { value: '', label: '不自动关联' },
  { value: 'DWARFMINI', label: 'DWARF mini' },
  { value: 'CANON', label: 'Canon' },
  { value: 'PHONE', label: '手机' }
]

export function RigDialog({ onClose, onChanged, pushToast }: RigDialogProps) {
  const [rigs, setRigs] = useState<RigInfo[] | null>(null)
  const [editing, setEditing] = useState<RigInfo | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [busy, setBusy] = useState(false)

  const load = () => {
    api
      .rigs()
      .then((d) => setRigs(d.rigs))
      .catch(() => setRigs([]))
  }

  useEffect(() => {
    load()
  }, [])

  const startNew = () => {
    setDraft(EMPTY)
    setEditing('new')
  }

  const startEdit = (rig: RigInfo) => {
    setDraft({
      name: rig.name,
      type: rig.type,
      focalMm: rig.focalMm === null ? '' : String(rig.focalMm),
      apertureF: rig.apertureF === null ? '' : String(rig.apertureF),
      device: rig.device ?? '',
      notes: rig.notes ?? ''
    })
    setEditing(rig)
  }

  const save = async () => {
    const name = draft.name.trim()
    if (!name) {
      pushToast('请填写器材名称', 'error')
      return
    }
    const patch: RigPatch = {
      id: editing !== 'new' && editing ? editing.id : undefined,
      name,
      type: draft.type.trim(),
      focalMm: draft.focalMm.trim() === '' ? null : Number(draft.focalMm),
      apertureF: draft.apertureF.trim() === '' ? null : Number(draft.apertureF),
      device: draft.device,
      notes: draft.notes.trim()
    }
    setBusy(true)
    const res = await api.saveRig(patch)
    setBusy(false)
    if (!res.ok) {
      pushToast(res.error ?? '保存器材失败', 'error')
      return
    }
    pushToast(editing === 'new' ? '已添加器材' : '器材已更新', 'ok')
    setEditing(null)
    load()
    onChanged()
  }

  return (
    <div
      className="modal-mask"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div className="modal rig-modal" role="dialog" aria-modal>
        <div className="modal-head">
          <b>器材库</b>
          <span>夜次参与器材按成片设备自动匹配，也可在夜次记录里手工补充；统计随拍摄记录更新。</span>
        </div>

        {!rigs ? (
          <div className="empty">正在读取器材…</div>
        ) : rigs.length === 0 ? (
          <div className="empty">还没有器材，先新增一套吧。</div>
        ) : (
          <div className="rig-list">
            {rigs.map((rig) => (
              <div className="rig-card" key={rig.id}>
                <div className="rig-card-head">
                  <b>{rig.name}</b>
                  <span className="rig-type">{rig.type || '未分类'}</span>
                  <button className="mini-link" onClick={() => startEdit(rig)}>
                    编辑
                  </button>
                </div>
                <div className="rig-spec">
                  <span>{rig.focalMm === null ? '焦距 —' : `${rig.focalMm} mm`}</span>
                  <span>{rig.apertureF === null ? '光圈 —' : `f/${rig.apertureF}`}</span>
                  <span>{deviceLabel(rig.device)}</span>
                </div>
                <div className="rig-stats">
                  <span>{rig.nights} 个夜次</span>
                  <span>{rig.targets} 个目标</span>
                  <span>累计 {durationLabel(rig.exposureS)}</span>
                  <span>最近 {rig.lastUsed || '—'}</span>
                </div>
                {rig.notes && <div className="rig-notes">{rig.notes}</div>}
              </div>
            ))}
          </div>
        )}

        {editing && (
          <div className="rig-form">
            <div className="mg-grid">
              <label className="mg-field">
                <span>名称</span>
                <input
                  className="input"
                  value={draft.name}
                  onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                  spellCheck={false}
                />
              </label>
              <label className="mg-field">
                <span>类型</span>
                <input
                  className="input"
                  value={draft.type}
                  onChange={(e) => setDraft((p) => ({ ...p, type: e.target.value }))}
                  placeholder="一体式 / 广角星野组合"
                  spellCheck={false}
                />
              </label>
              <label className="mg-field">
                <span>焦距（mm）</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={draft.focalMm}
                  onChange={(e) => setDraft((p) => ({ ...p, focalMm: e.target.value }))}
                />
              </label>
              <label className="mg-field">
                <span>光圈</span>
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  min={0}
                  value={draft.apertureF}
                  onChange={(e) => setDraft((p) => ({ ...p, apertureF: e.target.value }))}
                />
              </label>
              <label className="mg-field">
                <span>自动关联设备</span>
                <select
                  className="input"
                  value={draft.device}
                  onChange={(e) => setDraft((p) => ({ ...p, device: e.target.value }))}
                >
                  {DEVICE_OPTIONS.map((o) => (
                    <option value={o.value} key={o.value || 'none'}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mg-field wide">
                <span>备注</span>
                <textarea
                  className="input area"
                  rows={3}
                  value={draft.notes}
                  onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))}
                />
              </label>
            </div>
            <div className="rig-form-foot">
              <button className="btn ghost sm" onClick={() => setEditing(null)} disabled={busy}>
                取消
              </button>
              <button className="btn primary sm" onClick={save} disabled={busy}>
                {busy ? '保存中…' : '保存器材'}
              </button>
            </div>
          </div>
        )}

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>
            关闭
          </button>
          <button className="btn primary" onClick={startNew}>
            新增器材
          </button>
        </div>
      </div>
    </div>
  )
}
