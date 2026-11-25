import { useEffect, useRef, useState } from 'react'

interface EditDialogProps {
  title: string
  hint: string
  label: string
  initial: string
  busy?: boolean
  confirmText?: string
  multiline?: boolean
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function EditDialog({
  title,
  hint,
  label,
  initial,
  busy,
  confirmText = '保存并重命名',
  multiline,
  onConfirm,
  onCancel
}: EditDialogProps) {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = multiline ? areaRef.current : inputRef.current
    el?.focus()
    el?.select()
  }, [multiline])

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-modal>
        <div className="modal-head">
          <b>{title}</b>
          <span>{hint}</span>
        </div>
        <label className="modal-label">{label}</label>
        {multiline ? (
          <textarea
            ref={areaRef}
            className="input area"
            rows={4}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onCancel()
            }}
          />
        ) : (
          <input
            ref={inputRef}
            className="input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value.trim()) onConfirm(value.trim())
              if (e.key === 'Escape') onCancel()
            }}
          />
        )}
        <div className="modal-foot">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button className="btn primary" onClick={() => onConfirm(value.trim())} disabled={busy || !value.trim()}>
            {busy ? '处理中…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
