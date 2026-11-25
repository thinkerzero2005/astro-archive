import { videoTimeLabel } from '../util'
import type { VideoItem } from '../types'
import { Icon } from './Icons'

interface VideoTileProps {
  video: VideoItem
  onOpen: (id: number) => void
}

export function VideoTile({ video, onOpen }: VideoTileProps) {
  return (
    <button
      className="shot video-tile hoverable"
      style={{ ['--ar' as string]: video.ar || 16 / 9 }}
      title={video.fileName}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(video.id)
      }}
    >
      <video src={`${video.fileUrl}#t=0.1`} preload="metadata" muted playsInline />
      <span className="vt-play">
        <Icon name="play" size={14} />
      </span>
      <div className="ph-cap">
        <span>{video.fileName.replace(/\.[^.]+$/, '')}</span>
        <span>{video.durationS > 0 ? videoTimeLabel(video.durationS) : '视频'}</span>
      </div>
    </button>
  )
}
