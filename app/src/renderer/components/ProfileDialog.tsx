import { useState } from 'react'
import type { TargetProfilePatch } from '../types'

export interface ProfileDraft {
  nameEn: string
  alias: string
  objectType: string
  constellation: string
  distanceLy: string
  magnitude: string
  description: string
}

interface ProfileDialogProps {
  initial: ProfileDraft
  busy?: boolean
  onCancel: () => void
  onConfirm: (patch: TargetProfilePatch) => void
}

export function ProfileDialog({ initial, busy, onCancel, onConfirm }: ProfileDialogProps) {
  const [draft, setDraft] = useState<ProfileDraft>(initial)
  const set = (key: keyof ProfileDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft((prev) => ({ ...prev, [key]: e.target.value }))

  const save = () => {
    onConfirm({
      nameEn: draft.nameEn.trim(),
      alias: draft.alias.trim(),
      objectType: draft.objectType.trim(),
      constellation: draft.constellation.trim(),
      distanceLy: draft.distanceLy.trim() === '' ? null : Number(draft.distanceLy),
      magnitude: draft.magnitude.trim() === '' ? null : Number(draft.magnitude),
      description: draft.description.trim()
    })
  }

  return (
    <div
      className="modal-mask"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
    >
      <div className="modal profile-modal" role="dialog" aria-modal>
        <div className="modal-head">
          <b>编辑天体名片</b>
          <span>保存后标记为手工资料，重新扫描不会覆盖。</span>
        </div>
        <div className="mg-grid">
          <label className="mg-field">
            <span>英文名</span>
            <input className="input" value={draft.nameEn} onChange={set('nameEn')} spellCheck={false} />
          </label>
          <label className="mg-field">
            <span>中文圈俗称</span>
            <input className="input" value={draft.alias} onChange={set('alias')} spellCheck={false} />
          </label>
          <label className="mg-field">
            <span>类型</span>
            <input className="input" value={draft.objectType} onChange={set('objectType')} spellCheck={false} />
          </label>
          <label className="mg-field">
            <span>星座</span>
            <input className="input" value={draft.constellation} onChange={set('constellation')} spellCheck={false} />
          </label>
          <label className="mg-field">
            <span>距离（光年）</span>
            <input className="input" type="number" min={0} value={draft.distanceLy} onChange={set('distanceLy')} />
          </label>
          <label className="mg-field">
            <span>视星等</span>
            <input className="input" type="number" step="0.1" min={0} value={draft.magnitude} onChange={set('magnitude')} />
          </label>
          <label className="mg-field wide">
            <span>简介</span>
            <textarea className="input area" rows={5} value={draft.description} onChange={set('description')} />
          </label>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? '保存中…' : '保存名片'}
          </button>
        </div>
      </div>
    </div>
  )
}
