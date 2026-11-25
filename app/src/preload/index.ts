import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'

type ProgressPayload = {
  phase: string
  done: number
  total: number
  label?: string
  stage?: 'parse' | 'thumb' | 'watermark'
}

const api = {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  overview: () => ipcRenderer.invoke('library:overview'),
  search: (params: unknown) => ipcRenderer.invoke('search:run', params),
  scan: (full?: boolean) => ipcRenderer.invoke('library:scan', full),
  cancelScan: () => ipcRenderer.invoke('scan:cancel'),
  targets: () => ipcRenderer.invoke('targets:list'),
  targetDetail: (id: number) => ipcRenderer.invoke('target:detail', id),
  shotDetail: (id: number) => ipcRenderer.invoke('shot:detail', id),
  updateShots: (ids: number[], patch: unknown) => ipcRenderer.invoke('shots:update', ids, patch),
  updateVersion: (id: number, patch: unknown) => ipcRenderer.invoke('version:update', id, patch),
  updateTargetProfile: (id: number, patch: unknown) => ipcRenderer.invoke('target:profile:update', id, patch),
  videoDetail: (id: number) => ipcRenderer.invoke('video:detail', id),
  nightscape: (type: string) => ipcRenderer.invoke('nightscape:get', type),
  nights: () => ipcRenderer.invoke('nights:list'),
  nightDetail: (id: number) => ipcRenderer.invoke('night:detail', id),
  updateNight: (id: number, patch: unknown) => ipcRenderer.invoke('night:update', id, patch),
  createNight: (patch: unknown) => ipcRenderer.invoke('night:create', patch),
  rigs: () => ipcRenderer.invoke('rigs:list'),
  saveRig: (patch: unknown) => ipcRenderer.invoke('rig:save', patch),
  openEncyclopedia: (id: number, site: string) => ipcRenderer.invoke('external:encyclopedia', id, site),
  targetProfileOnline: (id: number, force?: boolean) => ipcRenderer.invoke('target:profile:online', id, force),
  stats: () => ipcRenderer.invoke('stats:get'),
  pendingReviews: (state: 'pending' | 'manual') => ipcRenderer.invoke('review:list', state),
  resolveReviews: (items: unknown[]) => ipcRenderer.invoke('review:resolve', items),
  resetReviews: (ids: number[]) => ipcRenderer.invoke('review:reset', ids),
  exportHistory: (rows: unknown[]) => ipcRenderer.invoke('history:export', rows),
  openTargetFinals: (id: number) => ipcRenderer.invoke('folder:openTargetFinals', id),
  openTargetRoot: (id: number) => ipcRenderer.invoke('folder:openTargetRoot', id),
  openNightFolder: (id: number) => ipcRenderer.invoke('folder:openNight', id),
  revealShot: (id: number) => ipcRenderer.invoke('folder:revealShot', id),
  revealVideo: (id: number) => ipcRenderer.invoke('folder:revealVideo', id),
  renameTarget: (id: number, name: string) => ipcRenderer.invoke('target:rename', id, name),
  renameNight: (id: number, location: string) => ipcRenderer.invoke('night:rename', id, location),
  undoLast: () => ipcRenderer.invoke('change:undo'),
  inboxList: () => ipcRenderer.invoke('inbox:list'),
  inboxPreview: (items: unknown[]) => ipcRenderer.invoke('inbox:preview', items),
  inboxRecognize: (relPaths: string[]) => ipcRenderer.invoke('inbox:recognize', relPaths),
  inboxImport: (items: unknown[]) => ipcRenderer.invoke('inbox:import', items),
  inboxStage: (paths: string[]) => ipcRenderer.invoke('inbox:stage', paths),
  inboxPickFolder: () => ipcRenderer.invoke('inbox:pickFolder'),
  inboxPaused: () => ipcRenderer.invoke('inbox:paused'),
  inboxDefer: (relPaths: string[]) => ipcRenderer.invoke('inbox:defer', relPaths),
  inboxRestore: (relPaths: string[]) => ipcRenderer.invoke('inbox:restore', relPaths),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  openInbox: () => ipcRenderer.invoke('inbox:open'),
  openLibraryRoot: () => ipcRenderer.invoke('library:openRoot'),
  inspectLibrary: (dir: string) => ipcRenderer.invoke('library:inspect', dir),
  prepareLibrary: (dir: string, options: { allowNonEmpty?: boolean }) =>
    ipcRenderer.invoke('library:prepare', dir, options),
  settingsInfo: () => ipcRenderer.invoke('settings:info'),
  appearanceGet: () => ipcRenderer.invoke('appearance:get'),
  appearanceSet: (patch: unknown) => ipcRenderer.invoke('appearance:set', patch),
  homeModulesGet: () => ipcRenderer.invoke('home:getModules'),
  homeModulesSet: (patch: unknown) => ipcRenderer.invoke('home:setModules', patch),
  setOnlineProfile: (enabled: boolean) => ipcRenderer.invoke('settings:setOnlineProfile', enabled),
  pickLibraryRoot: () => ipcRenderer.invoke('settings:pickLibraryRoot'),
  openDataDir: () => ipcRenderer.invoke('settings:openDataDir'),
  openHistory: () => ipcRenderer.invoke('settings:openHistory'),
  calibGet: () => ipcRenderer.invoke('calib:get'),
  calibOpen: (key: string) => ipcRenderer.invoke('calib:open', key),
  syncPickSource: () => ipcRenderer.invoke('sync:pickSource'),
  syncPreview: (sourceRoot: string, overrides: unknown[]) => ipcRenderer.invoke('sync:preview', sourceRoot, overrides),
  syncRun: (sourceRoot: string, options: unknown) => ipcRenderer.invoke('sync:run', sourceRoot, options),
  onScanProgress: (cb: (p: ProgressPayload) => void) => {
    const listener = (_e: IpcRendererEvent, p: ProgressPayload) => cb(p)
    ipcRenderer.on('scan:progress', listener)
    return () => ipcRenderer.removeListener('scan:progress', listener)
  },
  onSyncProgress: (cb: (p: ProgressPayload) => void) => {
    const listener = (_e: IpcRendererEvent, p: ProgressPayload) => cb(p)
    ipcRenderer.on('sync:progress', listener)
    return () => ipcRenderer.removeListener('sync:progress', listener)
  },
  onInboxStageProgress: (cb: (p: { done: number; total: number; label: string }) => void) => {
    const listener = (_e: IpcRendererEvent, p: { done: number; total: number; label: string }) => cb(p)
    ipcRenderer.on('inbox:stage:progress', listener)
    return () => ipcRenderer.removeListener('inbox:stage:progress', listener)
  },
  onLibraryChanged: (cb: (result: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, result: unknown) => cb(result)
    ipcRenderer.on('library:changed', listener)
    return () => ipcRenderer.removeListener('library:changed', listener)
  }
}

contextBridge.exposeInMainWorld('astro', api)

export type AstroApi = typeof api
