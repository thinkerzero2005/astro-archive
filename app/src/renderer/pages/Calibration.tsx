import { useEffect, useState } from 'react'
import api from '../api'
import { Icon } from '../components/Icons'
import { bytesLabel, shortDate } from '../util'
import type { CalibrationData } from '../types'

interface CalibrationProps {
  refreshKey: string
  pushToast: (message: string, kind?: 'info' | 'error' | 'ok') => void
}

function openTo(pushToast: CalibrationProps['pushToast'], key: string) {
  api
    .calibOpen(key)
    .then((res) => {
      if (!res.ok) pushToast(res.error ?? '打开文件夹失败', 'error')
    })
    .catch((err) => pushToast(`打开文件夹失败：${(err as Error).message}`, 'error'))
}

/** 设备时钟可能跑偏（出现过 2037 年的文件时间），未来时间不直接展示 */
function updatedLabel(iso: string | null) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  if (t > Date.now() + 86400000) return ' · 设备时间异常'
  return ` · 最近 ${shortDate(iso)}`
}

export function Calibration({ refreshKey, pushToast }: CalibrationProps) {
  const [data, setData] = useState<CalibrationData | null>(null)

  useEffect(() => {
    api
      .calibGet()
      .then((d) => setData(d))
      .catch(() => setData(null))
  }, [refreshKey])

  if (!data) {
    return (
      <div className="empty">
        <b>正在读取校准场…</b>
      </div>
    )
  }

  const kinds = data.groups
  const dark = data.darkLibrary
  const maxDevice = Math.max(1, ...kinds.flatMap((g) => g.devices.map((d) => d.fileCount)), ...(dark?.devices ?? []).map((d) => d.fileCount))

  return (
    <>
      <div className="page-head">
        <div>
          <div className="ph-t">Calibration</div>
          <h3>
            校准场<span>bias / dark / flat 与暗场库的本地库存</span>
          </h3>
        </div>
        <div className="acts">
          <span className="pill mute">
            <i />
            共 {data.totalFiles} 个文件 · {bytesLabel(data.totalBytes)}
          </span>
          <button className="btn ghost sm" onClick={() => openTo(pushToast, 'root')} disabled={!data.exists}>
            <Icon name="folder" size={12} />
            打开校准场目录
          </button>
        </div>
      </div>

      {!data.exists ? (
        <div className="empty">
          <b>素材库里还没有 {`_dwarf mini校准场`} 目录</b>
          <span>从 Dwarf 同步校准场后会自动出现在这里。</span>
        </div>
      ) : (
        <>
          <div className="stats">
            {kinds.map((group) => (
              <div
                className="stat calib-card"
                key={group.key}
                title={group.label}
                onClick={() => openTo(pushToast, group.key)}
              >
                <div className="k">{group.label}</div>
                <div className="v">{group.fileCount}</div>
                <div className="d">
                  {bytesLabel(group.bytes)}
                  {updatedLabel(group.updatedAt)}
                </div>
              </div>
            ))}
            <div className="stat calib-card" title="暗场库" onClick={() => openTo(pushToast, 'darklib')}>
              <div className="k">暗场库 Dark Library</div>
              <div className="v">{dark?.fileCount ?? 0}</div>
              <div className="d">
                {dark ? bytesLabel(dark.bytes) : '尚未同步'}
                {dark ? updatedLabel(dark.updatedAt) : ''}
              </div>
            </div>
          </div>

          <div className="block-grid">
            <div className="block">
              <div className="block-head">
                <div className="t">
                  设备分布 <em>按相机 / 增益分组</em>
                </div>
                <span className="pill mute">{data.path}</span>
              </div>
              {kinds.every((g) => !g.devices.length) ? (
                <div className="empty-line">还没有校准帧。</div>
              ) : (
                kinds.map((group) =>
                  group.devices.length ? (
                    <div className="calib-group" key={group.key}>
                      <div className="calib-group-head">
                        <b>{group.label}</b>
                        <span>
                          {group.fileCount} 个 · {bytesLabel(group.bytes)}
                        </span>
                      </div>
                      <div className="dist">
                        {group.devices.map((device) => (
                          <div className="dist-row" key={device.name} title={device.name}>
                            <span className="dn">{device.name}</span>
                            <div className="db">
                              <i style={{ width: `${Math.max(4, Math.round((device.fileCount / maxDevice) * 100))}%` }} />
                            </div>
                            <b>{device.fileCount}</b>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null
                )
              )}
            </div>

            <div className="block">
              <div className="block-head">
                <div className="t">
                  暗场库 <em>DWARF_DARK · 只保留首次拷贝</em>
                </div>
                <button className="link" onClick={() => openTo(pushToast, 'darklib')} disabled={!dark}>
                  打开
                </button>
              </div>
              {dark && dark.devices.length ? (
                <div className="dist">
                  {dark.devices.map((device) => (
                    <div className="dist-row" key={device.name} title={device.name}>
                      <span className="dn">{device.name}</span>
                      <div className="db">
                        <i style={{ width: `${Math.max(4, Math.round((device.fileCount / maxDevice) * 100))}%` }} />
                      </div>
                      <b>{device.fileCount}</b>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-line">还没有暗场库文件。设备首次同步时才会拷入。</div>
              )}
              <p className="calib-note">
                bias / dark / flat 按会话增量同步；暗场库是按曝光和增益分目录的长期素材，只在素材库里没有对应文件时拷贝一次，避免重复占空间。
              </p>
            </div>
          </div>
        </>
      )}
    </>
  )
}
