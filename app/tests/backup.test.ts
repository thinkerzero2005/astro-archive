import fs from 'node:fs'
import path from 'node:path'
import { getSetting, openDatabase, setSetting } from '../src/main/db'
import { backupDir, dailyBackup, listBackups, restoreBackup } from '../src/main/backup'

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

  const db = openDatabase(data)
  setSetting(db, 'probe', 'original')

  const first = dailyBackup(db, data)
  ok(!!first, '当天首次备份生成文件')
  ok(fs.existsSync(path.join(backupDir(data), first!.fileName)), '备份文件落在 backups 目录')
  ok(listBackups(data).length === 1, '备份列表返回 1 份')

  dailyBackup(db, data)
  ok(listBackups(data).length === 1, '同一天重复调用不会新增备份')

  // 造 9 份旧备份，验证只保留最近 7 份（当天 + 6 份较新的旧备份）
  for (let day = 1; day <= 9; day++) {
    const name = `archive_2020-01-${String(day).padStart(2, '0')}.db`
    fs.writeFileSync(path.join(backupDir(data), name), Buffer.from('fake'))
  }
  dailyBackup(db, data)
  const list = listBackups(data)
  ok(list.length === 7, '超过 7 份时自动清理到 7 份')
  ok(list[0].fileName === first!.fileName, '最新备份排在最前')
  ok(!fs.existsSync(path.join(backupDir(data), 'archive_2020-01-01.db')), '最旧的备份被清理')
  ok(fs.existsSync(path.join(backupDir(data), 'archive_2020-01-09.db')), '较新的旧备份被保留')

  ok(!restoreBackup(data, '../archive.db').ok, '拒绝路径穿越的文件名')
  ok(!restoreBackup(data, 'archive_1999-01-01.db').ok, '拒绝不存在的备份')

  setSetting(db, 'probe', 'changed')
  db.close()
  const restored = restoreBackup(data, first!.fileName)
  ok(restored.ok, '恢复备份成功')
  ok(!!restored.safetyFile && fs.existsSync(path.join(data, restored.safetyFile)), '恢复前另存当前数据库')
  ok(!fs.existsSync(path.join(data, 'archive.db-wal')), '恢复后清理 -wal')
  ok(!fs.existsSync(path.join(data, 'archive.db-shm')), '恢复后清理 -shm')

  const reopened = openDatabase(data)
  ok(getSetting(reopened, 'probe') === 'original', '恢复后数据回到备份时的状态')
  reopened.close()

  fs.rmSync(base, { recursive: true, force: true })
  console.log('backup tests passed')
}

main()
