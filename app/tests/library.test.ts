import fs from 'node:fs'
import path from 'node:path'
import { inspectLibraryDir, prepareLibraryDir } from '../src/main/librarySetup'

const base = process.env.TESTBASE!

function ok(cond: unknown, message: string) {
  if (!cond) {
    console.error('FAIL: ' + message)
    process.exit(1)
  }
  console.log('ok - ' + message)
}

const STANDARD = [
  '01_深空',
  '02_星野',
  '_收件箱',
  '_dwarf mini校准场',
  '_dwarf mini校准场/bias',
  '_dwarf mini校准场/dark',
  '_dwarf mini校准场/flat'
]

fs.rmSync(base, { recursive: true, force: true })
fs.mkdirSync(base, { recursive: true })

// ---------- 空目录：一键建立标准结构 ----------
const emptyDir = path.join(base, 'empty')
fs.mkdirSync(emptyDir)
const check = inspectLibraryDir(emptyDir)
ok(check.exists && check.isDirectory, '空目录存在且是文件夹')
ok(check.empty && check.writable, '空目录可写')
ok(!check.isLibrary && !check.looksLikeSource, '空目录不误判为素材库或设备目录')
ok(check.missing.length === STANDARD.length, '空目录缺失全部标准目录')

const first = prepareLibraryDir(emptyDir)
ok(first.ok, '空目录建库成功')
for (const rel of STANDARD) {
  ok(fs.existsSync(path.join(emptyDir, rel)), `已创建 ${rel}`)
}

const again = prepareLibraryDir(emptyDir)
ok(again.ok && (again.created?.length ?? -1) === 0, '重复建库不重复创建目录')

// ---------- 非空目录：未确认时不改动 ----------
const busyDir = path.join(base, 'busy')
fs.mkdirSync(busyDir)
const note = path.join(busyDir, 'note.txt')
fs.writeFileSync(note, 'keep')
const denied = prepareLibraryDir(busyDir)
ok(!denied.ok && denied.needsConfirm === true, '非空目录需要二次确认')
ok(!fs.existsSync(path.join(busyDir, '01_深空')), '取消后没有创建任何目录')
ok(fs.readFileSync(note, 'utf8') === 'keep', '取消后原文件未被动')

const confirmed = prepareLibraryDir(busyDir, { allowNonEmpty: true })
ok(confirmed.ok, '确认后可以补建标准目录')
ok(fs.existsSync(path.join(busyDir, '02_星野')), '确认后标准目录已创建')
ok(fs.readFileSync(note, 'utf8') === 'keep', '确认后原文件仍未被覆盖')

// ---------- 只读目录：明确报错且不写入 ----------
const readOnlyDir = path.join(base, 'readonly')
fs.mkdirSync(readOnlyDir)
const roCheck = inspectLibraryDir(readOnlyDir, { probe: () => false })
ok(roCheck.writable === false, '只读目录识别为不可写')
const roPrepare = prepareLibraryDir(readOnlyDir, { probe: () => false })
ok(!roPrepare.ok && /不可写/.test(roPrepare.error ?? ''), '只读目录给出明确错误')
ok(!fs.existsSync(path.join(readOnlyDir, '01_深空')), '只读目录未写入任何内容')

// ---------- 设备原始素材目录：拒绝直接建库 ----------
const sourceDir = path.join(base, 'source')
fs.mkdirSync(path.join(sourceDir, 'Astronomy', 'DWARF_RAW_TELE'), { recursive: true })
const sourceCheck = inspectLibraryDir(sourceDir)
ok(sourceCheck.looksLikeSource && !sourceCheck.isLibrary, '识别设备原始素材目录')
const sourcePrepare = prepareLibraryDir(sourceDir)
ok(!sourcePrepare.ok && /设备原始素材目录/.test(sourcePrepare.error ?? ''), '设备素材目录被拒绝')
ok(!fs.existsSync(path.join(sourceDir, '01_深空')), '设备素材目录未被写入')

// ---------- 已是素材库：直接补缺 ----------
const libDir = path.join(base, 'library')
fs.mkdirSync(path.join(libDir, '01_深空'), { recursive: true })
fs.mkdirSync(path.join(libDir, '02_星野'), { recursive: true })
const libCheck = inspectLibraryDir(libDir)
ok(libCheck.isLibrary, '已有素材库被识别，无需确认')
const libPrepare = prepareLibraryDir(libDir)
ok(libPrepare.ok && libPrepare.created?.includes('_收件箱'), '已有素材库只补建缺失目录')

console.log('library tests done')
