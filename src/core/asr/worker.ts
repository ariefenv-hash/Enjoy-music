/**
 * ASR Worker：模型加载 + 分段转写 + 词级时间戳
 * 独立线程运行，UI 保持 60fps；模型经 Cache API 缓存（二次分析零下载）
 */
import { pipeline, env } from '@huggingface/transformers'
import { preprocess, segmentVAD, type Segment } from '../dsp'
import { estimateWords } from '../lyrics'

env.allowLocalModels = false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const onnxEnv = (env as any).backends?.onnx
if (onnxEnv?.wasm) {
  onnxEnv.wasm.proxy = false
  // ORT wasm 运行时走本地（public/ort），不依赖 jsdelivr CDN；
  // BASE_URL 兼容子路径部署（如 GitHub Pages /Enjoy-music/）
  onnxEnv.wasm.wasmPaths = `${import.meta.env.BASE_URL}ort/`
}

type AnyPipe = {
  (audio: Float32Array, opts: Record<string, unknown>): Promise<{
    text: string
    chunks?: { text: string; timestamp: [number, number | null] }[]
  }>
}

let pipe: AnyPipe | null = null
let loadedKey = ''
let aborted = false

interface LoadOpts {
  model: string
  device: 'webgpu' | 'wasm'
  dtype: Record<string, string> | string
  mirror: 'mirror' | 'hf'
}

function post(msg: Record<string, unknown>): void {
  ;(self as unknown as Worker).postMessage(msg)
}

const HF_DIRECT = 'https://huggingface.co/'

async function ensurePipe(opts: LoadOpts): Promise<{ pipe: AnyPipe; device: 'webgpu' | 'wasm' }> {
  // 'mirror' = 走本站 /hf/ 代理（服务端转发 hf-mirror，无 CORS/指纹问题）；
  // GitHub Pages 等纯静态托管没有该代理 → 404 后自动回退直连 huggingface.co
  const origin = (self as unknown as { location: { origin: string } }).location.origin
  const host0 = opts.mirror === 'mirror' ? `${origin}/hf/` : HF_DIRECT
  const hosts = host0 === HF_DIRECT ? [HF_DIRECT] : [host0, HF_DIRECT]

  const attempts: { device: 'webgpu' | 'wasm'; dtype: any }[] = [
    { device: opts.device, dtype: opts.dtype },
    // 失败回退：webgpu→wasm q8 / wasm→q8
    { device: 'wasm', dtype: 'q8' },
  ]
  let lastErr: unknown
  for (const att of attempts) {
    if (att.device === 'webgpu' && !(self as any).navigator?.gpu) {
      lastErr = new Error('WebGPU 不可用')
      continue
    }
    for (const host of hosts) {
      const key = `${opts.model}|${att.device}|${JSON.stringify(att.dtype)}|${host}`
      if (pipe && loadedKey === key) return { pipe: pipe!, device: att.device }
      try {
        env.remoteHost = host
        const viaMirror = host !== HF_DIRECT
        post({ type: 'status', msg: `加载模型 ${opts.model}（${att.device}${viaMirror ? ' · 镜像' : ''}）…` })
        pipe = (await (pipeline as any)('automatic-speech-recognition', opts.model, {
          device: att.device,
          dtype: att.dtype,
          progress_callback: (p: Record<string, unknown>) => {
            if (p.status === 'progress') {
              post({
                type: 'download',
                file: String(p.file ?? ''),
                progress: Number(p.progress ?? 0),
                loaded: Number(p.loaded ?? 0),
                total: Number(p.total ?? 0),
              })
            } else if (p.status === 'done') {
              post({ type: 'downloadDone', file: String(p.file ?? '') })
            }
          },
        })) as AnyPipe
        loadedKey = key
        post({ type: 'device', device: att.device })
        return { pipe: pipe!, device: att.device }
      } catch (e) {
        lastErr = e
        pipe = null
        if (host !== HF_DIRECT) {
          post({ type: 'status', msg: '镜像源不可用，改用 huggingface.co 直连重试…' })
        }
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** 幻觉标记：整段/整 chunk 命中则丢弃（word 级短语会被拆散，必须在 chunk 级过滤） */
const MARKER_RE =
  /^[\[(（{*]\s*(music|gibberish|applause|laughter|instrumental|interlude|singing|rest|silence|blues|♪+|speaking in foreign language|speaking a foreign language|foreign language|mimicking|inaudible|humming|chatter|background noise)[\])）。,，:：!！.*}\s]*$/i

/** 检测语言（累计文本启发式，仅用于 UI 报告） */
function guessLanguage(text: string): string {
  if (/[\u3040-\u30ff]/.test(text)) return 'ja'
  if (/[\uac00-\ud7af]/.test(text)) return 'ko'
  if (/[\u4e00-\u9fff]/.test(text)) {
    const yueChars = (text.match(/[嘅咗喺冇乜唔啲睇佢嚟攞諗谂搵噉嘢]/g) || []).length
    return yueChars >= 2 ? 'yue' : 'zh'
  }
  return 'en'
}

interface RunOpts {
  audio: Float32Array
  segments: Segment[]
  language: string // 'auto' 或语言代码
  model: string
  device: 'webgpu' | 'wasm'
  mirror: 'mirror' | 'hf'
  dtype: Record<string, string> | string
}

async function runAsr(opts: RunOpts): Promise<void> {
  // transformers.js 3.8 语言表不含 yue，直接传会抛错 → 选粤语时回退 zh：
  // Whisper 按普通话 token 输出汉字（同音字由强制对齐纠正），人声增强+歌词对齐保准确率
  const rawLang = opts.language === 'auto' ? undefined : opts.language
  if (rawLang === 'yue') {
    post({ type: 'status', msg: '粤语按中文（zh）识别：同音字由歌词对齐自动纠正，建议提供歌词文本' })
  }
  const lang = rawLang === 'yue' ? 'zh' : rawLang
  const { pipe: asrPipe, device } = await ensurePipe({
    model: opts.model,
    device: opts.device,
    dtype: opts.dtype,
    mirror: opts.mirror,
  })

  const totalVoiced = opts.segments.reduce((s, g) => s + (g.end - g.start), 0) || 1
  let doneVoiced = 0
  const allWords: { text: string; start: number; end: number }[] = []
  let detected = lang
  let guessBuf = ''
  let usedFallback = false

  for (let i = 0; i < opts.segments.length; i++) {
    if (aborted) {
      post({ type: 'cancelled' })
      return
    }
    const seg = opts.segments[i]
    const s0 = Math.max(0, Math.floor(seg.start * 16000))
    const s1 = Math.min(opts.audio.length, Math.ceil(seg.end * 16000))
    const chunk = opts.audio.slice(s0, s1)
    // auto 模式不锁语言：首段常是短音节（如 "oh yeah"），全局锁定会把中文歌锁成英文幻觉；
    // 交给 Whisper 逐段自检，各段独立判定
    const useLang = lang
    const baseOpts: Record<string, unknown> = {
      chunk_length_s: 30,
      stride_length_s: 5,
      task: 'transcribe',
      return_timestamps: 'word',
    }
    if (useLang) baseOpts.language = useLang

    let chunks: { text: string; timestamp: [number, number | null] }[] | undefined
    try {
      const out = await asrPipe(chunk, baseOpts as any)
      chunks = out.chunks ?? (out.text ? [{ text: out.text, timestamp: [0, chunk.length / 16000] }] : [])
    } catch {
      // 词级时间戳失败 → 降级为段级 + 本地按权重切分
      usedFallback = true
      const out2 = await asrPipe(chunk, { ...baseOpts, return_timestamps: 'segment' } as any)
      chunks = out2.chunks ?? (out2.text ? [{ text: out2.text, timestamp: [0, chunk.length / 16000] }] : [])
    }

    // 语言报告：累计足够文本再猜，避免以偏概全（不影响转写本身）
    if (!detected) {
      guessBuf += chunks.map((c) => c.text).join('')
      if (guessBuf.replace(/\s/g, '').length >= 12 || i === opts.segments.length - 1) {
        detected = guessLanguage(guessBuf)
        post({ type: 'language', language: detected })
      }
    }

    // 转换为绝对时间词：词级模式直接用；段级降级时 chunks 是句子级 → 本地按权重切分
    const words: { text: string; start: number; end: number }[] = []
    for (let c = 0; c < chunks.length; c++) {
      const ch = chunks[c]
      if (!ch.text || MARKER_RE.test(ch.text.trim())) continue
      const [rs, re] = ch.timestamp
      const start = (rs ?? 0) + seg.start
      let end = (re ?? rs ?? 0) + seg.start
      if (!(end > start)) {
        const nextStart = chunks[c + 1]?.timestamp?.[0]
        end = nextStart != null ? nextStart + seg.start : start + 0.3
      }
      if (!isFinite(end)) end = start + 0.3
      if (usedFallback) words.push(...estimateWords(ch.text, start, end))
      else words.push({ text: ch.text, start, end })
    }

    allWords.push(...words)
    doneVoiced += seg.end - seg.start
    post({
      type: 'segmentDone',
      index: i,
      total: opts.segments.length,
      words,
      progress: doneVoiced / totalVoiced,
      text: words.map((w) => w.text).join(''),
    })
  }

  post({ type: 'done', words: allWords, device, fallback: usedFallback, language: detected ?? lang ?? 'auto' })
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data
  try {
    if (m.type === 'dsp') {
      post({ type: 'status', msg: '预处理音频…' })
      const audio = preprocess(m.audio as Float32Array, m.vocalEnhance, (r, msg) =>
        post({ type: 'status', msg: `${msg}` }),
      )
      post({ type: 'status', msg: '检测人声段落…' })
      const segments = segmentVAD(audio)
      post({ type: 'dspDone', audio, segments })
      return
    }
    if (m.type === 'run') {
      aborted = false
      await runAsr(m as RunOpts)
      return
    }
    if (m.type === 'cancel') {
      aborted = true
      return
    }
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err))
    post({ type: 'error', message: e.message, stack: (e.stack ?? '').slice(0, 500) })
  }
}
