import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'

/** 运行日志目录（位于数据目录内），按天一个文件，保留最近 14 天 */
export const LOG_DIR = 'logs'
const KEEP = 14
const NAME_RE = /^app-(\d{4}-\d{2}-\d{2})\.log$/

export function logDir(dataDir: string) {
  return path.join(dataDir, LOG_DIR)
}

function dayString(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function stamp(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dayString(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function logPath(dataDir: string, d = new Date()) {
  return path.join(logDir(dataDir), `app-${dayString(d)}.log`)
}

export function writeLog(dataDir: string, level: 'INFO' | 'WARN' | 'ERROR', args: unknown[]) {
  const line = `${stamp()} [${level}] ${util.format(...(args as [unknown, ...unknown[]]))}\n`
  try {
    fs.mkdirSync(logDir(dataDir), { recursive: true })
    fs.appendFileSync(logPath(dataDir), line, 'utf8')
  } catch {
    /* 日志写不进去不能影响主流程 */
  }
}

/** 只保留最近 KEEP 个日志文件 */
export function pruneLogs(dataDir: string) {
  const dir = logDir(dataDir)
  let names: string[] = []
  try {
    names = fs.readdirSync(dir).filter((name) => NAME_RE.test(name))
  } catch {
    return
  }
  for (const name of names.sort().reverse().slice(KEEP)) {
    try {
      fs.rmSync(path.join(dir, name), { force: true })
    } catch {
      /* 删不掉就留给下次 */
    }
  }
}

export function logStats(dataDir: string) {
  const dir = logDir(dataDir)
  let files = 0
  let bytes = 0
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!NAME_RE.test(name)) continue
      files++
      try {
        bytes += fs.statSync(path.join(dir, name)).size
      } catch {
        /* 正被写入时忽略 */
      }
    }
  } catch {
    /* 还没有日志 */
  }
  return { dir, files, bytes }
}

let patched = false

/**
 * 接管 console.error / console.warn，并记录未捕获异常。
 * 只在主进程启动时调用一次；控制台输出保持不变。
 */
export function initLogger(dataDir: string) {
  if (patched) return
  patched = true
  const originalError = console.error.bind(console)
  const originalWarn = console.warn.bind(console)
  console.error = (...args: unknown[]) => {
    originalError(...args)
    writeLog(dataDir, 'ERROR', args)
  }
  console.warn = (...args: unknown[]) => {
    originalWarn(...args)
    writeLog(dataDir, 'WARN', args)
  }
  process.on('uncaughtException', (err) => {
    writeLog(dataDir, 'ERROR', ['未捕获异常:', err?.stack ?? err])
    originalError(err)
  })
  process.on('unhandledRejection', (reason) => {
    writeLog(dataDir, 'ERROR', ['未处理的 Promise 拒绝:', reason])
  })
  pruneLogs(dataDir)
}
