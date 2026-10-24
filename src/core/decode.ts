/** 音频文件解码：任意浏览器支持格式 → 16kHz 单声道 Float32 */

export interface DecodedAudio {
  /** 16kHz 单声道 PCM */
  audio: Float32Array
  /** 原始采样率 */
  sourceSampleRate: number
  /** 时长（秒） */
  duration: number
  /** 原始声道数 */
  channels: number
}

const TARGET_SR = 16000

export async function decodeAudioFile(file: Blob): Promise<DecodedAudio> {
  const AC: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AC()
  try {
    const arrayBuffer = await file.arrayBuffer()
    const buf = await ctx.decodeAudioData(arrayBuffer)
    const audio = await resampleTo16kMono(buf)
    return {
      audio,
      sourceSampleRate: buf.sampleRate,
      duration: buf.duration,
      channels: buf.numberOfChannels,
    }
  } finally {
    void ctx.close()
  }
}

/** 用 OfflineAudioContext 高质量重采样到 16k 并下混单声道 */
async function resampleTo16kMono(buf: AudioBuffer): Promise<Float32Array> {
  if (buf.sampleRate === TARGET_SR && buf.numberOfChannels === 1) {
    return new Float32Array(buf.getChannelData(0))
  }
  const length = Math.max(1, Math.ceil((buf.duration * TARGET_SR) | 0))
  const offline = new OfflineAudioContext(1, length, TARGET_SR)
  const src = offline.createBufferSource()
  src.buffer = buf
  src.connect(offline.destination)
  src.start(0)
  const rendered = await offline.startRendering()
  return new Float32Array(rendered.getChannelData(0))
}
