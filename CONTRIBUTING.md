# 参与贡献

欢迎提交 Issue 和 Pull Request。提交前请先确认下面几点。

## 开发环境

- Windows 10 / 11 x64
- Node.js ≥ 22.5（测试与数据库依赖内置 `node:sqlite`）
- 在 `app` 目录执行 `npm install`

## 提交前自检

```powershell
cd app
npm run typecheck
npm test
npm run build
```

三项必须全部通过。CI 会在 Windows 上重复执行同样的检查。

## 代码约定

- 使用 TypeScript，保持现有目录分层：主进程逻辑在 `app/src/main`，界面在 `app/src/renderer`。
- 数据库只做增量迁移：在 `db.ts` 中提升 `SCHEMA_VERSION` 并追加迁移分支，不修改历史迁移。
- 新增可撤销的文件操作时，复用现有 `change_log` 与撤销链路。
- 中文文案与现有界面保持一致，避免中英混排。

## 测试数据

- **不要**把真实素材库、个人照片、本机绝对路径提交到仓库。
- 测试统一使用临时目录（`os.tmpdir()` + `mkdtemp`），结束后自行清理。
- 需要真机数据的用例通过环境变量开启（`ASTRO_REAL_DEVICE`、`ASTRO_REAL_SAMPLE`），未设置时应跳过而不是失败。

## Pull Request

- 一个 PR 只做一件事，附上变更说明与验证方式。
- 涉及界面变化的，请附截图（注意脱敏本机路径）。
- 涉及数据库变更的，请说明升级路径与旧数据兼容性。
