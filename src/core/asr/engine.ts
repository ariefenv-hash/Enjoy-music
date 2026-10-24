/**
 * ASR 引擎主线程封装：Worker RPC + 进度回调
 */
import type { Segment } from '../dsp'

export interface EngineWord {
  text: string
  start: number
  end: number
}

export interface RunCallbacks {
  onStatus?: (msg: string) => void
  onDownload?: (info: { file: string; progress: number }) => void
  onDevice?: (device: 'webgpu' | 'wasm') => void
  onLanguage?: (lang: string) => void
  onSegment?: (info: { index: number; total: number; progress: number; text: string }) => void
}

export interface RunResult {
  words: EngineWord[]
  device: 'webgpu' | 'wasm'
  fallback: boolean
  language: string
}

type Handler = (msg: Record<string, unknown>) => void

export class AsrEngine {
  private worker: Worker | null = null
  private handlers = new Set<Handler>()

  private ensure(): Worker {
    if (this.worker) return this.worker
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    this.worker.onerror = (e) => {
      console.error('[karaoke] worker load error:', e.message || 'unknown')
      const err = new Error(`worker 初始化失败：${e.message || '模块加载错误'}`)
      for (const h of this.handlers) h({ type: 'error', message: err.message })
    }
    this.worker.onmessageerror = (e) => {
      console.error('[karaoke] worker message error:', e)
    }
    this.worker.onmessage = (e: MessageEvent) => {
      for (const h of this.handlers) h(e.data)
    }
    return this.worker
  }

  /** 预处理 + VAD（在 worker 内做重活） */
  dsp(audio: Float32Array, vocalEnhance: boolean, onStatus?: (msg: string) => void): Promise<{ audio: Float32Array; segments: Segment[] }> {
    return new Promise((resolve, reject) => {
      const w = this.ensure()
      const h: Handler = (msg) => {
        if (msg.type === 'status') onStatus?.(String(msg.msg ?? ''))
        else if (msg.type === 'dspDone') {
          this.handlers.delete(h)
          resolve({ audio: msg.audio as Float32Array, segments: msg.segments as Segment[] })
        } else if (msg.type === 'error') {
          this.handlers.delete(h)
          reject(new Error(String(msg.message)))
        }
      }
      this.handlers.add(h)
      w.postMessage({ type: 'dsp', audio, vocalEnhance }, [audio.buffer])
    })
  }

  run(opts: {
    audio: Float32Array
    segments: Segment[]
    language: string
    model: string
    device: 'webgpu' | 'wasm'
    mirror: 'mirror' | 'hf'
    dtype: Record<string, string> | string
  }, cb: RunCallbacks, shouldAbort?: () => boolean): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const w = this.ensure()
      let settled = false
      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        this.handlers.delete(h)
        fn()
      }
      const checkAbort = () => {
        if (shouldAbort?.()) {
          w.postMessage({ type: 'cancel' })
          finish(() => reject(new Error('cancelled')))
          return true
        }
        return false
      }
      const h: Handler = (msg) => {
        switch (msg.type) {
          case 'status':
            if (checkAbort()) return
            cb.onStatus?.(String(msg.msg ?? ''))
            break
          case 'download':
            if (checkAbort()) return
            cb.onDownload?.({ file: String(msg.file ?? ''), progress: Number(msg.progress ?? 0) })
            break
          case 'downloadDone':
            cb.onDownload?.({ file: String(msg.file ?? ''), progress: 100 })
            break
          case 'device':
            cb.onDevice?.(msg.device as 'webgpu' | 'wasm')
            break
          case 'language':
            cb.onLanguage?.(String(msg.language))
            break
          case 'segmentDone':
            if (checkAbort()) return
            cb.onSegment?.({
              index: Number(msg.index),
              total: Number(msg.total),
              progress: Number(msg.progress),
              text: String(msg.text ?? ''),
            })
            break
          case 'done': {
            finish(() =>
              resolve({
                words: msg.words as EngineWord[],
                device: msg.device as 'webgpu' | 'wasm',
                fallback: Boolean(msg.fallback),
                language: String(msg.language ?? 'auto'),
              }),
            )
            break
          }
          case 'cancelled':
            finish(() => reject(new Error('cancelled')))
            break
          case 'error':
            finish(() => reject(new Error(`${String(msg.message)}${msg.stack ? `\n[worker] ${String(msg.stack).split('\n').slice(0, 3).join(' | ')}` : ''}`)))
            break
        }
      }
      this.handlers.add(h)
      w.postMessage({ type: 'run', ...opts }, [opts.audio.buffer])
      // 立即检查一次（取消发生在 run 启动前）
      checkAbort()
    })
  }

  cancel(): void {
    this.worker?.postMessage({ type: 'cancel' })
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.handlers.clear()
  }

  /** 预热：提前创建 worker 触发依赖加载（让 vite 的 reload 发生在分析开始前） */
  warmup(): void {
    this.ensure()
  }
}

/** 全局单例：worker 跨分析复用，模型只加载一次 */
export const asrEngine = new AsrEngine()

/** 设备能力探测 */
export async function detectWebGPU(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
    if (!gpu) return false
    const adapter = await gpu.requestAdapter()
    return !!adapter
  } catch {
    return false
  }
}
