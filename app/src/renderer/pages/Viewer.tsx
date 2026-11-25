import { useEffect, useState } from 'react'
import api from '../api'
import { Icon } from '../components/Icons'
import { bytesLabel, deviceLabel, exposureLabel, shortDate, timeOf } from '../util'
import type { ShotDetail, ShotPatch } from '../types'

interface ViewerProps {
  shotId: number
  onClose: () => void
  onOpenShot: (id: number) => void
  onChanged: () => void
  pushToast: (message: string, kind?: 'info' | 'error' | 'ok') => void
}

export function Viewer({ shotId, onClose, onOpenShot, onChanged, pushToast }: ViewerProps) {
  const [data, setData] = useState<ShotDetail | null>(null)
  const [rating, setRating] = useState(0)
  const [notes, setNotes] = useState('')
  const [pinned, setPinned] = useState(false)
  const [cover, setCover] = useState(false)
  const [dirtyNotes, setDirtyNotes] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    setData(null)
    api
      .shotDetail(shotId)
      .then((d) => {
        if (alive) setData(d)
      })
      .catch(() => {
        if (alive) setData(null)
      })
    return () => {
      alive = false
    }
  }, [shotId])

  useEffect(() => {
    if (!data) return
    setRating(data.shot.rating)
    setNotes(data.shot.notes ?? '')
    setPinned(data.shot.isPinned)
    setCover(data.shot.isCover)
    setDirtyNotes(false)
  }, [data])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (!data) return
      const { film, index } = data.context
      if (e.key === 'ArrowLeft' && index > 0) onOpenShot(film[index - 1].id)
      if (e.key === 'ArrowRight' && index < film.length - 1) onOpenShot(film[index + 1].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [data, onClose, onOpenShot])

  const reveal = async () => {
    const res = await api.revealShot(shotId)
    if (!res.ok) pushToast(res.error ?? '定位失败', 'error')
  }

  const openFolder = async () => {
    const nightId = data?.nightId
    const res = nightId ? await api.openNightFolder(nightId) : { ok: false, error: '该照片没有关联夜次文件夹' }
    if (!res.ok) pushToast(res.error ?? '打开失败', 'error')
  }

  const save = async (patch: ShotPatch, message: string) => {
    setSaving(true)
    try {
      const res = await api.updateShots([shotId], patch)
      if (!res.ok) {
        pushToast(res.error ?? '保存失败', 'error')
        return false
      }
      const next = await api.shotDetail(shotId)
      if (next) setData(next)
      pushToast(message, 'ok')
      onChanged()
      return true
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="viewer-shell">
      <div className="viewer-top">
        <button className="btn ghost sm" onClick={onClose}>
          <Icon name="back" size={12} />
          返回
        </button>
        <div className="viewer-title">
          <b>{data?.context.title ?? '读取中…'}</b>
          <span>{data?.shot.fileName ?? ''}</span>
        </div>
        <div className="tb-right">
          <button className="btn ghost sm" onClick={openFolder}>
            <Icon name="folder" size={12} />
            打开文件夹
          </button>
          <button className="btn sm" onClick={reveal}>
            在资源管理器中定位
          </button>
          <button className="icon-btn" onClick={onClose} title="关闭 (Esc)">
            <Icon name="close" />
          </button>
        </div>
      </div>

      <div className="viewer-body">
        <div className="stage">
          {data ? (
            <img src={data.shot.fileUrl} alt={data.shot.fileName} />
          ) : (
            <div className="stage-empty">正在加载图片…</div>
          )}
        </div>

        <aside className="drawer">
          <div className="dh">
            <b>文件信息</b>
            <span>{data?.context.subtitle ?? ''}</span>
          </div>
          {data && (
            <>
              <Field k="文件名" v={data.shot.fileName} mono />
              <Field k="尺寸" v={data.shot.width && data.shot.height ? `${data.shot.width} × ${data.shot.height}` : null} />
              <Field k="文件大小" v={data.shot.bytes ? bytesLabel(data.shot.bytes) : null} />
              <Field
                k="拍摄时间"
                v={data.shot.capturedAt ? `${shortDate(data.shot.capturedAt)} ${timeOf(data.shot.capturedAt)}` : null}
              />
              <Field k="设备" v={deviceLabel(data.shot.device)} />
              <Field k="相机" v={data.shot.cameraModel} />
              <Field k="镜头" v={data.shot.lens} />
              <Field k="单帧曝光" v={data.shot.exposureS ? exposureLabel(data.shot.exposureS, 0) : null} />
              <Field k="ISO" v={data.shot.iso ? String(data.shot.iso) : null} />
              <Field k="光圈" v={data.shot.fNumber ? `f/${data.shot.fNumber}` : null} />
              <Field k="原始帧" v={data.shot.frameCount ? `${data.shot.frameCount} 帧` : null} />
              <Field k="累计曝光" v={data.shot.totalExposureS ? exposureLabel(data.shot.totalExposureS, 0) : null} />
              <Field k="拍摄地点" v={data.shot.location} />
              <Field k="分类" v={data.shot.subType ?? '深空'} />
              <div className="edit-block">
              <div className="fld">
                <div className="k">评分</div>
                <div className="v edit-stars">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      className={`star-btn ${n <= rating ? 'on' : ''}`}
                      disabled={saving}
                      title={rating === n ? '再点一次清除评分' : `评 ${n} 星`}
                      onClick={() => save({ rating: rating === n ? 0 : n }, rating === n ? '已清除评分' : `已评 ${n} 星`)}
                    >
                      ★
                    </button>
                  ))}
                  <span className="star-hint">{rating ? `${rating} 星` : '未评分'}</span>
                </div>
              </div>
              <div className="fld">
                <div className="k">标记</div>
                <div className="v edit-toggles">
                  <button
                    className={`chip ${pinned ? 'on' : ''}`}
                    disabled={saving}
                    onClick={() => save({ isPinned: !pinned }, pinned ? '已取消置顶' : '已置顶')}
                  >
                    <Icon name="pin" size={11} />
                    {pinned ? '已置顶' : '置顶'}
                  </button>
                  {data.targetId && (
                    <button
                      className={`chip ${cover ? 'on' : ''}`}
                      disabled={saving || cover}
                      onClick={() => save({ cover: true }, '已设为目标代表图')}
                    >
                      {cover ? '当前代表图' : '设为代表图'}
                    </button>
                  )}
                </div>
              </div>
              <div className="fld">
                <div className="k">备注</div>
                <div className="v">
                  <textarea
                    className="notes-input"
                    rows={3}
                    value={notes}
                    placeholder="记录处理思路、参数或当时的想法…"
                    disabled={saving}
                    onChange={(e) => {
                      setNotes(e.target.value)
                      setDirtyNotes(true)
                    }}
                  />
                  {dirtyNotes && (
                    <div className="notes-actions">
                      <button
                        className="btn ghost sm"
                        disabled={saving}
                        onClick={() => {
                          setNotes(data.shot.notes ?? '')
                          setDirtyNotes(false)
                        }}
                      >
                        还原
                      </button>
                      <button
                        className="btn sm"
                        disabled={saving}
                        onClick={() => save({ notes }, '备注已保存').then((ok) => ok && setDirtyNotes(false))}
                      >
                        保存备注
                      </button>
                    </div>
                  )}
                </div>
              </div>
              </div>
              <div className="dfoot">
                <button className="btn ghost sm" onClick={reveal}>
                  定位文件
                </button>
                <button className="btn sm" onClick={openFolder}>
                  打开文件夹
                </button>
              </div>
            </>
          )}
          {!data && <div className="empty-line">读取中…</div>}
        </aside>
      </div>

      {data && (
        <div className="filmstrip">
          <div className="film-label">本夜次</div>
          <div className="film-row">
            {data.context.film.map((f) => (
              <button
                key={f.id}
                className={`film-item ${f.id === shotId ? 'cur' : ''}`}
                style={{ ['--ar' as string]: f.ar }}
                onClick={() => onOpenShot(f.id)}
                title={f.fileName}
              >
                <img src={f.thumbUrl} alt={f.fileName} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ k, v, mono }: { k: string; v: string | null | undefined; mono?: boolean }) {
  return (
    <div className="fld">
      <div className="k">{k}</div>
      <div className={`v ${v ? '' : 'miss'} ${mono ? 'mono' : ''}`}>{v || '未记录'}</div>
    </div>
  )
}
