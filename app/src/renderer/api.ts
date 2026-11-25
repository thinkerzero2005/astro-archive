import type {
  Appearance,
  BackupEntry,
  CalibrationData,
  CreateNightPatch,
  EncyclopediaSite,
  HomeModules,
  InboxCategory,
  InboxDeferredItem,
  InboxImportItem,
  InboxImportResult,
  InboxListing,
  InboxStageResult,
  InboxPreview,
  InboxRecognition,
  LibraryDirCheck,
  LibraryPrepareResult,
  NightDetail,
  NightPatch,
  NightscapeData,
  NightsData,
  OnlineProfileResult,
  OpResult,
  Overview,
  PendingReview,
  RigPatch,
  RigsData,
  SearchParams,
  SearchResult,
  ShotDetail,
  ShotPatch,
  StatsData,
  SyncPreview,
  SyncRunOptions,
  SyncRunResult,
  SyncTargetOverride,
  SettingsInfo,
  TargetCard,
  TargetDetail,
  TargetProfilePatch,
  VersionPatch,
  VideoDetail
} from './types'

export interface AstroApi {
  bootstrap: () => Promise<{ overview: Overview; libraryRoot: string; libraryRootExists: boolean; thumbsDir: string }>
  overview: () => Promise<Overview>
  search: (params: SearchParams) => Promise<SearchResult>
  scan: (full?: boolean) => Promise<{
    ok: boolean
    shotCount: number
    skipped?: number
    cancelled?: boolean
    errors: string[]
    durationMs: number
    error?: string
  }>
  cancelScan: () => Promise<OpResult>
  targets: () => Promise<TargetCard[]>
  targetDetail: (id: number) => Promise<TargetDetail | null>
  shotDetail: (id: number) => Promise<ShotDetail | null>
  updateShots: (ids: number[], patch: ShotPatch) => Promise<OpResult>
  updateVersion: (id: number, patch: VersionPatch) => Promise<OpResult>
  updateTargetProfile: (id: number, patch: TargetProfilePatch) => Promise<OpResult>
  videoDetail: (id: number) => Promise<VideoDetail | null>
  nightscape: (type: string) => Promise<NightscapeData>
  nights: () => Promise<NightsData>
  nightDetail: (id: number) => Promise<NightDetail | null>
  updateNight: (id: number, patch: NightPatch) => Promise<OpResult>
  createNight: (patch: CreateNightPatch) => Promise<OpResult>
  rigs: () => Promise<RigsData>
  saveRig: (patch: RigPatch) => Promise<OpResult>
  openEncyclopedia: (id: number, site: EncyclopediaSite) => Promise<OpResult>
  targetProfileOnline: (id: number, force?: boolean) => Promise<OnlineProfileResult>
  setOnlineProfile: (enabled: boolean) => Promise<{ ok: boolean; enabled?: boolean; error?: string }>
  stats: () => Promise<StatsData>
  pendingReviews: (state?: 'pending' | 'manual') => Promise<PendingReview[]>
  resolveReviews: (items: Array<{ id: number; totalExposureS?: number }>) => Promise<{
    ok: boolean
    updated?: number
    error?: string
  }>
  resetReviews: (ids: number[]) => Promise<{ ok: boolean; updated?: number; error?: string }>
  exportHistory: (rows: Array<{ time: string; action: string; entity: string; path: string; note: string }>) => Promise<{
    ok: boolean
    path?: string
    error?: string
    canceled?: boolean
  }>
  openTargetFinals: (id: number) => Promise<OpResult>
  openTargetRoot: (id: number) => Promise<OpResult>
  openNightFolder: (id: number) => Promise<OpResult>
  revealShot: (id: number) => Promise<OpResult>
  revealVideo: (id: number) => Promise<OpResult>
  renameTarget: (id: number, name: string) => Promise<OpResult>
  renameNight: (id: number, location: string) => Promise<OpResult>
  undoLast: () => Promise<OpResult>
  inboxList: () => Promise<InboxListing>
  inboxPreview: (items: Array<{
    relPath: string
    category: InboxCategory | null
    date?: string | null
    code?: string | null
    location?: string | null
  }>) => Promise<InboxPreview[]>
  inboxRecognize: (relPaths: string[]) => Promise<InboxRecognition[]>
  inboxImport: (items: InboxImportItem[]) => Promise<InboxImportResult>
  inboxStage: (paths: string[]) => Promise<InboxStageResult>
  inboxPickFolder: () => Promise<{ ok: boolean; path?: string; canceled?: boolean }>
  inboxPaused: () => Promise<InboxDeferredItem[]>
  inboxDefer: (relPaths: string[]) => Promise<{ ok: boolean; moved: number; errors: string[] }>
  inboxRestore: (relPaths: string[]) => Promise<{ ok: boolean; moved: number; errors: string[] }>
  pathForFile: (file: File) => string
  openInbox: () => Promise<OpResult>
  openLibraryRoot: () => Promise<OpResult>
  inspectLibrary: (dir: string) => Promise<LibraryDirCheck>
  prepareLibrary: (dir: string, options: { allowNonEmpty?: boolean }) => Promise<LibraryPrepareResult>
  settingsInfo: () => Promise<SettingsInfo>
  backupList: () => Promise<{ backupDir: string; backups: BackupEntry[] }>
  openBackupDir: () => Promise<OpResult>
  restoreBackup: (fileName: string) => Promise<{ ok: boolean; canceled?: boolean; error?: string; safetyFile?: string }>
  appearanceGet: () => Promise<Appearance>
  appearanceSet: (patch: Partial<Appearance>) => Promise<{ ok: boolean; appearance?: Appearance; error?: string }>
  homeModulesGet: () => Promise<HomeModules>
  homeModulesSet: (patch: Partial<HomeModules>) => Promise<{ ok: boolean; modules?: HomeModules; error?: string }>
  pickLibraryRoot: () => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
  openDataDir: () => Promise<OpResult>
  openLogs: () => Promise<OpResult>
  openHistory: () => Promise<OpResult>
  calibGet: () => Promise<CalibrationData>
  calibOpen: (key: string) => Promise<OpResult>
  syncPickSource: () => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
  syncPreview: (sourceRoot: string, overrides: SyncTargetOverride[]) => Promise<SyncPreview>
  syncRun: (sourceRoot: string, options: SyncRunOptions) => Promise<SyncRunResult>
  onScanProgress: (cb: (p: { phase: string; done: number; total: number; label?: string; stage?: 'parse' | 'thumb' | 'watermark' }) => void) => () => void
  onSyncProgress: (cb: (p: { phase: 'copy' | 'done'; done: number; total: number; label?: string }) => void) => () => void
  onInboxStageProgress: (cb: (p: { done: number; total: number; label: string }) => void) => () => void
  onLibraryChanged: (cb: (result: unknown) => void) => () => void
}

const api = (window as unknown as { astro: AstroApi }).astro

export default api
