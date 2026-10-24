/** 迭代式 radix-2 FFT（实数信号按复数处理，规模足够 DSP 使用） */

export class FFT {
  readonly n: number
  private rev: Uint32Array
  private cos: Float32Array
  private sin: Float32Array

  constructor(n: number) {
    if (n < 2 || (n & (n - 1)) !== 0) throw new Error('FFT size must be power of 2')
    this.n = n
    this.rev = new Uint32Array(n)
    const bits = Math.log2(n) | 0
    for (let i = 0; i < n; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b)
      this.rev[i] = r
    }
    this.cos = new Float32Array(n / 2)
    this.sin = new Float32Array(n / 2)
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / n)
      this.sin[i] = Math.sin((-2 * Math.PI * i) / n)
    }
  }

  /** 原地变换。re/im 长度必须为 n */
  forward(re: Float32Array, im: Float32Array): void {
    const { n, rev, cos, sin } = this
    for (let i = 0; i < n; i++) {
      const j = rev[i]
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t
        t = im[i]; im[i] = im[j]; im[j] = t
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1
      const step = n / len
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < half; k++) {
          const c = cos[k * step]
          const s = sin[k * step]
          const ar = re[i + k + half]
          const ai = im[i + k + half]
          const tr = ar * c - ai * s
          const ti = ar * s + ai * c
          re[i + k + half] = re[i + k] - tr
          im[i + k + half] = im[i + k] - ti
          re[i + k] += tr
          im[i + k] += ti
        }
      }
    }
  }

  /** 逆变换（未归一化，调用方自行 /n） */
  inverse(re: Float32Array, im: Float32Array): void {
    this.forward(im, re) // 交换实虚等价于共轭变换
  }
}

export function hannWindow(n: number): Float32Array {
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
  return w
}

/** 滑动窗口中值（sorted insertion，win 取奇数） */
export function slidingMedian(src: Float32Array, win: number): Float32Array {
  const n = src.length
  const out = new Float32Array(n)
  const buf = new Float32Array(win)
  let count = 0
  const half = win >> 1
  for (let i = 0; i < n + half; i++) {
    // 移除左侧滑出元素
    const outIdx = i - win
    if (outIdx >= 0) {
      const v = src[outIdx]
      let k = 0
      while (k < count && buf[k] !== v) k++
      for (let j = k; j < count - 1; j++) buf[j] = buf[j + 1]
      count--
    }
    // 加入右侧元素
    const inIdx = i
    if (inIdx < n) {
      const v = src[inIdx]
      let k = count - 1
      while (k >= 0 && buf[k] > v) {
        buf[k + 1] = buf[k]
        k--
      }
      buf[k + 1] = v
      count++
    }
    if (i >= half && i - half < n && count === win) out[i - half] = buf[half]
  }
  return out
}
