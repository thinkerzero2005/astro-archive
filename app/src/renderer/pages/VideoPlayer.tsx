import { useEffect, useState } from 'react'
import api from '../api'
import { Icon } from '../components/Icons'
import { bytesLabel, videoTimeLabel } from '../util'
import type { VideoDetail } from '../types'

interface VideoPlayerProps {
  videoId: number
  onClose: () => void
  pushToast: (message: string, kind?: 'info' | 'error' | 'ok') => void
}

export function VideoPlayer({ videoId, onClose, pushToast }: VideoPlayerProps) {
  const [data, setData] = useState<VideoDetail | null>(null)
  const [meta, setMeta] = useState<{ width: number; height: number; duration: number } | null>(null)

  useEffect(() => {
    let alive = true
    setData(null)
    setMeta(null)
    api
      .videoDetail(videoId)
      .then((d) => {
        if (alive) setData(d)
      })
      .catch(() => {
        if (alive) setData(null)
      })
    return () => {
      alive = false
    }
  }, [videoId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const reveal = async () => {
    const res = await api.revealVideo(videoId)
    if (!res.ok) pushToast(res.error ?? '定位失败', 'error')
  }

  const openFolder = async () => {
    const nightId = data?.nightId
    const res = nightId ? await api.openNightFolder(nightId) : { ok: false, error: '该视频没有关联夜次文件夹' }
    if (!res.ok) pushToast(res.error ?? '打开失败', 'error')
  }

  const width = meta?.width ?? data?.video.width ?? null
  const height = meta?.height ?? data?.video.height ?? null
  const durationS = meta?.duration ?? data?.video.durationS ?? 0

  return (
    <div className="viewer-shell">
      <div className="viewer-top">
        <button className="btn ghost sm" onClick={onClose}>
          <Icon name="back" size={12} />
          返回
        </button>
        <div className="viewer-title">
          <b>{data?.context.title ?? '读取中…'}</b>
          <span>{data?.video.fileName ?? ''}</span>
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
            <video
              className="video-stage"
              src={data.video.fileUrl}
              controls
              autoPlay
              playsInline
              onLoadedMetadata={(e) => {
                const el = e.currentTarget
                setMeta({ width: el.videoWidth, height: el.videoHeight, duration: el.duration })
              }}
            />
          ) : (
            <div className="stage-empty">正在加载视频…</div>
          )}
        </div>

        <aside className="drawer">
          <div className="dh">
            <b>视频信息</b>
            <span>{data?.context.subtitle ?? ''}</span>
          </div>
          {data && (
            <>
              <Field k="文件名" v={data.video.fileName} mono />
              <Field k="时长" v={durationS > 0 ? videoTimeLabel(durationS) : null} />
              <Field k="文件大小" v={data.video.bytes ? bytesLabel(data.video.bytes) : null} />
              <Field k="分辨率" v={width && height ? `${width} × ${height}` : null} />
              <Field k="帧率" v={data.video.fps ? `${Number(data.video.fps).toFixed(1)} fps` : null} />
              <Field k="编码" v={data.video.codec} />
              <Field k="分类" v={data.context.title} />
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
