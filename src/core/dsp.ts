/**
 * DSP 预处理 + VAD 切分（在 Web Worker 中运行）
 *
 * 提速要点：
 *  - 统一 16k 单声道（Whisper 原生采样率），无逐块重采样开销
 *  - VAD 能量切分跳过前奏/间奏/尾奏等纯伴奏段（通常占 20~40%）
 *  - 分段后每段独立转写，避免整曲滑窗的重复计算
 *
 * 质量要点：
 *  - RMS 归一 + 去直流 + 80Hz 高通（去低频隆隆声）
 *  - 人声增强（可选）：HPSS 中值滤波分离，抑制持续和弦（谐波）与鼓点（冲击），
 *    保留形态学上"峰状突变"的人声成分，显著提升强伴奏下的转写准确率
 */
import { FFT, hannWindow, slidingMedian } from './fft'

export interface Segment {
  start: number
  end: number
}

const SR = 16000

// ---------------------------------------------------------------------------
// Biquad 滤波器（RBJ cookbook）
// ---------------------------------------------------------------------------
class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0
  private a1 = 0; private a2 = 0
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0

  static highpass(f0: number, q = 0.7071): Biquad {
    const b = new Biquad()
    const w0 = (2 * Math.PI * f0) / SR
    const alpha = Math.sin(w0) / (2 * q)
    const cw = Math.cos(w0)
    const a0 = 1 + alpha
    b.b0 = (1 + cw) / 2 / a0
    b.b1 = (-(1 + cw)) / a0
    b.b2 = (1 + cw) / 2 / a0
    b.a1 = (-2 * cw) / a0
    b.a2 = (1 - alpha) / a0
    return b
  }
  static lowpass(f0: number, q = 0.7071): Biquad {
    const b = new Biquad()
    const w0 = (2 * Math.PI * f0) / SR
    const alpha = Math.sin(w0) / (2 * q)
    const cw = Math.cos(w0)
    const a0 = 1 + alpha
    b.b0 = (1 - cw) / 2 / a0
    b.b1 = (1 - cw) / a0
    b.b2 = (1 - cw) / 2 / a0
    b.a1 = (-2 * cw) / a0
    b.a2 = (1 - alpha) / a0
    return b
  }
  process(x: Float32Array): Float32Array {
    const out = new Float32Array(x.length)
    for (let i = 0; i < x.length; i++) {
      const y = this.b0 * x[i] + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
      this.x2 = this.x1; this.x1 = x[i]
      this.y2 = this.y1; this.y1 = y
      out[i] = y
    }
    return out
  }
}

// ---------------------------------------------------------------------------
// 预处理
// ---------------------------------------------------------------------------

export function preprocess(
  input: Float32Array,
  vocalEnhance: boolean,
  onProgress?: (ratio: number, msg: string) => void,
): Float32Array {
  // 1) RMS 归一化（目标 -18dBFS）+ 峰值限制
  let sum = 0
  for (let i = 0; i < input.length; i++) sum += input[i] * input[i]
  const rms = Math.sqrt(sum / Math.max(1, input.length))
  const target = 0.126 // -18 dBFS
  let gain = rms > 1e-6 ? target / rms : 1
  gain = Math.min(gain, 12)
  let audio: Float32Array = new Float32Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const v = input[i] * gain
    audio[i] = v > 0.92 ? 0.92 : v < -0.92 ? -0.92 : v
  }

  // 2) 去直流 + 80Hz 高通
  const hp = Biquad.highpass(80)
  audio = hp.process(audio)

  // 3) 人声增强（HPSS-lite）
  if (vocalEnhance && audio.length > 1024 * 4) {
    audio = vocalEmphasis(audio, onProgress)
  }
  return audio
}

/** HPSS 人声增强：抑制谐波垫底与打击乐，保留人声峰 */
function vocalEmphasis(audio: Float32Array, onProgress?: (r: number, m: string) => void): Float32Array {
  const win = 1024
  const hop = 512
  const B = win / 2 + 1
  const fft = new FFT(win)
  const hann = hannWindow(win)
  const nFrames = Math.max(1, Math.floor((audio.length - win) / hop) + 1)

  const re = new Float32Array(nFrames * B)
  const im = new Float32Array(nFrames * B)

  const fre = new Float32Array(win)
  const fim = new Float32Array(win)
  for (let f = 0; f < nFrames; f++) {
    const off = f * hop
    for (let i = 0; i < win; i++) {
      fre[i] = (audio[off + i] || 0) * hann[i]
      fim[i] = 0
    }
    fft.forward(fre, fim)
    const ro = f * B
    for (let k = 0; k < B; k++) {
      re[ro + k] = fre[k]
      im[ro + k] = fim[k]
    }
    if (f % 800 === 0) onProgress?.((f / nFrames) * 0.4, `频谱分析 ${Math.round((f / nFrames) * 100)}%`)
  }

  // H：时间轴中值（抑制瞬态鼓点）  P：频率轴中值（抑制持续音高）
  onProgress?.(0.42, '分离人声与伴奏…')
  const tmp = new Float32Array(nFrames)
  const Hmed = new Float32Array(nFrames * B)
  for (let k = 0; k < B; k++) {
    for (let f = 0; f < nFrames; f++) tmp[f] = Math.abs(re[f * B + k]) + Math.abs(im[f * B + k])
    const med = slidingMedian(tmp, 17)
    for (let f = 0; f < nFrames; f++) Hmed[f * B + k] = med[f]
    if (k % 128 === 0) onProgress?.(0.42 + (k / B) * 0.16, '分离人声与伴奏…')
  }
  const row = new Float32Array(B)
  const Pmed = new Float32Array(nFrames * B)
  for (let f = 0; f < nFrames; f++) {
    const ro = f * B
    for (let k = 0; k < B; k++) row[k] = Math.abs(re[ro + k]) + Math.abs(im[ro + k])
    const med = slidingMedian(row, 17)
    for (let k = 0; k < B; k++) Pmed[ro + k] = med[k]
    if (f % 400 === 0) onProgress?.(0.58 + (f / nFrames) * 0.16, '分离人声与伴奏…')
  }

  // 软掩码：mag - 0.8·max(H,P) → 人声峰保留；保留 22% 底以免过于干瘪
  const out = new Float32Array(audio.length)
  const wsum = new Float32Array(audio.length)
  const tw = new Float32Array(win)
  const ti = new Float32Array(win)
  for (let f = 0; f < nFrames; f++) {
    const ro = f * B
    for (let k = 0; k < B; k++) {
      const mr = re[ro + k], mi = im[ro + k]
      const mag = Math.hypot(mr, mi)
      const bg = Math.max(Hmed[ro + k], Pmed[ro + k]) * 0.5
      let m = mag > 1e-7 ? (mag - bg * 0.8) / mag : 0
      m = m < 0 ? 0 : m > 1 ? 1 : m
      const blend = 0.22 + 0.78 * m
      re[ro + k] = mr * blend
      im[ro + k] = mi * blend
    }
    // iFFT
    for (let k = 0; k < win; k++) {
      if (k < B) {
        tw[k] = re[ro + k]
        ti[k] = im[ro + k]
      } else {
        tw[k] = re[ro + (win - k)]
        ti[k] = -im[ro + (win - k)]
      }
    }
    fft.inverse(tw, ti)
    const off = f * hop
    for (let i = 0; i < win; i++) {
      const w = hann[i]
      out[off + i] += tw[i] * w
      wsum[off + i] += w * w
    }
    if (f % 800 === 0) onProgress?.(0.74 + (f / nFrames) * 0.26, `重建人声 ${Math.round((f / nFrames) * 100)}%`)
  }
  const norm = win / (hop * 1.5) // hann 50% 重叠能量补偿
  for (let i = 0; i < out.length; i++) {
    const ws = wsum[i] || 1
    out[i] /= ws * norm
  }
  return out
}

// ---------------------------------------------------------------------------
// VAD：带通能量切分
// ---------------------------------------------------------------------------

export function segmentVAD(audio: Float32Array): Segment[] {
  const hop = 256 // 16ms
  const n = Math.floor(audio.length / hop)
  if (n < 10) return [{ start: 0, end: audio.length / SR }]

  // 人声频带能量（300~3800Hz）
  const bp1 = Biquad.highpass(300)
  const bp2 = Biquad.lowpass(3800)
  const band = bp2.process(bp1.process(audio))
  const rms = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    const o = i * hop
    for (let j = 0; j < hop; j++) {
      const v = band[o + j]
      s += v * v
    }
    rms[i] = Math.sqrt(s / hop)
  }

  const sorted = Float32Array.from(rms).sort()
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))]
  const floor = pct(0.2)
  const peak = pct(0.98)
  const thr = Math.max(floor * 2.2, peak * 0.09, 1e-4)

  // 激活帧 + 拖尾
  const active = new Uint8Array(n)
  for (let i = 0; i < n; i++) if (rms[i] > thr) active[i] = 1
  const hang = 14 // ~224ms
  let last = -999
  const held = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (active[i]) last = i
    if (i - last <= hang) held[i] = 1
  }

  // 合并成段
  const raw: Segment[] = []
  let s = -1
  for (let i = 0; i < n; i++) {
    if (held[i] && s < 0) s = i
    if ((!held[i] || i === n - 1) && s >= 0) {
      raw.push({ start: s * hop / SR, end: (i + 1) * hop / SR })
      s = -1
    }
  }

  // 合并小间隙
  const merged: Segment[] = []
  for (const seg of raw) {
    const prev = merged[merged.length - 1]
    if (prev && seg.start - prev.end < 0.5) prev.end = seg.end
    else merged.push({ ...seg })
  }

  // 过滤太短 + 补边
  const minDur = 0.3
  const pad = 0.18
  const dur = audio.length / SR
  const segs = merged
    .filter((g) => g.end - g.start >= minDur)
    .map((g) => ({
      start: Math.max(0, g.start - pad),
      end: Math.min(dur, g.end + pad),
    }))

  // 拆超长段（>24s）在能量低谷切开
  const out: Segment[] = []
  for (const seg of segs) splitLong(seg, rms, hop, out)

  // 兜底：几乎全程无激活（强伴奏/纯音乐误判）→ 整曲分段
  const voiced = out.reduce((s2, g) => s2 + (g.end - g.start), 0)
  if (voiced < dur * 0.06) {
    const fixed: Segment[] = []
    for (let t = 0; t < dur; t += 24) fixed.push({ start: t, end: Math.min(dur, t + 24) })
    return fixed.length ? fixed : [{ start: 0, end: dur }]
  }
  return out.length ? out : [{ start: 0, end: dur }]
}

function splitLong(seg: Segment, rms: Float32Array, hop: number, out: Segment[]): void {
  const MAX = 24
  if (seg.end - seg.start <= MAX) {
    out.push(seg)
    return
  }
  // 找中点附近 2s 内最低能量点
  const mid = (seg.start + seg.end) / 2
  const from = Math.max(seg.start + 4, mid - 1)
  const to = Math.min(seg.end - 4, mid + 1)
  let best = mid
  let bestE = Infinity
  for (let t = from; t < to; t += 0.08) {
    const i0 = Math.floor(t * SR / hop)
    let e = 0
    for (let k = i0; k < i0 + Math.floor(0.25 * SR / hop) && k < rms.length; k++) e += rms[k] * rms[k]
    if (e < bestE) {
      bestE = e
      best = t + 0.125
    }
  }
  splitLong({ start: seg.start, end: best }, rms, hop, out)
  splitLong({ start: best, end: seg.end }, rms, hop, out)
}

// ---------------------------------------------------------------------------
// RMS 能量包络（供分行器检测换气点；纯函数，主线程也可用）
// ---------------------------------------------------------------------------

export interface RmsEnv {
  rms: Float32Array
  hopDur: number
}

export function computeRmsEnvelope(audio: Float32Array, hop = 512): RmsEnv {
  const n = Math.max(1, Math.floor(audio.length / hop))
  const rms = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    const o = i * hop
    for (let j = 0; j < hop; j++) {
      const v = audio[o + j] || 0
      s += v * v
    }
    rms[i] = Math.sqrt(s / hop)
  }
  return { rms, hopDur: hop / SR }
}
