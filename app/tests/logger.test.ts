import fs from 'node:fs'
import path from 'node:path'
import { initLogger, logDir, logPath, logStats, pruneLogs } from '../src/main/logger'

const base = process.env.TESTBASE!
const data = path.join(base, 'data')

function ok(cond: unknown, message: string) {
  if (!cond) {
    console.error('FAIL: ' + message)
    process.exit(1)
  }
  console.log('ok - ' + message)
}

function main() {
  fs.rmSync(base, { recursive: true, force: true })
  fs.mkdirSync(data, { recursive: true })

  initLogger(data)
  console.error('测试错误：磁盘已满')
  console.warn('测试警告：同步跳过')
  console.log('普通日志不落盘')

  const file = logPath(data)
  ok(fs.existsSync(file), '当天日志文件已生成')
  const text = fs.readFileSync(file, 'utf8')
  ok(text.includes('[ERROR] 测试错误：磁盘已满'), 'console.error 写入日志')
  ok(text.includes('[WARN] 测试警告：同步跳过'), 'console.warn 写入日志')
  ok(!text.includes('普通日志不落盘'), 'console.log 不写入日志')
  ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(text), '日志行带时间戳')

  for (let day = 1; day <= 20; day++) {
    fs.writeFileSync(path.join(logDir(data), `app-2020-01-${String(day).padStart(2, '0')}.log`), 'old')
  }
  pruneLogs(data)
  const names = fs.readdirSync(logDir(data))
  ok(names.length === 14, '只保留最近 14 个日志文件（实际 ' + names.length + '）')
  ok(!names.includes('app-2020-01-07.log'), '更早的日志被清理')
  ok(names.includes('app-2020-01-08.log'), '较新的日志被保留')

  const stats = logStats(data)
  ok(stats.dir === logDir(data), '统计返回日志目录')
  ok(stats.files === 14 && stats.bytes > 0, '统计文件数与占用')

  fs.rmSync(base, { recursive: true, force: true })
  console.log('logger tests passed')
}

main()
