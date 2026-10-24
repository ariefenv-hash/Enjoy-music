/** 全局类型定义 */

export interface LyricWord {
  text: string
  start: number
  end: number
  isPause?: boolean
  estimated?: boolean
}

export interface LyricLine {
  index: number
  text: string
  start: number
  end: number
  words: LyricWord[]
  /** 用户文本与 ASR 结果的对齐置信度 0~1（强制对齐时存在） */
  confidence?: number
}

/** 歌词来源 */
export type LyricsSource =
  | 'asr' // 纯 ASR 识别
  | 'aligned' // 用户文本 + ASR 强制对齐
  | 'lrc-timed' // 用户 LRC 已带行级时间 → 词级细化
  | 'lrc-enhanced' // 用户增强 LRC / TTML / QRC，直接使用
  | 'demo'

export interface AnalysisMeta {
  model: string
  modelLabel: string
  language: string
  device: 'webgpu' | 'wasm'
  wordTimestamps: 'native' | 'fallback'
  source: LyricsSource
  alignRatio?: number
  elapsedMs: number
  audioSec: number
  voicedSec: number
  stages: Record<string, number>
  createdAt: number
}

export interface SongProject {
  fileName: string
  duration: number
  lines: LyricLine[]
  meta: AnalysisMeta
}

export type StageId =
  | 'decode'
  | 'preprocess'
  | 'vad'
  | 'model'
  | 'asr'
  | 'align'
  | 'done'

export interface StageInfo {
  id: StageId
  label: string
  state: 'pending' | 'active' | 'done'
  ms?: number
}

export interface AnalysisProgress {
  stages: StageInfo[]
  log: string
  /** 0~1，模型下载或转写进度 */
  detail?: number
}

export type LangId = 'auto' | 'zh' | 'yue' | 'en' | 'ja' | 'ko'

export const LANG_LABELS: Record<LangId, string> = {
  auto: '自动检测',
  zh: '普通话',
  yue: '粤语',
  en: '英语',
  ja: '日语',
  ko: '韩语',
}

export interface AppSettings {
  preset: 'fast' | 'balanced' | 'quality'
  customModel: string
  language: LangId
  vocalEnhance: boolean
  mirror: 'mirror' | 'hf'
  seed: import('./theme').SeedId | 'custom'
  mode: 'light' | 'dark'
  /** 壁纸分析出的三色方案（seed === 'custom' 时生效，含缩略图回显） */
  customPalette: import('./theme').CustomPalette | null
}

export const DEFAULT_SETTINGS: AppSettings = {
  preset: 'balanced',
  customModel: '',
  language: 'auto',
  vocalEnhance: true,
  mirror: 'mirror',
  seed: 'violet',
  mode: 'dark',
  customPalette: null,
}
