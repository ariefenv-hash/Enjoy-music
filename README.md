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
- **PWA**：可安装到桌面 / 主屏幕；Service Worker 预缓存应用壳与演示资源，**断网也能打开并播放演示曲**；ORT wasm 首次使用后永久缓存，模型权重由 transformers.js Cache 持久化——离线分析二次可用
- **导出**：分析结果一键导出增强 LRC（词级 `<mm:ss.xx>` 标签）

## 镜像稳定性（/hf 代理）

- **上游故障转移链**：hf-mirror → huggingface.co，网络级故障自动熔断 30s 并切换（`HF_UPSTREAMS` 环境变量可覆盖，支持 http: 自定义镜像）
- **限流退避**：429/503/5xx 优先读 `Retry-After`，否则指数退避 + 抖动；429 触发全局冷却防重试风暴
- **断流续传**：长下载停顿检测（默认 45s，`HF_STALL_MS` 可调）→ 从已收字节 `Range + If-Range` 无缝拼接续传，客户端与磁盘缓存均无感知（次数上限 `HF_MAX_SPLICES`）
- **并发控制**：上游请求信号量限流（默认 6），降低触发风控概率；响应头 `x-hf-upstream` 可查实际使用上游

## 浏览器侧下载源回退（Worker）

服务端代理只存在于 dev / preview / 自托管；GitHub Pages 纯静态托管下，Worker 自己负责选源：

- **回退链**：镜像源模式 = 本站 `/hf` 代理 → `hf-mirror.com`（大陆可直连，LFS 重定向全链 CORS 有效）→ `huggingface.co`；直连模式 = huggingface.co → hf-mirror.com
- **连通性探测**：加载前先探测各源（config.json 小文件 + 6s 超时，并发发起按优先顺序取首个可用源），被墙源快速跳过而不是无限挂起；探测全败按原顺序兑底（自定义模型 ID 可能假阴性）
- **停顿看门狗**：下载阶段 45s 无进度事件且未完成 → 判定源卡死，自动切换下一源
- **状态透明**：每步切换都在 UI 显示“X 加载失败（原因），切换 Y…”，全败时报所有源不可用

## 模型持久化

权重首次使用时经本站 `/hf/` 代理下载，随后：

1. **浏览器 Cache API** 缓存（同会话零下载）
2. **服务器磁盘缓存** `.hf-cache/`（dev 与 preview 同享）——预览环境清空浏览器缓存后，权重仍从本地磁盘秒出，不会重新从 hf-mirror 拉取

> 部署到 GitHub Pages 等纯静态托管（无 `/hf/` 代理）时，Worker 自动探测并回退：`hf-mirror.com`（大陆推荐）→ `huggingface.co`，无需配置。

## 在线访问（GitHub Pages）

推送到 `main` 后自动构建部署：**https://ariefenv-hash.github.io/Enjoy-music/**

- workflow：`.github/workflows/pages.yml`（bun install → `build:pages`（base=/Enjoy-music/）→ deploy-pages）
- 首次启用：仓库 Settings → Pages → Source 选 **GitHub Actions**（或由 API `build_type=workflow` 自动开启）
- ORT wasm 与演示资源位于 `public/`，构建时随 `dist/` 一起发布，子路径下开箱即用
- 安装到桌面 / 手机：浏览器地址栏「安装」按钮（PWA manifest + Service Worker 自动生效）

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
