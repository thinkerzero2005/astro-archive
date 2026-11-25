export interface TargetCard {
  id: number
  catalogId: string
  nameCn: string
  nameEn: string | null
  title: string
  pinned: number
  nights: number
  finals: number
  exposureS: number
  thumbUrl: string | null
  isNew: boolean
}

export interface HeroInfo {
  shotId: number
  targetId: number | null
  nameCn: string
  nameEn: string
  constellation: string
  distanceLy: number | null
  date: string
  pinned: boolean
  thumbUrl: string
  facts: string[]
}

export interface NightscapeItem {
  type: string
  count: number
  nightId: number | null
  date: string
  location: string
  thumbUrl: string | null
}

export interface Overview {
  libraryRoot: string
  lastScanAt: string
  stats: {
    targets: number
    nights: number
    exposureS: number
    nightscapeWorks: number
    finals: number
    deepSkyFinals: number
    byType: Record<string, number>
  }
  hero: HeroInfo | null
  targets: TargetCard[]
  nightscape: { items: NightscapeItem[]; byType: Record<string, number> }
  recentNights: Array<{
    id: number
    date: string
    category: 'deep_sky' | 'nightscape'
    subType: string
    location: string
    exposureS: number
  }>
  calendar: { year: number; month: number; today: number; marks: number[]; moon: { phase: string; illum: number } }
  pendingInbox: number
}

export interface TargetShot {
  id: number
  fileName: string
  thumbUrl: string
  fullUrl: string
  ar: number
  rating: number
  versionNo: number
  versionName: string
  versionTags: string[]
  software: string
  processedAt: string
  versionNote: string
  isFinalVersion: boolean
  versionOrder: number
  versionEdited: boolean
  sourceNightIds: number[]
}

export interface VersionPatch {
  versionName?: string
  tags?: string[]
  software?: string
  processedAt?: string
  note?: string
  nightIds?: number[]
  final?: boolean
  move?: 'up' | 'down'
}

export interface TargetGroup {
  nightId: number | null
  date: string
  device: string
  exposureS: number
  nightshots: number
  shots: TargetShot[]
}

export interface TargetDetail {
  target: {
    id: number
    title: string
    catalogId: string
    nameCn: string
    nameEn: string
    objectType: string
    constellation: string
    distanceLy: number | null
    ra: string | null
    dec: string | null
    pinned: number
    alias: string
    magnitude: number | null
    description: string
    source: string
    profileUpdatedAt: string
    profileEdited: boolean
    coverUrl: string | null
  }
  summary: { nights: number; finals: number; exposureS: number; rawFrames: number }
  groups: TargetGroup[]
  folderPath: string
  folders: { root: string; finals: string; raw: string; processed: string }
}

export interface ShotDetail {
  shot: {
    id: number
    fileName: string
    fileUrl: string
    thumbUrl: string
    ar: number
    width: number | null
    height: number | null
    bytes: number
    capturedAt: string | null
    device: string | null
    cameraModel: string | null
    lens: string | null
    exposureS: number | null
    iso: number | null
    fNumber: number | null
    frameCount: number
    totalExposureS: number
    exposureSource: string | null
    reviewState: string
    rating: number
    notes: string | null
    location: string | null
    subType: string | null
    isPinned: boolean
    isCover: boolean
  }
  context: {
    title: string
    subtitle: string
    film: Array<{ id: number; thumbUrl: string; fileName: string; ar: number }>
    index: number
  }
  folderPath: string
  nightId: number | null
  targetId: number | null
}

export interface VideoItem {
  id: number
  fileName: string
  fileUrl: string
  bytes: number
  durationS: number
  ar: number
  fps?: number
  frameCount?: number
}

export interface VideoDetail {
  video: VideoItem & {
    width: number | null
    height: number | null
    fps: number | null
    codec: string | null
  }
  context: {
    title: string
    subtitle: string
  }
  folderPath: string
  nightId: number | null
}

export interface NightscapeGroup {
  id: number
  date: string
  location: string
  folderRel: string | null
  exposureS: number
  videoCount: number
  videos: VideoItem[]
  shots: TargetShot[]
}

export interface NightscapeData {
  type: string
  nights: NightscapeGroup[]
  folderPath: string
}

export interface NightShot {
  id: number
  fileName: string
  thumbUrl: string
  ar: number
  rating: number
}

export interface NightDeepTarget {
  targetId: number
  title: string
  nameEn: string
  shotCount: number
  exposureS: number
  devices: string[]
  rigs: string[]
  shots: NightShot[]
}

export interface NightEntry {
  nightId: number
  category: 'nightscape'
  subType: string
  location: string
  folderRel: string | null
  devices: string[]
  rigs: string[]
  shotCount: number
  exposureS: number
  shots: NightShot[]
  videos: VideoItem[]
}

export interface NightBrief {
  id: number
  category: 'deep_sky' | 'nightscape'
  subType: string
  location: string
  weather: string
  seeing: string
  bortle: number | null
  moon: { phase: string; illum: number }
  rigs: string[]
}

export interface NightDate {
  date: string
  nightCount: number
  shotCount: number
  videoCount: number
  exposureS: number
  rigs: string[]
  nightList: NightBrief[]
  deepSky: NightDeepTarget[]
  nightscape: NightEntry[]
}

export interface NightsData {
  dates: NightDate[]
}

export interface RigInfo {
  id: number
  name: string
  type: string
  focalMm: number | null
  apertureF: number | null
  device: string | null
  notes: string | null
  nights: number
  targets: number
  exposureS: number
  lastUsed: string
}

export interface RigsData {
  rigs: RigInfo[]
}

export interface NightRig extends Omit<RigInfo, 'nights' | 'targets' | 'exposureS' | 'lastUsed'> {
  auto: boolean
  selected: boolean
}

export interface NightDetail {
  night: {
    id: number
    date: string
    category: 'deep_sky' | 'nightscape'
    subType: string
    location: string
    weather: string
    seeing: string
    bortle: number | null
    notes: string
    postProcess: string
    folderRel: string | null
  }
  moon: { phase: string; illum: number }
  rigs: NightRig[]
  summary: {
    rigs: string[]
    lens: string[]
    singleExposureS: number
    isos: number[]
    frameCount: number
    exposureS: number
    timelapseFrames: number
    timelapseDurationS: number
    timelapseFps: number
  }
  targets: Array<{
    targetId: number
    title: string
    nameEn: string
    shotCount: number
    frameCount: number
    exposureS: number
    thumbUrl: string
  }>
  devices: string[]
  shots: NightShot[]
  videos: VideoItem[]
  folderPath: string | null
  stats: { shotCount: number; targetCount: number; videoCount: number; exposureS: number }
}

export interface NightPatch {
  location?: string
  weather?: string
  seeing?: string
  bortle?: number | null
  notes?: string
  postProcess?: string
  rigIds?: number[]
}

export interface RigPatch {
  id?: number
  name: string
  type?: string
  focalMm?: number | null
  apertureF?: number | null
  device?: string
  notes?: string
}

export interface CreateNightPatch {
  date: string
  category: 'deep_sky' | 'nightscape'
  subType?: string
  location?: string
}

export interface HistoryItem {
  id: number
  at: string
  action: string
  entity: string
  kind: 'rename' | 'import' | 'undo' | 'other'
  title: string
  path: string
  note: string
  undoable: boolean
  undone: boolean
}

export interface StatsMonth {
  month: string
  label: string
  finals: number
  nights: number
  exposureS: number
}

export interface StatsData {
  summary: {
    targets: number
    nights: number
    deepNights: number
    nsNights: number
    finals: number
    deepFinals: number
    nsFinals: number
    exposureS: number
    nsExposureS: number
    watermarkFinals: number
    watermarkExposureS: number
    pendingReview: number
    rawCount: number
    assetCount: number
    totalBytes: number
    byType: Record<string, number>
  }
  months: StatsMonth[]
  topTargets: Array<{
    id: number
    title: string
    finals: number
    nights: number
    exposureS: number
    thumbUrl: string | null
  }>
  devices: Array<{ device: string; count: number }>
  history: { total: number; items: HistoryItem[] }
}

export type EncyclopediaSite = 'wikipedia' | 'baike'

export interface OpResult {
  ok: boolean
  error?: string
  renamed?: boolean
  folderRel?: string
  kind?: 'rename' | 'import' | 'edit' | 'profile' | 'night' | 'rig' | 'version' | 'sync'
  restored?: number
  updated?: number
  id?: number
  errors?: string[]
}

export interface TargetProfilePatch {
  nameEn?: string
  alias?: string
  objectType?: string
  constellation?: string
  distanceLy?: number | null
  magnitude?: number | null
  description?: string
}

export interface ShotPatch {
  rating?: number
  notes?: string
  isPinned?: boolean
  cover?: boolean
}

export type SearchSort = 'date' | 'rating' | 'exposure' | 'bytes'

export interface SearchParams {
  q?: string
  category?: 'all' | 'deep_sky' | 'nightscape'
  subType?: string
  kind?: 'all' | 'photo' | 'video'
  rating?: number
  from?: string
  to?: string
  targetId?: number
  rigId?: number
  versionState?: 'all' | 'final' | 'other'
  sort?: SearchSort
  order?: 'desc' | 'asc'
}

export interface SearchItem {
  kind: 'photo' | 'video'
  id: number
  fileName: string
  date: string
  title: string
  subType: string | null
  ar: number
  rating?: number
  thumbUrl?: string
  fileUrl?: string
  bytes?: number
  durationS?: number
  exposureS?: number
  isFinalVersion?: boolean
}

export interface SearchResult {
  items: SearchItem[]
  total: number
  photoCount: number
  videoCount: number
}

export type InboxCategory = 'deep_sky' | '银河' | '星轨' | '延时' | '其他'

export interface InboxFile {
  relPath: string
  fileName: string
  ext: string
  bytes: number
  mtime: number
  previewUrl: string | null
  date: string | null
  dateSource: 'name' | 'folder' | 'exif' | 'mtime' | null
  category: InboxCategory | null
  code: string | null
  location: string | null
  device: string | null
  kind: string | null
  seq: number | null
  reason: string | null
  destRel: string | null
  valid: boolean
  error: string | null
  conflict: boolean
}

export interface InboxListing {
  ok: boolean
  inboxPath: string
  libraryRoot: string
  files: InboxFile[]
  error: string | null
}

export interface InboxPreview {
  relPath: string
  destRel: string | null
  valid: boolean
  error: string | null
  conflict: boolean
}

export interface InboxRecognition {
  relPath: string
  hasBar: boolean
  targetRaw: string | null
  catalogId: string | null
  exposureMinutes: number | null
  exposureRaw: string | null
  endedAt: string | null
  nightDate: string | null
  rigName: string | null
  confidence: number
  needsReview: boolean
  reason: string | null
}

export interface PendingReview {
  id: number
  fileName: string
  fileUrl: string
  thumbUrl: string | null
  ar: number
  targetId: number | null
  title: string
  nightId: number | null
  nightDate: string | null
  location: string | null
  totalExposureS: number
  exposureSource: string | null
  watermarkText: string | null
}

export interface InboxImportItem {
  relPath: string
  category: InboxCategory
  date?: string | null
  code?: string | null
  location?: string | null
}

export interface InboxImportResult {
  ok: boolean
  moved: number
  errors: string[]
  moves: Array<{ fromRel: string; toRel: string }>
}

export interface InboxStageResult {
  ok: boolean
  batchRel: string | null
  copied: number
  skipped: Array<{ fileName: string; reason: string }>
  errors: string[]
}

export interface InboxDeferredItem {
  relPath: string
  fileName: string
  ext: string
  bytes: number
  mtime: number
}

export interface SyncTargetOverride {
  sessionRel: string
  catalogId?: string | null
  nameCn?: string | null
}

export type SyncSessionStatus = 'new' | 'partial' | 'synced' | 'skip' | 'unresolved'

export interface SyncSessionItem {
  sessionRel: string
  sessionName: string
  targetCatalog: string | null
  targetName: string | null
  targetFolderRel: string | null
  date: string | null
  frameCount: number
  fileCount: number
  bytes: number
  pendingBytes: number
  status: SyncSessionStatus
  reason: string | null
}

export interface SyncCalibrationItem {
  key: string
  label: string
  destRel: string
  fileCount: number
  bytes: number
  pendingBytes: number
  status: 'new' | 'partial' | 'synced' | 'skip'
  reason: string | null
}

export interface SyncPreview {
  ok: boolean
  error?: string
  sourceRoot: string
  astronomyPath: string | null
  sessions: SyncSessionItem[]
  calibrations: SyncCalibrationItem[]
  totalBytes: number
  pendingBytes: number
}

export interface SyncRunOptions {
  sessions?: string[]
  calibrations?: string[]
  overrides?: SyncTargetOverride[]
  makeDeleteList?: boolean
}

export interface SyncRunResult {
  ok: boolean
  error?: string
  batchId?: string
  copied: number
  bytes: number
  skipped: number
  errors: string[]
  deleteListPath?: string | null
}

export interface CalibrationDevice {
  name: string
  fileCount: number
  bytes: number
}

export interface CalibrationGroup {
  key: 'bias' | 'dark' | 'flat'
  label: string
  fileCount: number
  bytes: number
  devices: CalibrationDevice[]
  updatedAt: string | null
}

export interface CalibrationData {
  ok: boolean
  path: string
  exists: boolean
  groups: CalibrationGroup[]
  darkLibrary: {
    fileCount: number
    bytes: number
    devices: CalibrationDevice[]
    updatedAt: string | null
  } | null
  totalFiles: number
  totalBytes: number
}

export interface SettingsInfo {
  libraryRoot: string
  dataDir: string
  thumbsDir: string
  dbPath: string
  dbBytes: number
  version: string
  buildDate: string
  lastScanAt: string
  syncSource: string
  syncSourceExists: boolean
  syncedFiles: number
  historyPath: string
  historyBytes: number
  historyLines: number
  historyExists: boolean
  calibrationPath: string
  calibrationExists: boolean
  onlineProfileEnabled: boolean
  backupDir: string
  backups: BackupEntry[]
}

export interface BackupEntry {
  fileName: string
  date: string
  bytes: number
  mtime: string
}

export interface LibraryDirCheck {
  path: string
  exists: boolean
  isDirectory: boolean
  writable: boolean
  empty: boolean
  entryCount: number
  isLibrary: boolean
  looksLikeSource: boolean
  existing: string[]
  missing: string[]
  error?: string
}

export interface LibraryPrepareResult {
  ok: boolean
  needsConfirm?: boolean
  created?: string[]
  check: LibraryDirCheck
  error?: string
}

export interface OnlineProfileData {
  title: string
  extract: string
  shortDescription: string
  imageUrl: string | null
  source: string
  updatedAt: string
  lang: 'zh' | 'en' | null
}

export interface OnlineProfileResult {
  ok: boolean
  enabled: boolean
  cached: boolean
  builtin: boolean
  profile: OnlineProfileData | null
  error?: string
}

export type ThemePref = 'dark' | 'light' | 'system'
export type AccentKey = 'cyan' | 'violet' | 'amber' | 'green' | 'rose' | 'indigo'

export interface Appearance {
  theme: ThemePref
  accent: AccentKey
  reduceMotion: boolean
}

export type HomeModuleKey = 'hero' | 'stats' | 'targets' | 'nightscape' | 'nights'

export interface HomeModules {
  order: HomeModuleKey[]
  hidden: HomeModuleKey[]
}
