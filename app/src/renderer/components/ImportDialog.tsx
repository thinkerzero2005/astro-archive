import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '../api'
import { Icon } from './Icons'
import { bytesLabel } from '../util'
import type {
  InboxCategory,
  InboxDeferredItem,
  InboxFile,
  InboxPreview,
  InboxRecognition,
  InboxStageResult
} from '../types'

interface ImportDialogProps {
  onClose: () => void
  onDone: () => void
  pushToast: (message: string, kind?: 'info' | 'error' | 'ok') => void
}

interface Row extends InboxFile {
  checked: boolean
  category: InboxCategory | null
  code: string
  date: string
  location: string
}

const CATEGORIES: Array<{ value: InboxCategory; label: string }> = [
  { value: 'deep_sky', label: '深空' },
  { value: '银河', label: '银河' },
  { value: '星轨', label: '星轨' },
  { value: '延时', label: '延时' },
  { value: '其他', label: '其他' }
]

const DATE_SOURCE_LABEL: Record<string, string> = {
  name: '按文件名',
  folder: '按文件夹',
  exif: '按 EXIF',
  mtime: '按文件时间'
}

function previewOf(row: Row, previews: Record<string, InboxPreview>): InboxPreview {
  return (
    previews[row.relPath] ?? {
      relPath: row.relPath,
      destRel: row.destRel,
      valid: row.valid,
      error: row.error,
      conflict: row.conflict
    }
  )
}

const OCR_EXT_RE = /^\.(jpe?g|png|webp|avif)$/i

/** 低置信度或字段缺失都算待确认 */
function isPending(rec: InboxRecognition): boolean {
  return rec.hasBar && (rec.needsReview || rec.confidence < 60)
}

/** 只补空字段，不覆盖手工填写的内容 */
function suggestionFor(row: Row, rec: InboxRecognition | undefined): Partial<Row> | null {
  if (!rec || !rec.hasBar) return null
  const changes: Partial<Row> = {}
  let category = row.category
  if (!category && rec.catalogId) {
    category = 'deep_sky'
    changes.category = category
    changes.checked = true
  }
  if (category === 'deep_sky' && !row.code && rec.catalogId) changes.code = rec.catalogId
  if (!row.date && rec.nightDate) changes.date = rec.nightDate
  return Object.keys(changes).length ? changes : null
}

export function ImportDialog({ onClose, onDone, pushToast }: ImportDialogProps) {
  const [rows, setRows] = useState<Row[]>([])
  const [previews, setPreviews] = useState<Record<string, InboxPreview>>({})
  const [recognitions, setRecognitions] = useState<Record<string, InboxRecognition>>({})
  const [recognizing, setRecognizing] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [staging, setStaging] = useState<{ done: number; total: number; label: string } | null>(null)
  const [stageReport, setStageReport] = useState<InboxStageResult | null>(null)
  const [paused, setPaused] = useState<InboxDeferredItem[]>([])
  const [pausedOpen, setPausedOpen] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const importingRef = useRef(false)
  const stagingRef = useRef(false)
  const recogToken = useRef(0)

  const runRecognition = useCallback(async (targets: string[]) => {
    const token = ++recogToken.current
    if (!targets.length) {
      setRecognizing({})
      return
    }
    setRecognizing(Object.fromEntries(targets.map((p) => [p, true])))
    const CHUNK = 6
    for (let i = 0; i < targets.length; i += CHUNK) {
      const chunk = targets.slice(i, i + CHUNK)
      try {
        const res = await api.inboxRecognize(chunk)
        if (recogToken.current !== token) return
        setRecognitions((prev) => ({ ...prev, ...Object.fromEntries(res.map((r) => [r.relPath, r])) }))
      } catch {
        /* 单批失败不影响其它文件 */
      }
      if (recogToken.current !== token) return
      setRecognizing((prev) => {
        const next = { ...prev }
        for (const p of chunk) delete next[p]
        return next
      })
    }
  }, [])

  const loadPaused = useCallback(async () => {
    try {
      setPaused(await api.inboxPaused())
    } catch {
      /* 暂不整理读取失败不影响主列表 */
    }
  }, [])

  const stagePaths = useCallback(
    async (paths: string[]) => {
      if (!paths.length || stagingRef.current) return
      stagingRef.current = true
      setStaging({ done: 0, total: 0, label: '准备复制…' })
      setLoadError(null)
      try {
        const res = await api.inboxStage(paths)
        setStageReport(res.copied || res.skipped.length || res.errors.length ? res : null)
        if (res.copied > 0) {
          const extra = res.skipped.length ? `，跳过 ${res.skipped.length} 个重复或不支持的文件` : ''
          pushToast(`已复制 ${res.copied} 个文件到收件箱${extra}`, 'ok')
        } else if (res.errors.length) {
          pushToast(res.errors[0], 'error')
        } else {
          pushToast(
            res.skipped.length ? `没有新文件，跳过 ${res.skipped.length} 个重复或不支持的文件` : '没有可导入的文件',
            'info'
          )
        }
        await loadPaused()
        await load()
      } catch (err) {
        pushToast(`复制到收件箱失败：${(err as Error).message}`, 'error')
      } finally {
        setStaging(null)
        stagingRef.current = false
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pushToast, loadPaused]
  )

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await api.inboxList()
      const list: Row[] = res.files.map((file) => ({
        ...file,
        checked: file.category !== null,
        category: file.category,
        code: file.category === 'deep_sky' ? file.code ?? '' : '',
        date: file.date ?? '',
        location: file.location ?? ''
      }))
      setRows(list)
      setPreviews(
        Object.fromEntries(
          res.files.map((file) => [
            file.relPath,
            { relPath: file.relPath, destRel: file.destRel, valid: file.valid, error: file.error, conflict: file.conflict }
          ])
        )
      )
      setRecognitions({})
      setRecognizing({})
      void runRecognition(list.filter((r) => OCR_EXT_RE.test(r.ext)).map((r) => r.relPath))
      if (!res.ok) setLoadError(res.error ?? '读取收件箱失败')
    } catch (err) {
      setLoadError((err as Error).message)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [runRecognition])

  useEffect(() => {
    void load()
    void loadPaused()
  }, [load, loadPaused])

  useEffect(() => api.onInboxStageProgress((p) => setStaging(p)), [])

  const signature = useMemo(
    () => rows.map((r) => [r.relPath, r.category, r.date, r.code, r.location].join('\u0001')).join('\u0002'),
    [rows]
  )

  useEffect(() => {
    if (!signature) return
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.inboxPreview(
          rows.map((r) => ({
            relPath: r.relPath,
            category: r.category,
            date: r.date || null,
            code: r.code || null,
            location: r.location || null
          }))
        )
        setPreviews(Object.fromEntries(res.map((p) => [p.relPath, p])))
      } catch {
        /* 预览失败保留上一次结果 */
      }
    }, 220)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !importingRef.current) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const patch = (relPath: string, changes: Partial<Row>) => {
    setRows((prev) => prev.map((row) => (row.relPath === relPath ? { ...row, ...changes } : row)))
  }

  const allChecked = rows.length > 0 && rows.every((r) => r.checked)
  const checkedCount = rows.filter((r) => r.checked).length
  const importable = rows.filter((r) => r.checked && previewOf(r, previews).valid)
  const suggestionCount = rows.filter((r) => suggestionFor(r, recognitions[r.relPath])).length

  const applyOne = (relPath: string) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.relPath !== relPath) return row
        const changes = suggestionFor(row, recognitions[relPath])
        return changes ? { ...row, ...changes } : row
      })
    )
  }

  const applyAll = () => {
    setRows((prev) =>
      prev.map((row) => {
        const changes = suggestionFor(row, recognitions[row.relPath])
        return changes ? { ...row, ...changes } : row
      })
    )
  }

  const toggleAll = () => {
    const next = !allChecked
    setRows((prev) => prev.map((row) => ({ ...row, checked: next })))
  }

  const runImport = async () => {
    if (importing || !importable.length) return
    setImporting(true)
    importingRef.current = true
    try {
      const res = await api.inboxImport(
        importable.map((r) => ({
          relPath: r.relPath,
          category: r.category as InboxCategory,
          date: r.date || null,
          code: r.code || null,
          location: r.location || null
        }))
      )
      if (res.moved > 0) {
        pushToast(
          res.errors.length
            ? `已导入 ${res.moved} 个文件，${res.errors.length} 个未成功`
            : `已导入 ${res.moved} 个文件，可在顶栏「撤销」整批还原`,
          res.errors.length ? 'info' : 'ok'
        )
        onDone()
      } else {
        pushToast(res.errors[0] ?? '没有文件被导入', 'error')
      }
      if (res.errors.length && res.moved === 0) {
        setLoadError(res.errors[0])
        setImporting(false)
        importingRef.current = false
        return
      }
      onClose()
    } catch (err) {
      pushToast(`导入失败：${(err as Error).message}`, 'error')
    } finally {
      setImporting(false)
      importingRef.current = false
    }
  }

  const pickFolder = async () => {
    if (stagingRef.current) return
    const res = await api.inboxPickFolder()
    if (!res.ok || !res.path) return
    await stagePaths([res.path])
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDropActive(false)
    if (stagingRef.current || importing) return
    const files = Array.from(e.dataTransfer.files)
    const paths = files
      .map((file) => {
        try {
          return api.pathForFile(file)
        } catch {
          return ''
        }
      })
      .filter(Boolean)
    if (!paths.length) {
      pushToast('未读取到文件路径，请改用「导入文件夹」', 'error')
      return
    }
    await stagePaths(paths)
  }

  const deferOne = async (relPath: string) => {
    try {
      const res = await api.inboxDefer([relPath])
      if (res.moved > 0) {
        pushToast('已移到「暂不整理」，不参与统计', 'info')
        await load()
        await loadPaused()
      } else if (res.errors.length) {
        pushToast(res.errors[0], 'error')
      }
    } catch (err) {
      pushToast(`暂不整理失败：${(err as Error).message}`, 'error')
    }
  }

  const restoreFiles = async (relPaths: string[]) => {
    if (!relPaths.length) return
    try {
      const res = await api.inboxRestore(relPaths)
      if (res.moved > 0) {
        pushToast(`已移回 ${res.moved} 个文件到收件箱`, 'ok')
        await load()
        await loadPaused()
      } else if (res.errors.length) {
        pushToast(res.errors[0], 'error')
      }
    } catch (err) {
      pushToast(`移回失败：${(err as Error).message}`, 'error')
    }
  }

  const openInbox = async () => {
    const res = await api.openInbox()
    if (!res.ok) pushToast(res.error ?? '打开收件箱失败', 'error')
  }

  return (
    <div
      className="modal-mask"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !importing) onClose()
      }}
    >
      <div
        className="modal import-modal"
        role="dialog"
        aria-modal
        onDragOver={(e) => {
          e.preventDefault()
          if (!stagingRef.current) setDropActive(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropActive(false)
        }}
        onDrop={onDrop}
      >
        <div className="import-head">
          <div className="import-title">
            <b>导入收件箱</b>
            <span>
              {loading ? '正在读取…' : rows.length ? `发现 ${rows.length} 个待整理文件 · 移动前可核对归档位置` : '收件箱是空的'}
            </span>
          </div>
          <div className="import-head-acts">
            <button className="btn ghost sm" onClick={pickFolder} disabled={staging !== null || importing}>
              <Icon name="folder" size={12} />
              导入文件夹
            </button>
            <button className="btn ghost sm" onClick={openInbox}>
              <Icon name="folder" size={12} />
              打开收件箱
            </button>
            <button className="btn ghost sm" onClick={load} disabled={loading || importing}>
              <Icon name="sync" size={12} />
              刷新
            </button>
            <button className="icon-btn" onClick={onClose} disabled={importing || staging !== null} title="关闭">
              <Icon name="close" size={14} />
            </button>
          </div>
        </div>

        {staging && (
          <div className="import-stage">
            <span className="import-stage-text">
              正在复制到收件箱 {staging.done}/{staging.total || '…'} · {staging.label}
            </span>
            <span className="import-stage-bar">
              <i style={{ width: `${staging.total ? Math.round((staging.done / staging.total) * 100) : 0}%` }} />
            </span>
          </div>
        )}

        {stageReport && (
          <div className="import-report">
            <div className="import-report-head">
              <b>上次导入：复制 {stageReport.copied} 个</b>
              {stageReport.skipped.length > 0 && <span>跳过 {stageReport.skipped.length} 个</span>}
              {stageReport.errors.length > 0 && <span className="bad">失败 {stageReport.errors.length} 个</span>}
              <button className="link-btn" onClick={() => setStageReport(null)}>
                关闭
              </button>
            </div>
            {(stageReport.skipped.length > 0 || stageReport.errors.length > 0) && (
              <div className="import-report-list">
                {stageReport.errors.map((msg, i) => (
                  <span className="bad" key={`e${i}`}>
                    {msg}
                  </span>
                ))}
                {stageReport.skipped.map((item, i) => (
                  <span key={`s${i}`}>
                    {item.fileName || '未命名'}：{item.reason}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {rows.length > 0 && (
          <div className="import-toolbar">
            <label className="import-check">
              <input type="checkbox" checked={allChecked} onChange={toggleAll} />
              全选
            </label>
            <span className="import-count">
              已选 {checkedCount} · 可导入 {importable.length}
            </span>
            {suggestionCount > 0 && (
              <button className="btn ghost sm" onClick={applyAll} disabled={importing}>
                套用识别建议（{suggestionCount}）
              </button>
            )}
            <span className="import-hint">拖拽文件或文件夹到窗口即可复制进来，源文件不动</span>
          </div>
        )}

        <div className="import-toolbar">
          <button className="btn ghost sm" onClick={() => setPausedOpen((v) => !v)}>
            {pausedOpen ? '收起暂不整理' : `暂不整理（${paused.length}）`}
          </button>
          <span className="import-hint">暂不整理的文件不参与统计，可随时移回</span>
        </div>

        {pausedOpen && (
          <div className="import-paused">
            {paused.length === 0 ? (
              <div className="import-paused-empty">暂无暂不整理的文件</div>
            ) : (
              <>
                <div className="import-paused-row head">
                  <button className="link-btn" onClick={() => restoreFiles(paused.map((p) => p.relPath))}>
                    全部移回
                  </button>
                </div>
                {paused.map((item) => (
                  <div className="import-paused-row" key={item.relPath}>
                    <span className="name" title={item.relPath}>
                      {item.fileName}
                    </span>
                    <em>{bytesLabel(item.bytes)}</em>
                    <button className="link-btn" onClick={() => restoreFiles([item.relPath])}>
                      移回
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {dropActive && <div className="import-drop">松开鼠标，文件会复制到收件箱（源文件保持不动）</div>}

        <div className="import-list">
          {loading ? (
            <div className="import-empty">正在读取收件箱…</div>
          ) : loadError ? (
            <div className="import-empty error">{loadError}</div>
          ) : rows.length === 0 ? (
            <div className="import-empty">
              把新成片拖进 <code>_收件箱</code>，再点「刷新」。
            </div>
          ) : (
            rows.map((row) => {
              const p = previewOf(row, previews)
              const rec = recognitions[row.relPath]
              const pending = !!rec && isPending(rec)
              const suggestion = suggestionFor(row, rec)
              return (
                <div
                  className={`import-row ${row.checked ? '' : 'off'} ${p.valid ? '' : 'bad'} ${pending ? 'pending' : ''}`}
                  key={row.relPath}
                >
                  <input
                    type="checkbox"
                    className="import-box"
                    checked={row.checked}
                    onChange={(e) => patch(row.relPath, { checked: e.target.checked })}
                  />
                  <div className="import-thumb">
                    {row.previewUrl ? <img src={row.previewUrl} alt="" loading="lazy" /> : <Icon name="image" size={16} />}
                  </div>
                  <div className="import-file">
                    <b title={row.fileName}>{row.fileName}</b>
                    <span>
                      {bytesLabel(row.bytes)}
                      {row.device ? ` · ${row.device}` : ''}
                      {row.kind ? ` · ${row.kind}` : ''}
                      {row.date ? ` · ${row.date}${row.dateSource ? `（${DATE_SOURCE_LABEL[row.dateSource]}）` : ''}` : ''}
                    </span>
                    <div className="import-dest" title={p.destRel ?? ''}>
                      <Icon name="folder" size={10} />
                      <span className="path">{p.destRel ?? '—'}</span>
                      {p.valid && p.conflict && <em>重名自动编号</em>}
                      {!p.valid && <em className="bad">{p.error ?? '无法归档'}</em>}
                    </div>
                    {recognizing[row.relPath] && !rec ? (
                      <div className="import-recog muted">正在识别水印…</div>
                    ) : rec ? (
                      <div
                        className={`import-recog ${pending ? 'pending' : ''}`}
                        title={[rec.reason, rec.targetRaw].filter(Boolean).join(' · ')}
                      >
                        {rec.hasBar ? (
                          <>
                            <span className="tag">水印</span>
                            <span className="text">
                              {[
                                rec.catalogId ?? rec.targetRaw,
                                rec.exposureRaw ? `总曝光 ${rec.exposureRaw}` : null,
                                rec.rigName,
                                rec.nightDate ? `夜次 ${rec.nightDate}` : null
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                            {pending && <em>待确认</em>}
                            {suggestion && (
                              <button
                                className="link-btn"
                                onClick={() => applyOne(row.relPath)}
                                title={rec.reason ?? undefined}
                              >
                                套用
                              </button>
                            )}
                          </>
                        ) : (
                          <span className="muted">未检测到水印，可沿用文件名或手工填写</span>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div className="import-fields">
                    <select
                      value={row.category ?? ''}
                      onChange={(e) => {
                        const value = e.target.value as InboxCategory | ''
                        patch(row.relPath, { category: value || null, checked: value ? true : row.checked })
                      }}
                    >
                      <option value="">选择分类</option>
                      {CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    {row.category === 'deep_sky' ? (
                      <input
                        value={row.code}
                        placeholder="目标编号 M31"
                        spellCheck={false}
                        onChange={(e) => patch(row.relPath, { code: e.target.value })}
                      />
                    ) : (
                      <>
                        <input
                          type="date"
                          value={row.date}
                          onChange={(e) => patch(row.relPath, { date: e.target.value })}
                        />
                        <input
                          value={row.location}
                          placeholder="地点"
                          onChange={(e) => patch(row.relPath, { location: e.target.value })}
                        />
                      </>
                    )}
                    <button
                      className="link-btn import-defer"
                      onClick={() => deferOne(row.relPath)}
                      disabled={importing}
                      title="移到「暂不整理」，不参与统计"
                    >
                      暂不整理
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="import-foot">
          <span className="import-foot-note">
            {rows.length === 0 ? '收件箱中没有可导入的文件' : importable.length ? `将移动 ${importable.length} 个文件到素材库` : '勾选文件并补全分类后可导入'}
          </span>
          <button className="btn ghost" onClick={onClose} disabled={importing}>
            取消
          </button>
          <button className="btn primary" onClick={runImport} disabled={importing || !importable.length}>
            {importing ? '正在导入…' : `导入 ${importable.length} 个文件`}
          </button>
        </div>
      </div>
    </div>
  )
}
