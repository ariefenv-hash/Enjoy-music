/**
 * 分析流水线编排：解码 → 预处理(人声增强) → VAD 切分 → Whisper 分段转写 → 对齐
 * 全程浏览器本地运行，无服务端、无限流。
 */
import { decodeAudioFile } from './decode'
import { computeRmsEnvelope } from './dsp'
import { asrEngine, detectWebGPU, type EngineWord } from './asr/engine'
import { presetByKey, presetOfModelId, resolveModelId } from './asr/presets'
import { alignLyricsToWords, type RawLine } from './align'
import { parseLyricsFile, plainLines, wordsToLines, type LyricLine } from './lyrics'
import type { AnalysisMeta, AnalysisProgress, AppSettings, SongProject, StageId, StageInfo, LyricsSource } from '../types'

export interface AnalyzeCallbacks {
  onProgress: (p: AnalysisProgress) => void
  signal?: { aborted: boolean }
}

function stages(list: { id: StageId; label: string }[]): StageInfo[] {
  return list.map((s) => ({ ...s, state: 'pending' as const }))
}

export interface AnalyzeInput {
  file: Blob
  fileName: string
  /** 用户歌词文件内容（可选） */
  lyricsText?: string
  settings: AppSettings
}

export async function analyze(input: AnalyzeInput, cb: AnalyzeCallbacks): Promise<SongProject> {
  const t0 = performance.now()
  const stageDefs: { id: StageId; label: string }[] = [
    { id: 'decode', label: '解码音频 · 16kHz 单声道' },
    { id: 'preprocess', label: '预处理 · 归一化 + 人声增强' },
    { id: 'vad', label: 'VAD · 跳过间奏切分段落' },
    { id: 'model', label: '加载模型 · ' },
    { id: 'asr', label: '语音转写 · 词级时间戳' },
    { id: 'align', label: '歌词对齐' },
    { id: 'done', label: '完成' },
  ]
  const st = stages(stageDefs)
  const stageTimes: Record<string, number> = {}
  const log: string[] = []

  const emit = (logMsg?: string, detail?: number) => {
    if (logMsg) log.push(logMsg)
    cb.onProgress({
      stages: st.map((s) => ({ ...s })),
      log: log.slice(-3).join('\n'),
      detail,
    })
  }
  const setStage = (id: StageId, state: StageInfo['state'], ms?: number) => {
    const s = st.find((x) => x.id === id)
    if (s) {
      s.state = state
      if (ms != null) s.ms = ms
    }
  }
  const stage = async <T,>(id: StageId, fn: () => T | Promise<T>): Promise<T> => {
    setStage(id, 'active')
    emit()
    const t = performance.now()
    try {
      const r = await fn()
      setStage(id, 'done', performance.now() - t)
      stageTimes[id] = performance.now() - t
      emit()
      return r
    } catch (e) {
      setStage(id, 'pending')
      throw e
    }
  }

  const abortedCheck = () => {
    if (cb.signal?.aborted) throw new Error('cancelled')
  }

  // 1) 解码
  const dec = await stage('decode', async () => {
    emit(`读取 ${input.fileName}`)
    return decodeAudioFile(input.file)
  })
  abortedCheck()

  // 快速通道：歌词文件自带词级时间轴（增强 LRC / TTML / QRC）→ 跳过全部 ASR
  const lyricTextEarly = input.lyricsText?.trim()
  if (lyricTextEarly) {
    const parsedEarly = parseLyricsFile(lyricTextEarly)
    if (parsedEarly.length && parsedEarly.every((l) => l.words.length > 0)) {
      const tFast = performance.now()
      for (const s of st) s.state = 'done'
      const meta: AnalysisMeta = {
        model: '-',
        modelLabel: '歌词自带词级时间轴',
        language: 'auto',
        device: 'wasm',
        wordTimestamps: 'native',
        source: 'lrc-enhanced',
        elapsedMs: performance.now() - t0,
        audioSec: dec.duration,
        voicedSec: dec.duration,
        stages: { decode: performance.now() - tFast },
        createdAt: Date.now(),
      }
      emit(`歌词自带词级时间轴（${parsedEarly.length} 行），跳过识别直接可用`)
      setStage('done', 'done')
      cb.onProgress({ stages: st.map((s) => ({ ...s })), log: log.slice(-3).join('\n') })
      return {
        fileName: input.fileName,
        duration: dec.duration,
        lines: parsedEarly.map((l, i) => ({ ...l, index: i })),
        meta,
      }
    }
  }

  // 2/3) 预处理 + VAD（worker 内）
  try {
    const preset = presetByKey(input.settings.preset)
    const modelId = resolveModelId(input.settings.preset, input.settings.customModel)
    const modelPreset = input.settings.customModel.trim() ? presetOfModelId(modelId) : preset
    ;(st.find((s) => s.id === 'model')!).label = `加载模型 · ${modelPreset.label}`

    const dsp = await stage('preprocess', async () => {
      setStage('vad', 'active')
      return asrEngine.dsp(dec.audio, input.settings.vocalEnhance, (msg) => emit(msg))
    })
    abortedCheck()
    const segments = dsp.segments
    setStage('vad', 'done', 0)
    stageTimes['vad'] = 0
    const voicedSec = segments.reduce((s, g) => s + (g.end - g.start), 0)
    emit(
      `共 ${segments.length} 个有效人声段，总时长 ${voicedSec.toFixed(1)}s / ${dec.duration.toFixed(1)}s` +
        `（VAD 跳过 ${((1 - voicedSec / dec.duration) * 100).toFixed(0)}% 非人声）`,
    )

    // 设备选择
    const wantWebGPU = await detectWebGPU()
    const device: 'webgpu' | 'wasm' = wantWebGPU ? 'webgpu' : 'wasm'
    const dtype = device === 'webgpu' ? modelPreset.dtypeWebGPU : modelPreset.dtypeWasm

    // 4/5) 模型 + 转写
    let asrWords: EngineWord[] = []
    let usedDevice: 'webgpu' | 'wasm' = device
    let usedFallback = false
    let detectedLang = input.settings.language

    await stage('model', async () => {
      setStage('asr', 'active')
      const r = await asrEngine.run(
        {
          audio: dsp.audio,
          segments,
          language: input.settings.language,
          model: modelId,
          device,
          mirror: input.settings.mirror,
          dtype,
        },
        {
          onStatus: (m) => emit(m),
          onDownload: (d) => emit(`下载模型权重 ${d.file.split('/').pop() ?? ''} ${d.progress.toFixed(0)}%`, d.progress / 100),
          onDevice: (dv) => {
            usedDevice = dv
            emit(`推理设备：${dv.toUpperCase()}`)
          },
          onLanguage: (lang) => {
            detectedLang = lang as typeof detectedLang
            emit(`检测到语言：${lang}`)
          },
          onSegment: (seg) => {
            emit(`转写段落 ${seg.index + 1}/${seg.total}：${seg.text.slice(0, 42)}`, seg.progress)
          },
        },
        () => cb.signal?.aborted === true,
      )
      asrWords = r.words
      // 过滤 Whisper 的 [Music] / (Gibberish) 类幻觉标记（无歌词价值）
      const MARKER_RE =
        /^[\[(（]\s*(music|gibberish|applause|laughter|instrumental|interlude|singing|rest|silence|blues|music\.|♪+)\s*[\])）。,，:：!！.\s]*$/i
      asrWords = asrWords.filter((w) => !MARKER_RE.test(w.text.trim()))
      usedFallback = r.fallback
      abortedCheck()
    })

    // 6) 对齐 / 组行
    const project = await stage('align', () => {
      let lines: LyricLine[] = []
      let source: LyricsSource = 'asr'
      let alignRatio: number | undefined

      const lyricText = input.lyricsText?.trim()
      if (lyricText) {
        const parsed = parseLyricsFile(lyricText)
        if (parsed.length && parsed.every((l) => l.words.length > 0)) {
          // 增强 LRC / TTML / QRC：直接使用实测词级时间
          lines = parsed.map((l, i) => ({ ...l, index: i }))
          source = 'lrc-enhanced'
          emit(`歌词文件自带词级时间轴（${lines.length} 行），跳过对齐`)
        } else if (parsed.length) {
          // 行级 LRC：行时间锚点 + ASR 词级细化
          const raw: RawLine[] = parsed.map((l) => ({
            text: l.text,
            anchor: l.start,
            bound: l.end,
          }))
          const r = alignLyricsToWords(raw, asrWords, dec.duration)
          lines = r.lines
          alignRatio = r.ratio
          source = 'lrc-timed'
          emit(`行级 LRC 锚点对齐完成，匹配率 ${(r.ratio * 100).toFixed(0)}%`)
        } else {
          const raw: RawLine[] = plainLines(lyricText).map((text) => ({ text }))
          const r = alignLyricsToWords(raw, asrWords, dec.duration)
          lines = r.lines
          alignRatio = r.ratio
          source = 'aligned'
          emit(`强制对齐完成，字符匹配率 ${(r.ratio * 100).toFixed(0)}%`)
        }
      } else {
        // 能量包络（在增强后的人声音频上计算，换气凹陷更明显）
        const env = computeRmsEnvelope(dsp.audio)
        lines = wordsToLines(asrWords, dec.duration, env)
        source = 'asr'
        emit(`ASR 直接输出 ${lines.length} 行（按换气/停顿分行）`)
      }

      const meta: AnalysisMeta = {
        model: modelId,
        modelLabel: modelPreset.label,
        language: detectedLang,
        device: usedDevice,
        wordTimestamps: usedFallback ? 'fallback' : 'native',
        source,
        alignRatio,
        elapsedMs: performance.now() - t0,
        audioSec: dec.duration,
        voicedSec,
        stages: stageTimes,
        createdAt: Date.now(),
      }
      return { fileName: input.fileName, duration: dec.duration, lines, meta } satisfies SongProject
    })

    setStage('done', 'active')
    emit(`完成：${project.lines.length} 行 / ${project.lines.reduce((s, l) => s + l.words.length, 0)} 词`)
    setStage('done', 'done')
    cb.onProgress({ stages: st.map((s) => ({ ...s })), log: log.slice(-3).join('\n') })
    return project
  } finally {
    // 引擎为全局单例，保留 worker 与已加载模型供下次分析复用
  }
}

/** 解析歌词文件 → RawLine 列表（供外部判断输入类型） */
export function inspectLyrics(text: string): { kind: 'enhanced' | 'lrc' | 'plain'; lines: RawLine[]; count: number } {
  const parsed = parseLyricsFile(text)
  if (parsed.length && parsed.every((l) => l.words.length > 0)) {
    return { kind: 'enhanced', lines: parsed.map((l) => ({ text: l.text, anchor: l.start, bound: l.end })), count: parsed.length }
  }
  if (parsed.length) return { kind: 'lrc', lines: parsed.map((l) => ({ text: l.text, anchor: l.start, bound: l.end })), count: parsed.length }
  const plain = plainLines(text)
  return { kind: 'plain', lines: plain.map((t) => ({ text: t })), count: plain.length }
}
