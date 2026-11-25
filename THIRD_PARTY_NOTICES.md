# 第三方组件与许可

星空档案馆（Astro Archive）自身以 MIT 许可发布，见 [LICENSE](LICENSE)。
软件在运行时依赖或打包了以下第三方组件，它们遵循各自的许可协议。

## 运行时依赖

| 组件 | 用途 | 许可 |
| --- | --- | --- |
| [sharp](https://github.com/lovell/sharp) | 缩略图生成与图像处理 | Apache-2.0 |
| [tesseract.js](https://github.com/naptha/tesseract.js) | 拍摄水印 OCR 识别 | Apache-2.0 |
| [exifr](https://github.com/MikeKovarik/exifr) | EXIF 元数据解析 | MIT |
| [Electron](https://github.com/electron/electron) | 桌面运行时 | MIT |
| [React](https://github.com/facebook/react) / [React DOM](https://github.com/facebook/react) | 界面渲染 | MIT |
| [Vite](https://github.com/vitejs/vite) | 前端构建（仅开发/构建期） | MIT |
| [esbuild](https://github.com/evanw/esbuild) | 脚本打包（仅开发/构建期） | MIT |
| [electron-builder](https://github.com/electron-userland/electron-builder) | 安装包构建（仅开发/构建期） | MIT |
| [TypeScript](https://github.com/microsoft/TypeScript) | 类型检查（仅开发/构建期） | Apache-2.0 |

## 语言数据

- `app/assets/tessdata/chi_sim.traineddata` 取自 [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast)，
  许可为 Apache-2.0，来源为 Tesseract OCR 项目。

## 说明

- 上述组件的完整许可文本可在各自仓库或许可文件中查阅。
- 若后续新增依赖，请同步更新本文件。
