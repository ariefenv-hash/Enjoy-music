# Enjoy-music · 逐字歌词工坊

纯前端卡拉 OK 播放器：**React + Vite + TypeScript** 三件套手搭（无 Next.js）。
上传任意歌曲，浏览器本地完成歌词分析与**逐字（word-level）时间轴**提取，实现 Material Design 3 风格的逐字跟随卡拉 OK。

## 功能

- **上传即分析**：mp3 / wav / m4a / flac / ogg，全程浏览器本地推理（Web Worker + WebGPU/WASM），无服务端、无 API 限流
- **逐字跟随**：Whisper 词级时间戳（cross-attention DTW）+ 能量包络换气分行；渲染层 rAF 直写 CSS 变量，60fps 扫色
- **歌词对齐**：自带歌词（纯文本 / LRC / 增强 LRC / TTML / QRC）时走强制对齐，识别即使有同音字错误，时间戳仍然精准；自带词级时间轴的文件 0.2s 秒出
- **粤语支持**：高质量档建议 + 自定义模型 ID 入口（微调粤语 ONNX 模型）+ 人声增强（HPSS 抑制伴奏）+ 强制对齐三重保障
- **提速**：16kHz 单声道直通、能量 VAD 跳过间奏、分段独立转写、量化模型（q4/q8）、模型双重持久缓存
- **MD3 主题**：明暗两套令牌；支持**上传壁纸自动取色**——Material You 同源算法（QuantizerCelebi + Score）提取 3 种视觉统一的颜色混搭成套主题
- **导出**：分析结果一键导出增强 LRC（词级 `<mm:ss.xx>` 标签）

## 模型持久化

权重首次使用时经本站 `/hf/` 代理下载，随后：

1. **浏览器 Cache API** 缓存（同会话零下载）
2. **服务器磁盘缓存** `.hf-cache/`（dev 与 preview 同享）——预览环境清空浏览器缓存后，权重仍从本地磁盘秒出，不会重新从 hf-mirror 拉取

## 开发

```bash
bun install   # 或 npm install
bun run dev   # http://localhost:3000
bun run build # tsc --noEmit + vite build
bun run preview
```

> `/hf/` 模型代理与 `/ort/` 静态服务内置于 `vite.config.ts`（dev 与 preview 均生效），无需额外配置。

## 结构

```
src/
  core/        # 音频解码 / DSP / VAD / 对齐 / 播放引擎
  core/asr/    # Whisper Worker（transformers.js v3）
  components/  # MD3 组件（TopBar / UploadPanel / LyricsStage / PlayerBar / SettingsSheet …）
  styles/      # MD3 令牌与组件样式（手写 M3 规范）
  theme.ts     # 主题系统：预设种子色 + 壁纸三色动态方案
```
