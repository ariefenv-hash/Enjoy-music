/**
 * 播放器内核：HTMLAudioElement + 插值时钟（亚帧精度）
 * rAF 全局 tick，供歌词渲染与进度条订阅。
 */

let tickerSubs = new Set<() => void>()
let tickerRunning = false

function loop(): void {
  tickerSubs.forEach((cb) => cb())
  if (tickerSubs.size) requestAnimationFrame(loop)
  else tickerRunning = false
}

/** 订阅全局 rAF tick（每帧回调） */
export function subscribeTick(cb: () => void): () => void {
  tickerSubs.add(cb)
  if (!tickerRunning) {
    tickerRunning = true
    requestAnimationFrame(loop)
  }
  return () => {
    tickerSubs.delete(cb)
  }
}

export class Playback {
  el: HTMLAudioElement
  url = ''
  duration = 0
  playing = false
  rate = 1
  private anchorT = 0
  private anchorNow = 0
  private listeners = new Set<() => void>()

  constructor() {
    this.el = new Audio()
    this.el.preload = 'auto'
    this.el.addEventListener('loadedmetadata', () => {
      this.duration = this.el.duration || 0
      this.emit()
    })
    this.el.addEventListener('play', () => {
      this.playing = true
      this.resync()
      this.emit()
    })
    this.el.addEventListener('pause', () => {
      this.playing = false
      this.resync()
      this.emit()
    })
    this.el.addEventListener('seeked', () => {
      this.resync()
      this.emit()
    })
    this.el.addEventListener('timeupdate', () => this.resync())
    this.el.addEventListener('ended', () => {
      this.playing = false
      this.emit()
    })
  }

  private emit(): void {
    this.listeners.forEach((cb) => cb())
  }

  /** 订阅播放状态变化（非每帧） */
  onState(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private resync(): void {
    this.anchorT = this.el.currentTime
    this.anchorNow = performance.now()
  }

  /** 插值精确时间 */
  time(): number {
    if (!this.playing) return this.el.currentTime
    const t = this.anchorT + ((performance.now() - this.anchorNow) / 1000) * this.rate
    return Math.min(t, this.duration || t)
  }

  async load(blob: Blob): Promise<void> {
    if (this.url) URL.revokeObjectURL(this.url)
    this.url = URL.createObjectURL(blob)
    this.el.src = this.url
    this.el.load()
    await new Promise<void>((resolve) => {
      const done = () => {
        this.duration = this.el.duration || 0
        this.resync()
        resolve()
      }
      this.el.addEventListener('loadedmetadata', done, { once: true })
      setTimeout(resolve, 8000) // 兜底
    })
  }

  async play(): Promise<void> {
    try {
      await this.el.play()
    } catch {
      /* 自动播放策略：忽略 */
    }
  }

  pause(): void {
    this.el.pause()
  }

  toggle(): void {
    if (this.playing) this.pause()
    else void this.play()
  }

  seek(t: number): void {
    const d = this.duration || 0
    this.el.currentTime = Math.max(0, Math.min(t, d ? d - 0.01 : t))
    this.resync()
    this.emit()
  }

  setRate(r: number): void {
    this.rate = r
    this.el.playbackRate = r
    this.resync()
  }

  setVolume(v: number): void {
    this.el.volume = Math.max(0, Math.min(1, v))
  }

  volume(): number {
    return this.el.volume
  }
}
