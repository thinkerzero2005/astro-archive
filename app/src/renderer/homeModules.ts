import type { HomeModuleKey, HomeModules } from './types'

export const HOME_MODULES: HomeModuleKey[] = ['hero', 'stats', 'targets', 'nightscape', 'nights']

export const HOME_MODULE_LABELS: Record<HomeModuleKey, string> = {
  hero: '最近成片',
  stats: '统计条',
  targets: '深空目标',
  nightscape: '星野作品',
  nights: '夜次与月历'
}

/** 会两两并排的内容模块；hero / stats 始终独占一行 */
export const CONTENT_MODULES: HomeModuleKey[] = ['targets', 'nightscape', 'nights']

export const DEFAULT_HOME_MODULES: HomeModules = {
  order: [...HOME_MODULES],
  hidden: []
}
