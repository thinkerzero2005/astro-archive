import fs from 'node:fs'
import path from 'node:path'
import { openDatabase } from '../src/main/db'
import {
  deferInboxFiles,
  listDeferred,
  listInbox,
  restoreInboxFiles,
  stageInboxPaths
} from '../src/main/inbox'

const base = process.env.TESTBASE!

function ok(cond: unknown, message: string) {
  if (!cond) {
    console.error('FAIL: ' + message)
    process.exit(1)
  }
  console.log('ok - ' + message)
}

async function main() {
  fs.rmSync(base, { recursive: true, force: true })
  const lib = path.join(base, 'library')
  for (const dir of ['01_深空', '02_星野', '_收件箱']) fs.mkdirSync(path.join(lib, dir), { recursive: true })
  const db = openDatabase(path.join(base, 'data'))

  // ---------- 源目录：一个子文件夹 + 一张成片 + 一个不支持的文件 ----------
  const src = path.join(base, 'source')
  const sessionDir = path.join(src, 'M31_2026-11-20')
  fs.mkdirSync(sessionDir, { recursive: true })
  const shot = path.join(sessionDir, 'M31_final.jpg')
  fs.writeFileSync(shot, Buffer.alloc(100, 7))
  fs.writeFileSync(path.join(sessionDir, 'notes.txt'), 'ignore me')
  const mtime = new Date('2026-11-20T22:00:00Z')
  fs.utimesSync(shot, mtime, mtime)

  // ---------- 文件夹 / 拖拽导入 ----------
  const progress: number[] = []
  const first = await stageInboxPaths(lib, [src], (p) => progress.push(p.done))
  ok(first.ok && first.copied === 1, '文件夹导入只复制支持的格式')
  ok(!!first.batchRel && first.batchRel.startsWith('_收件箱/'), '批次目录位于收件箱下')
  const copied = path.join(lib, String(first.batchRel), 'source', 'M31_2026-11-20', 'M31_final.jpg')
  ok(fs.existsSync(copied), '复制时保留文件夹层级')
  ok(fs.existsSync(shot), '源文件保持不动')
  ok(Math.abs(fs.statSync(copied).mtimeMs - mtime.getTime()) < 1500, '复制后保留原始 mtime')
  ok(progress.length > 0, '复制过程有进度回调')

  // ---------- 重复导入：文件名 + 大小 + mtime ----------
  const second = await stageInboxPaths(lib, [src])
  ok(second.copied === 0, '重复导入不产生副本')
  ok(second.skipped.some((s) => s.reason.includes('重复')), '重复项列入跳过报告')

  // ---------- 不支持格式 / 素材库内路径 ----------
  const third = await stageInboxPaths(lib, [path.join(sessionDir, 'notes.txt'), copied])
  ok(third.copied === 0, '不支持格式与库内路径都不复制')
  ok(third.skipped.some((s) => s.reason.includes('不支持')), '不支持的格式有说明')
  ok(third.skipped.some((s) => s.reason.includes('素材库内')), '库内路径有说明')

  // ---------- 暂不整理 ----------
  const rel = path.relative(lib, copied).split(path.sep).join('/')
  const deferred = deferInboxFiles(db, lib, [rel])
  ok(deferred.ok && deferred.moved === 1, '移到暂不整理成功')
  const afterDefer = await listInbox(db, lib)
  ok(!afterDefer.files.some((f) => f.fileName === 'M31_final.jpg'), '暂不整理文件不出现在待整理列表')
  const paused = listDeferred(lib)
  ok(paused.length === 1 && paused[0].relPath.startsWith('_收件箱/_暂不整理/'), '暂不整理列表可读取')

  // ---------- 移回收件箱 ----------
  const restored = restoreInboxFiles(db, lib, [paused[0].relPath])
  ok(restored.ok && restored.moved === 1, '移回收件箱成功')
  const afterRestore = await listInbox(db, lib)
  ok(afterRestore.files.some((f) => f.fileName === 'M31_final.jpg'), '移回后重新出现在待整理列表')
  ok(listDeferred(lib).length === 0, '移回后暂不整理列表清空')

  // ---------- 非法路径 ----------
  const bad = deferInboxFiles(db, lib, ['01_深空/M31.jpg'])
  ok(!bad.ok && bad.errors.length > 0, '非收件箱路径被拒绝')

  db.close()
  fs.rmSync(base, { recursive: true, force: true })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
