import { useCallback, useEffect, useState } from 'react'
import api from '../api'
import { Icon } from '../components/Icons'
import { DEFAULT_HOME_MODULES, HOME_MODULE_LABELS } from '../homeModules'
import { ACCENT_OPTIONS, THEME_OPTIONS } from '../theme'
import { bytesLabel, lastScanLabel } from '../util'
import type { Appearance, HomeModuleKey, HomeModules, SettingsInfo } from '../types'

interface SettingsProps {
  refreshKey: string
  scanning: boolean
  onScan: (full?: boolean) => Promise<void> | void
  onSync: () => void
  appearance: Appearance
  onChangeAppearance: (patch: Partial<Appearance>) => Promise<void> | void
  homeModules: HomeModules
  onChangeHomeModules: (next: HomeModules) => Promise<void> | void
  onOpenLibraryWizard: () => void
  pushToast: (message: string, kind?: 'info' | 'error' | 'ok') => void
}

function toggleHidden(hidden: HomeModuleKey[], key: HomeModuleKey) {
  return hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key]
}

function moveItem(order: HomeModuleKey[], index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= order.length) return order
  const next = [...order]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function Settings({
  refreshKey,
  scanning,
  onScan,
  onSync,
  appearance,
  onChangeAppearance,
  homeModules,
  onChangeHomeModules,
  onOpenLibraryWizard,
  pushToast
}: SettingsProps) {
  const [info, setInfo] = useState<SettingsInfo | null>(null)

  const load = useCallback(() => {
    api
      .settingsInfo()
      .then((d) => setInfo(d))
      .catch(() => setInfo(null))
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, okText?: string) => {
    try {
      const res = await fn()
      if (!res.ok) pushToast(res.error ?? '操作失败', 'error')
      else if (okText) pushToast(okText, 'ok')
    } catch (err) {
      pushToast((err as Error).message, 'error')
    }
  }

  const changeRoot = () => {
    if (scanning) return
    onOpenLibraryWizard()
  }

  const restore = async (fileName: string) => {
    try {
      const res = await api.restoreBackup(fileName)
      if (!res.ok && !res.canceled) pushToast(res.error ?? '恢复失败', 'error')
    } catch (err) {
      pushToast((err as Error).message, 'error')
    }
  }

  if (!info) {
    return (
      <div className="empty">
        <b>正在读取设置…</b>
      </div>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="ph-t">Settings</div>
          <h3>
            设置<span>素材库位置、设备同步与本地数据</span>
          </h3>
        </div>
        <div className="acts">
          <button className="btn ghost sm" onClick={() => run(api.openDataDir)}>
            <Icon name="folder" size={12} />
            打开数据目录
          </button>
        </div>
      </div>

      <div className="set-grid">
        <div className="block" style={{ gridColumn: '1 / -1' }}>
          <div className="block-head">
            <div className="t">
              外观 <em>主题、强调色与动效</em>
            </div>
          </div>
          <div className="appearance-row">
            <span className="set-key">主题</span>
            <div className="seg">
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  className={appearance.theme === option.key ? 'active' : ''}
                  onClick={() => void onChangeAppearance({ theme: option.key })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="appearance-row">
            <span className="set-key">强调色</span>
            <div className="swatches">
              {ACCENT_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  className={`swatch${appearance.accent === option.key ? ' active' : ''}`}
                  data-accent={option.key}
                  title={option.label}
                  aria-label={option.label}
                  onClick={() => void onChangeAppearance({ accent: option.key })}
                />
              ))}
            </div>
          </div>
          <div className="appearance-row">
            <span className="set-key">动效</span>
            <button
              className={`switch${appearance.reduceMotion ? ' on' : ''}`}
              role="switch"
              aria-checked={appearance.reduceMotion}
              aria-label="减少动画"
              onClick={() => void onChangeAppearance({ reduceMotion: !appearance.reduceMotion })}
            />
            <span className="dim" style={{ fontSize: 12 }}>
              减少动画与过渡，适合长时间整理素材
            </span>
          </div>
          <p className="set-note">外观设置保存在本地，重启后保持；深色为默认主题。</p>
        </div>

        <div className="block" style={{ gridColumn: '1 / -1' }}>
          <div className="block-head">
            <div className="t">
              首页模块 <em>显示与顺序</em>
            </div>
            <button className="link" onClick={() => void onChangeHomeModules(DEFAULT_HOME_MODULES)}>
              恢复默认
            </button>
          </div>
          {homeModules.order.map((key, index) => {
            const hidden = homeModules.hidden.includes(key)
            return (
              <div className="module-row" key={key}>
                <button
                  className={`switch${hidden ? '' : ' on'}`}
                  role="switch"
                  aria-checked={!hidden}
                  aria-label={`${hidden ? '显示' : '隐藏'}${HOME_MODULE_LABELS[key]}`}
                  onClick={() => void onChangeHomeModules({ ...homeModules, hidden: toggleHidden(homeModules.hidden, key) })}
                />
                <span className="module-name">{HOME_MODULE_LABELS[key]}</span>
                <div className="module-acts">
                  <button
                    className="icon-btn"
                    disabled={index === 0}
                    aria-label={`上移${HOME_MODULE_LABELS[key]}`}
                    onClick={() => void onChangeHomeModules({ ...homeModules, order: moveItem(homeModules.order, index, -1) })}
                  >
                    <Icon name="up" size={12} />
                  </button>
                  <button
                    className="icon-btn"
                    disabled={index === homeModules.order.length - 1}
                    aria-label={`下移${HOME_MODULE_LABELS[key]}`}
                    onClick={() => void onChangeHomeModules({ ...homeModules, order: moveItem(homeModules.order, index, 1) })}
                  >
                    <Icon name="down" size={12} />
                  </button>
                </div>
              </div>
            )
          })}
          <p className="set-note">隐藏的模块仍保留顺序；全部隐藏时首页显示提示。</p>
        </div>

        <div className="block" style={{ gridColumn: '1 / -1' }}>
          <div className="block-head">
            <div className="t">
              天体资料 <em>在线补充摘要与配图</em>
            </div>
          </div>
          <div className="appearance-row">
            <span className="set-key">联网获取</span>
            <button
              className={`switch${info.onlineProfileEnabled ? ' on' : ''}`}
              role="switch"
              aria-checked={info.onlineProfileEnabled}
              aria-label="允许联网获取天体资料"
              onClick={async () => {
                const res = await api.setOnlineProfile(!info.onlineProfileEnabled)
                if (!res.ok) {
                  pushToast(res.error ?? '保存失败', 'error')
                  return
                }
                load()
                pushToast(res.enabled ? '已开启联网资料' : '已关闭联网资料', 'ok')
              }}
            />
            <span className="dim" style={{ fontSize: 12 }}>
              默认关闭；开启后打开目标详情才联网，只发送天体名称
            </span>
          </div>
          <p className="set-note">
            在线资料来自维基百科（中文优先、英文兜底），摘要与配图缓存在本地数据目录；断网或关闭时显示缓存或内置资料。
          </p>
        </div>

        <div className="block">
          <div className="block-head">
            <div className="t">
              素材库 <em>所有归档都写在这里</em>
            </div>
          </div>
          <div className="set-row">
            <span className="set-key">根目录</span>
            <span className="set-val mono" title={info.libraryRoot}>
              {info.libraryRoot}
            </span>
          </div>
          <div className="set-row">
            <span className="set-key">上次扫描</span>
            <span className="set-val">{lastScanLabel(info.lastScanAt)}</span>
          </div>
          <div className="set-row">
            <span className="set-key">校准场</span>
            <span className="set-val mono" title={info.calibrationPath}>
              {info.calibrationExists ? info.calibrationPath : '尚未创建'}
            </span>
          </div>
          <div className="set-actions">
            <button className="btn ghost sm" onClick={() => run(api.openLibraryRoot)}>
              <Icon name="folder" size={12} />
              打开素材库
            </button>
            <button className="btn ghost sm" onClick={() => void onScan()} disabled={scanning}>
              <Icon name="scan" size={12} />
              {scanning ? '正在扫描…' : '重新扫描'}
            </button>
            <button className="btn ghost sm" onClick={() => void onScan(true)} disabled={scanning} title="忽略增量指纹，重新解析全部文件">
              <Icon name="sync" size={12} />
              全量重扫
            </button>
            <button className="btn ghost sm" onClick={changeRoot} disabled={scanning}>
              建库 / 更换目录
            </button>
          </div>
          <p className="set-note">建库向导会检查目录并补建标准结构；更换素材库后需要重新扫描，原库的索引会被清空，硬盘文件不会被动。</p>
        </div>

        <div className="block">
          <div className="block-head">
            <div className="t">
              设备同步 <em>Dwarf 增量同步</em>
            </div>
            <button className="link" onClick={onSync}>
              去同步
            </button>
          </div>
          <div className="set-row">
            <span className="set-key">上次设备</span>
            <span className={`set-val mono ${info.syncSource && !info.syncSourceExists ? 'warn' : ''}`} title={info.syncSource}>
              {info.syncSource || '还没有同步过'}
              {info.syncSource && !info.syncSourceExists ? '（当前未连接）' : ''}
            </span>
          </div>
          <div className="set-row">
            <span className="set-key">同步记录</span>
            <span className="set-val">{info.syncedFiles} 个文件</span>
          </div>
          <div className="set-row">
            <span className="set-key">撤销</span>
            <span className="set-val">顶栏「撤销」可整批删除最近一次同步的副本</span>
          </div>
          <p className="set-note">同步只把新增文件拷进素材库，设备原件不会被删除；暗场库只保留首次拷贝。</p>
        </div>

        <div className="block">
          <div className="block-head">
            <div className="t">
              本地数据 <em>索引与缩略图缓存</em>
            </div>
          </div>
          <div className="set-row">
            <span className="set-key">数据目录</span>
            <span className="set-val mono" title={info.dataDir}>
              {info.dataDir}
            </span>
          </div>
          <div className="set-row">
            <span className="set-key">索引数据库</span>
            <span className="set-val">
              {bytesLabel(info.dbBytes)}
              <span className="mono dim"> · {info.dbPath}</span>
            </span>
          </div>
          <div className="set-row">
            <span className="set-key">缩略图缓存</span>
            <span className="set-val mono" title={info.thumbsDir}>
              {info.thumbsDir}
            </span>
          </div>
        </div>

        <div className="block">
          <div className="block-head">
            <div className="t">
              数据库备份 <em>每天自动保存，保留最近 7 份</em>
            </div>
            <button className="link" onClick={() => run(api.openBackupDir)}>
              打开备份目录
            </button>
          </div>
          {info.backups.length === 0 ? (
            <div className="set-row">
              <span className="set-key">备份</span>
              <span className="set-val">还没有备份，下次启动会自动生成</span>
            </div>
          ) : (
            info.backups.map((item) => (
              <div className="set-row" key={item.fileName}>
                <span className="set-key">{item.date}</span>
                <span className="set-val mono">{bytesLabel(item.bytes)}</span>
                <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => void restore(item.fileName)}>
                  恢复
                </button>
              </div>
            ))
          )}
          <p className="set-note">
            启动时用 SQLite 快照生成当天备份，长期开着每 4 小时检查一次；恢复前会把当前数据库另存为
            archive_before_restore_*.db，随后自动重启，素材库中的照片不受影响。
          </p>
        </div>

        <div className="block">
          <div className="block-head">
            <div className="t">
              历史记录 <em>每次写库都有 CSV 记录</em>
            </div>
            <button className="link" onClick={() => run(api.openHistory)} disabled={!info.historyExists}>
              打开目录
            </button>
          </div>
          <div className="set-row">
            <span className="set-key">文件</span>
            <span className="set-val mono" title={info.historyPath}>
              {info.historyExists ? info.historyPath : '尚未生成'}
            </span>
          </div>
          <div className="set-row">
            <span className="set-key">规模</span>
            <span className="set-val">
              {info.historyExists ? `${info.historyLines - 1} 条 · ${bytesLabel(info.historyBytes)}` : '—'}
            </span>
          </div>
          <p className="set-note">导入、同步、改名、撤销都会往 `_历史记录/素材库历史记录.csv` 追加一行，可用 Excel 直接打开。</p>
        </div>

        <div className="block" style={{ gridColumn: '1 / -1' }}>
          <div className="block-head">
            <div className="t">
              软件信息 <em>版本、开发与隐私</em>
            </div>
          </div>
          <div className="set-row">
            <span className="set-key">软件名称</span>
            <span className="set-val">星空档案馆 · Astro Archive</span>
          </div>
          <div className="set-row">
            <span className="set-key">版本</span>
            <span className="set-val mono">
              v{info.version}
              {info.buildDate ? ` · 构建于 ${info.buildDate}` : ''}
            </span>
          </div>
          <div className="set-row">
            <span className="set-key">开发人</span>
            <span className="set-val">匿名</span>
          </div>
          <div className="set-row">
            <span className="set-key">联系方式</span>
            <span className="set-val mono">ThinkerZero2005@outlook.com</span>
          </div>
          <div className="set-row">
            <span className="set-key">GitHub</span>
            <span className="set-val mono">
              <a
                href="https://github.com/thinkerzero2005/astro-archive"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'inherit', textDecoration: 'underline' }}
              >
                github.com/thinkerzero2005/astro-archive
              </a>
            </span>
          </div>
          <div className="set-row">
            <span className="set-key">技术栈</span>
            <span className="set-val">Electron · React · TypeScript · SQLite（本地）</span>
          </div>
          <div className="set-row">
            <span className="set-key">开源组件</span>
            <span className="set-val">
              sharp（图像处理）、exifr（EXIF 解析）、tesseract.js（水印识别）、React、Vite、electron-builder
            </span>
          </div>
          <div className="set-row">
            <span className="set-key">数据与隐私</span>
            <span className="set-val">
              全部素材与索引都在本机；扫描只读原始文件，不修改、不上传；在线天体资料默认关闭，开启后只发送天体名称到维基百科。
            </span>
          </div>
          <p className="set-note">Copyright © 2026 星空档案馆 Contributors · 本软件为本地单机工具，无账号、无云端同步。</p>
        </div>
      </div>
    </>
  )
}
