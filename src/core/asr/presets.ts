/** Whisper ONNX 模型预设（均带 cross-attention，支持词级时间戳） */

export interface ModelPreset {
  key: 'fast' | 'balanced' | 'quality'
  id: string
  label: string
  approx: string
  /** WebGPU 精度配置 */
  dtypeWebGPU: Record<string, string>
  /** WASM 精度 */
  dtypeWasm: string
  /** 模型 tokenizer 是否原生支持 yue（粤语） */
  supportsYue: boolean
  note: string
}

export const MODEL_PRESETS: ModelPreset[] = [
  {
    key: 'fast',
    id: 'onnx-community/whisper-base_timestamped',
    label: '快速 · Base',
    approx: '~80 MB',
    dtypeWebGPU: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
    dtypeWasm: 'q8',
    supportsYue: false,
    note: '速度优先，适合试听 / 短曲 / 无独显设备',
  },
  {
    key: 'balanced',
    id: 'onnx-community/whisper-small_timestamped',
    label: '均衡 · Small',
    approx: '~250 MB',
    dtypeWebGPU: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
    dtypeWasm: 'q8',
    supportsYue: false,
    note: '综合推荐，普通话/英语效果好',
  },
  {
    key: 'quality',
    id: 'onnx-community/whisper-large-v3-turbo_timestamped',
    label: '高质量 · v3-Turbo',
    approx: '~800 MB',
    dtypeWebGPU: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    dtypeWasm: 'q8',
    supportsYue: true,
    note: '唯一原生支持粤语(yue)的档位，建议 WebGPU',
  },
]

export function presetByKey(key: string): ModelPreset {
  return MODEL_PRESETS.find((p) => p.key === key) ?? MODEL_PRESETS[1]
}

export function resolveModelId(presetKey: string, customModel: string): string {
  const custom = customModel.trim()
  return custom || presetByKey(presetKey).id
}

export function presetOfModelId(id: string): ModelPreset {
  return MODEL_PRESETS.find((p) => p.id === id) ?? { ...MODEL_PRESETS[1], id }
}
