import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../api'
import { Icon } from './Icons'
import { bytesLabel } from '../util'
import type { SyncCalibrationItem, SyncPreview, SyncSessionItem, SyncTargetOverride } from '../types'

interface SyncDialogProps {
  onClose: () => void
  onDone: () => void
  pushToast: (message: string, kind?: 'info' | 'error' | 'ok') => void
}

const STATUS_LABEL: Record<string, string> = {
  new: '新增',
  partial: '部分',
  synced: '已同步',
  skip: '跳过',
  unresolved: '待指定'
}

function selectable(status: string) {
  return status === 'new' || status === 'partial'
}

export function SyncDialog({ onClose, onDone, pushToast }: SyncDialogProps) {
  const [source, setSource] = useState('')
  const [preview, setPreview] = useState<SyncPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, { catalogId: string; nameCn: string }>>({})
  const [sessionChecks, setSessionChecks] = useState<Record<string, boolean>>({})
  const [calibChecks, setCalibChecks] = useState<Record<string, boolean>>({})
  const [makeDeleteList, setMakeDeleteList] = useState(true)
  const [running, setRunning] = useState(false)
  const [lastSource, setLastSource] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const runningRef = useRef(false)
  const requestId = useRef(0)

  const load = useCallback(async (src: string, editState: Record<string, { catalogId: string; nameCn: string }>) => {
    const id = ++requestId.current
    setLoading(true)
    setLoadError(null)
    const overrides: SyncTargetOverride[] = Object.entries(editState).map(([sessionRel, value]) => ({
      sessionRel,
      catalogId: value.catalogId || null,
      nameCn: value.nameCn || null
    }))
    try {
      const res = await api.syncPreview(src, overrides)
      if (id !== requestId.current) return
      setPreview(res)
      if (!res.ok) setLoadError(res.error ?? '读取同步源失败')
      setSessionChecks((prev) => {
        const next = { ...prev }
        for (const session of res.sessions) {
          if (!(session.sessionRel in next)) next[session.sessionRel] = selectable(session.status)
        }
        return next
      })
      setCalibChecks((prev) => {
        const next = { ...prev }
        for (const group of res.calibrations) {
          if (!(group.key in next)) next[group.key] = selectable(group.status)
        }
        return next
      })
    } catch (err) {
      if (id !== requestId.current) return
      setLoadError((err as Error).message)
      setPreview(null)
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!source) return
    const timer = window.setTimeout(() => {
      void load(source, edits)
    }, 240)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, JSON.stringify(edits)])

  useEffect(() => {
    api
      .settingsInfo()
      .then((info) => {
        if (info.syncSource && info.syncSourceExists) setLastSource(info.syncSource)
      })
      .catch(() => {
        /* 记不住上次设备也不影响手动选目录 */
      })
  }, [])

  useEffect(() => {
    const off = api.onSyncProgress((p) => {
      if (p.phase === 'copy') setProgress({ done: p.done, total: p.total })
    })
    return off
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !runningRef.current) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const pickSource = async () => {
    if (running) return
    try {
      const res = await api.syncPickSource()
      if (!res.ok || !res.path) return
      setSource(res.path)
      setPreview(null)
      setLoading(true)
      setEdits({})
      setSessionChecks({})
      setCalibChecks({})
    } catch (err) {
      pushToast(`选择目录失败：${(err as Error).message}`, 'error')
    }
  }

  const sessions = preview?.sessions ?? []
  const calibrations = preview?.calibrations ?? []
  const selectableSessions = sessions.filter((s) => selectable(s.status))
  const selectableCalib = calibrations.filter((c) => selectable(c.status))
  const selectedSessions = selectableSessions.filter((s) => sessionChecks[s.sessionRel])
  const selectedCalib = selectableCalib.filter((c) => calibChecks[c.key])

  const chosenCount = selectedSessions.length + selectedCalib.length
  const selectableCount = selectableSessions.length + selectableCalib.length
  const allChecked = selectableCount > 0 && chosenCount === selectableCount
  const pendingBytes =
    selectedSessions.reduce((sum, s) => sum + s.pendingBytes, 0) +
    selectedCalib.reduce((sum, c) => sum + c.pendingBytes, 0)

  const toggleAll = () => {
    const next = !allChecked
    setSessionChecks((prev) => {
      const out = { ...prev }
      for (const session of selectableSessions) out[session.sessionRel] = next
      return out
    })
    setCalibChecks((prev) => {
      const out = { ...prev }
      for (const group of selectableCalib) out[group.key] = next
      return out
    })
  }

  const patchRow = (session: SyncSessionItem, field: 'catalogId' | 'nameCn', value: string) => {
    setEdits((prev) => {
      const current = prev[session.sessionRel] ?? {
        catalogId: session.targetCatalog ?? '',
        nameCn: session.targetName ?? ''
      }
      return { ...prev, [session.sessionRel]: { ...current, [field]: value } }
    })
    if (field === 'catalogId' && value.trim()) {
      setSessionChecks((prev) => ({ ...prev, [session.sessionRel]: true }))
    }
  }

  const run = async () => {
    if (!preview?.ok || running || !chosenCount) return
    setRunning(true)
    runningRef.current = true
    setProgress({ done: 0, total: 0 })
    try {
      const res = await api.syncRun(source, {
        sessions: selectedSessions.map((s) => s.sessionRel),
        calibrations: selectedCalib.map((c) => c.key),
        overrides: Object.entries(edits).map(([sessionRel, value]) => ({
          sessionRel,
          catalogId: value.catalogId || null,
          nameCn: value.nameCn || null
        })),
        makeDeleteList
      })
      if (res.copied > 0) {
        pushToast(
          res.errors.length
            ? `已同步 ${res.copied} 个文件，${res.errors.length} 个未成功`
            : `已同步 ${res.copied} 个文件，可在顶栏「撤销」整批删除副本`,
          res.errors.length ? 'info' : 'ok'
        )
        onDone()
        onClose()
        return
      }
      pushToast(res.error ?? res.errors[0] ?? '没有文件需要同步', 'error')
    } catch (err) {
      pushToast(`同步失败：${(err as Error).message}`, 'error')
    } finally {
      setRunning(false)
      runningRef.current = false
      setProgress(null)
    }
  }

  const progressText = progress && progress.total > 0 ? `${progress.done} / ${progress.total}` : '正在准备…'
  const progressPercent = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 4

  return (
    <div
      className="modal-mask"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !running) onClose()
      }}
    >
      <div className="modal import-modal sync-modal" role="dialog" aria-modal>
        <div className="import-head">
          <div className="import-title">
            <b>从 Dwarf 同步</b>
            <span>
              {source
                ? preview?.astronomyPath ?? source
                : '选择设备上的 Astronomy 目录，或直接选盘符根目录'}
            </span>
          </div>
          <div className="import-head-acts">
            <button className="btn ghost sm" onClick={pickSource} disabled={running}>
              <Icon name="folder" size={12} />
              {source ? '重新选择目录' : '选择设备目录'}
            </button>
            <button
              className="btn ghost sm"
              onClick={() => source && load(source, edits)}
              disabled={!source || loading || running}
            >
              <Icon name="sync" size={12} />
              刷新
            </button>
            <button className="icon-btn" onClick={onClose} disabled={running} title="关闭">
              <Icon name="close" size={14} />
            </button>
          </div>
        </div>

        {!source ? (
          <div className="import-list">
            <div className="sync-pick">
              <p>把 Dwarf 用 USB 连到电脑，选中设备里的 Astronomy 文件夹即可预览增量。</p>
              <div className="sync-pick-acts">
                <button className="btn primary" onClick={pickSource}>
                  <Icon name="folder" size={13} />
                  选择 Dwarf 设备目录
                </button>
                {lastSource && (
                  <button
                    className="btn ghost"
                    onClick={() => {
                      setSource(lastSource)
                      setPreview(null)
                      setLoading(true)
                      setEdits({})
                      setSessionChecks({})
                      setCalibChecks({})
                    }}
                  >
                    <Icon name="sync" size={13} />
                    使用上次设备 {lastSource}
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="import-toolbar">
              <label className="import-check">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} disabled={!selectableCount || running} />
                全选
              </label>
              <span className="import-count">
                已选 {selectedSessions.length} 场 · {selectedCalib.length} 组校准
              </span>
              <span className="import-hint">只拷新增文件，重复内容按「会话路径 + 文件大小」自动跳过</span>
            </div>

            <div className="import-list">
              {loading && !preview ? (
                <div className="import-empty">正在读取设备目录…</div>
              ) : loadError ? (
                <div className="import-empty error">{loadError}</div>
              ) : !sessions.length && !calibrations.length ? (
                <div className="import-empty">这个目录里没有识别到会话或校准场。</div>
              ) : (
                <>
                  {sessions.length > 0 && <div className="sync-group">深空会话</div>}
                  {sessions.map((session) => {
                    const can = selectable(session.status)
                    const value = edits[session.sessionRel]
                    return (
                      <div
                        className={`import-row sync-row ${sessionChecks[session.sessionRel] && can ? '' : 'off'}`}
                        key={session.sessionRel}
                      >
                        <input
                          type="checkbox"
                          className="import-box"
                          checked={!!sessionChecks[session.sessionRel] && can}
                          disabled={!can || running}
                          onChange={(e) =>
                            setSessionChecks((prev) => ({ ...prev, [session.sessionRel]: e.target.checked }))
                          }
                        />
                        <div className="import-file">
                          <b title={session.sessionRel}>{session.sessionName}</b>
                          <span>
                            {session.date ?? '日期未知'} · {session.frameCount} 帧 · {session.fileCount} 个文件 ·{' '}
                            {bytesLabel(session.bytes)}
                            {session.pendingBytes > 0 && session.status !== 'synced'
                              ? ` · 待拷 ${bytesLabel(session.pendingBytes)}`
                              : ''}
                            {session.reason ? ` · ${session.reason}` : ''}
                          </span>
                          <div className="import-dest" title={session.targetFolderRel ?? ''}>
                            <Icon name="folder" size={10} />
                            <span className="path">{session.targetFolderRel ?? '未识别目标，请在右侧填写编号'}</span>
                          </div>
                        </div>
                        <div className="import-fields sync-fields">
                          <input
                            value={value?.catalogId ?? session.targetCatalog ?? ''}
                            placeholder="目标编号"
                            spellCheck={false}
                            disabled={running}
                            onChange={(e) => patchRow(session, 'catalogId', e.target.value)}
                          />
                          <input
                            value={value?.nameCn ?? session.targetName ?? ''}
                            placeholder="中文名"
                            disabled={running}
                            onChange={(e) => patchRow(session, 'nameCn', e.target.value)}
                          />
                        </div>
                        <span className={`sync-status ${session.status}`}>{STATUS_LABEL[session.status]}</span>
                      </div>
                    )
                  })}

                  {calibrations.length > 0 && <div className="sync-group">校准场</div>}
                  {calibrations.map((group: SyncCalibrationItem) => {
                    const can = selectable(group.status)
                    return (
                      <div
                        className={`import-row sync-row ${calibChecks[group.key] && can ? '' : 'off'}`}
                        key={group.key}
                      >
                        <input
                          type="checkbox"
                          className="import-box"
                          checked={!!calibChecks[group.key] && can}
                          disabled={!can || running}
                          onChange={(e) => setCalibChecks((prev) => ({ ...prev, [group.key]: e.target.checked }))}
                        />
                        <div className="import-file">
                          <b>{group.label}</b>
                          <span>
                            {group.fileCount} 个文件 · {bytesLabel(group.bytes)}
                            {group.pendingBytes > 0 && group.status !== 'synced'
                              ? ` · 待拷 ${bytesLabel(group.pendingBytes)}`
                              : ''}
                            {group.reason ? ` · ${group.reason}` : ''}
                          </span>
                          <div className="import-dest" title={group.destRel}>
                            <Icon name="folder" size={10} />
                            <span className="path">{group.destRel}</span>
                          </div>
                        </div>
                        <span className={`sync-status ${group.status}`}>{STATUS_LABEL[group.status]}</span>
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          </>
        )}

        {running && (
          <div className="sync-progress">
            <i style={{ width: `${Math.max(4, Math.min(100, progressPercent))}%` }} />
            <span>{progressText}</span>
          </div>
        )}

        <div className="import-foot">
          <label className="import-check sync-delete-opt">
            <input
              type="checkbox"
              checked={makeDeleteList}
              disabled={running}
              onChange={(e) => setMakeDeleteList(e.target.checked)}
            />
            生成可安全删除清单
          </label>
          <span className="import-foot-note">
            {chosenCount ? `将拷入 ${bytesLabel(pendingBytes)} 到素材库，设备原件不删除` : '勾选要同步的会话或校准场'}
          </span>
          <button className="btn ghost" onClick={onClose} disabled={running}>
            取消
          </button>
          <button className="btn primary" onClick={run} disabled={running || !chosenCount || !preview?.ok}>
            {running ? '正在同步…' : `开始同步 ${chosenCount ? `(${chosenCount})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
