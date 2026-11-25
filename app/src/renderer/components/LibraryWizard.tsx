import { useEffect, useState } from 'react'
import api from '../api'
import { Icon } from './Icons'
import type { LibraryDirCheck } from '../types'

interface LibraryWizardProps {
  initialPath: string
  scanning: boolean
  onClose: () => void
  onScan: () => Promise<void> | void
  onOpenImport: () => void
  onOpenSync: () => void
  pushToast: (message: string, kind?: 'info' | 'error' | 'ok') => void
}

interface Prepared {
  path: string
  created: string[]
  check: LibraryDirCheck
}

const TREE = [
  { name: '01_深空', note: '深空目标与原始帧' },
  { name: '02_星野', note: '银河 / 星轨 / 延时' },
  { name: '_收件箱', note: '待整理素材' },
  { name: '_dwarf mini校准场', note: '校准场' }
]

export function LibraryWizard({
  initialPath,
  scanning,
  onClose,
  onScan,
  onOpenImport,
  onOpenSync,
  pushToast
}: LibraryWizardProps) {
  const [dir, setDir] = useState(initialPath)
  const [check, setCheck] = useState<LibraryDirCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [allowNonEmpty, setAllowNonEmpty] = useState(false)
  const [error, setError] = useState('')
  const [prepared, setPrepared] = useState<Prepared | null>(null)

  const inspect = async (target: string) => {
    const value = target.trim()
    if (!value) {
      setCheck(null)
      setError('请先选择或输入素材库目录')
      return null
    }
    setChecking(true)
    setError('')
    try {
      const res = await api.inspectLibrary(value)
      setCheck(res)
      if (res.error) setError(res.error)
      return res
    } catch (err) {
      setError((err as Error).message)
      return null
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    if (initialPath.trim()) void inspect(initialPath)
    // 只在打开时检查一次初始目录
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const choose = async () => {
    const res = await api.pickLibraryRoot()
    if (!res.ok || !res.path) return
    setDir(res.path)
    setPrepared(null)
    setAllowNonEmpty(false)
    await inspect(res.path)
  }

  const prepare = async () => {
    if (busy || scanning) return
    setBusy(true)
    setError('')
    try {
      const res = await api.prepareLibrary(dir.trim(), { allowNonEmpty })
      setCheck(res.check)
      if (!res.ok) {
        setError(res.error ?? '建立素材库失败')
        return
      }
      setPrepared({ path: res.check.path, created: res.created ?? [], check: res.check })
      setAllowNonEmpty(false)
      pushToast(
        res.created?.length ? `素材库已建立，创建了 ${res.created.length} 个目录` : '素材库已就绪',
        'ok'
      )
      void onScan()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const openLibrary = async () => {
    const res = await api.openLibraryRoot()
    if (!res.ok) pushToast(res.error ?? '打开素材库失败', 'error')
  }

  const blocking = !!check && (check.looksLikeSource || !!check.error)
  const needConfirm = !!check && !check.empty && !check.isLibrary
  const canPrepare = !!check && check.exists && check.isDirectory && check.writable && !blocking && (!needConfirm || allowNonEmpty)

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal wide" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <b>建库向导</b>
          <span>为素材库选择位置并生成标准目录；已有文件不会被删除或覆盖。</span>
        </div>

        {prepared ? (
          <>
            <div className="wiz-done">
              <Icon name="folder" size={16} />
              <div>
                <b>素材库已就绪</b>
                <span className="mono">{prepared.path}</span>
              </div>
            </div>
            <div className="wiz-tree">
              {TREE.map((item) => (
                <div className="wiz-tree-row" key={item.name}>
                  <Icon name="folder" size={12} />
                  <b>{item.name}</b>
                  <span>{item.note}</span>
                  <em>
                    {prepared.check.existing.includes(item.name)
                      ? prepared.created.includes(item.name)
                        ? '本次创建'
                        : '已存在'
                      : '缺失'}
                  </em>
                </div>
              ))}
              <div className="wiz-tree-row sub">
                <Icon name="folder" size={12} />
                <b>_dwarf mini校准场/bias · dark · flat</b>
                <span>偏置场 / 暗场 / 平场</span>
                <em>{prepared.created.some((rel) => rel.includes('/')) ? '本次创建' : '已存在'}</em>
              </div>
            </div>
            <p className="set-note">
              {scanning ? '正在扫描新素材库…' : '接下来可以导入素材或从设备同步；扫描可随时重新执行。'}
            </p>
            <div className="modal-foot wiz-foot">
              <button className="btn ghost sm" onClick={() => void openLibrary()}>
                <Icon name="folder" size={12} />
                打开目录
              </button>
              <button className="btn ghost sm" onClick={onOpenImport}>
                <Icon name="inbox" size={12} />
                导入文件
              </button>
              <button className="btn ghost sm" onClick={onOpenSync}>
                设备同步
              </button>
              <button className="btn sm" onClick={() => void onScan()} disabled={scanning}>
                <Icon name="scan" size={12} />
                {scanning ? '扫描中…' : '立即扫描'}
              </button>
              <button className="btn primary sm" onClick={onClose}>
                完成
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="modal-label">素材库位置</span>
            <div className="wiz-path">
              <input
                className="input"
                value={dir}
                spellCheck={false}
                placeholder="选择或输入一个文件夹路径"
                onChange={(event) => {
                  setDir(event.target.value)
                  setCheck(null)
                  setError('')
                  setAllowNonEmpty(false)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void inspect(dir)
                }}
              />
              <button className="btn ghost sm" onClick={() => void choose()}>
                选择文件夹
              </button>
              <button className="btn ghost sm" onClick={() => void inspect(dir)} disabled={checking}>
                {checking ? '检查中…' : '检查'}
              </button>
            </div>

            {check && (
              <>
                <div className="wiz-grid">
                  <div className="wiz-item">
                    <span>目录</span>
                    <b className={check.exists && check.isDirectory ? 'ok' : 'bad'}>
                      {check.exists && check.isDirectory ? '存在' : check.exists ? '不是文件夹' : '不存在'}
                    </b>
                  </div>
                  <div className="wiz-item">
                    <span>可写</span>
                    <b className={check.writable ? 'ok' : 'bad'}>{check.writable ? '是' : '否'}</b>
                  </div>
                  <div className="wiz-item">
                    <span>内容</span>
                    <b className={check.empty ? 'ok' : 'warn'}>
                      {check.empty ? '空目录' : `${check.entryCount} 项`}
                    </b>
                  </div>
                  <div className="wiz-item">
                    <span>类型</span>
                    <b className={check.isLibrary ? 'ok' : check.looksLikeSource ? 'bad' : ''}>
                      {check.isLibrary ? '已有素材库' : check.looksLikeSource ? '设备素材目录' : '普通目录'}
                    </b>
                  </div>
                </div>

                <div className="wiz-tree">
                  {TREE.map((item) => {
                    const exists = check.existing.includes(item.name)
                    return (
                      <div className="wiz-tree-row" key={item.name}>
                        <Icon name="folder" size={12} />
                        <b>{item.name}</b>
                        <span>{item.note}</span>
                        <em className={exists ? 'ok' : ''}>{exists ? '已存在' : '将创建'}</em>
                      </div>
                    )
                  })}
                </div>

                {check.looksLikeSource && (
                  <div className="wiz-warn bad">
                    这看起来是设备原始素材目录（含 Astronomy / DWARF 会话文件夹），不适合直接作为素材库。请另选一个空白文件夹。
                  </div>
                )}

                {needConfirm && !blocking && (
                  <label className="wiz-warn">
                    <input
                      type="checkbox"
                      checked={allowNonEmpty}
                      onChange={(event) => setAllowNonEmpty(event.target.checked)}
                    />
                    <span>
                      目录里已有 {check.entryCount} 项内容。我确认在这里补建标准目录，不会删除或覆盖已有文件。
                    </span>
                  </label>
                )}
              </>
            )}

            {error && <div className="wiz-warn bad">{error}</div>}

            <div className="modal-foot">
              <button className="btn ghost sm" onClick={onClose}>
                取消
              </button>
              <button className="btn primary sm" onClick={() => void prepare()} disabled={!canPrepare || busy || checking}>
                {busy ? '正在创建…' : '建立素材库'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
