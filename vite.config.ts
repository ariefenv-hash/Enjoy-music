import dns from 'node:dns'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { Transform, type TransformCallback } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// IPv4 优先（规避 IPv6 黑洞导致的连接超时）
dns.setDefaultResultOrder('ipv4first')

const ROOT = path.dirname(fileURLToPath(import.meta.url))

/**
 * HF 模型下载代理：
 *  - 浏览器直连 hf-mirror 会被其 WAF 拦截（无头浏览器 UA / Sec-Fetch 头），
 *    大陆用户直连 huggingface.co 也不通。
 *  - 由 dev/preview 服务器在服务端转发 /hf/* → hf-mirror：
 *    浏览器只访问同源路径，无 CORS、无指纹拦截、支持 Range 续传。
 *
 * hf-mirror 特殊性：/resolve/ 会 307 到 /api/resolve-cache/...?...&etag="..."，
 * 该带 query 的地址会无限挂起 —— 剥掉 query 的干净地址秒通（其它带签名的
 * 重定向保留 query 原样跟随）。
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 上游链与稳定性：
 *  - 默认 hf-mirror（大陆可达）→ huggingface.co（国际兜底），前者连续故障/限流自动切换；
 *    环境变量 HF_UPSTREAMS 覆盖（逗号分隔），便于测试与自定义。
 *  - 429/503/5xx：优先 Retry-After，否则指数退避 + 抖动；429 另设全局冷却防重试风暴。
 *  - 网络级故障：该上游熔断 30s，立即换下一家。
 *  - 上游并发上限 MAX_CONCURRENCY（信号量），降低触发风控的概率。
 *  - 长下载停顿检测（HF_STALL_MS，默认 45s）：从已收字节用 Range+If-Range 无缝续传拼接，
 *    对客户端与磁盘缓存均无感知；次数上限 HF_MAX_SPLICES（默认 2）。
 */
const UPSTREAMS = (process.env.HF_UPSTREAMS ?? 'https://hf-mirror.com,https://huggingface.co')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean)

const UPSTREAM_TIMEOUT_MS = 20_000
const STALL_TIMEOUT_MS = Number(process.env.HF_STALL_MS ?? 45_000)
const MAX_SPLICES = Number(process.env.HF_MAX_SPLICES ?? 2)
const MAX_CONCURRENCY = 6

interface UpstreamHealth {
  failures: number
  cooldownUntil: number
}
const health = new Map<string, UpstreamHealth>()
const hOf = (u: string): UpstreamHealth => {
  let h = health.get(u)
  if (!h) {
    h = { failures: 0, cooldownUntil: 0 }
    health.set(u, h)
  }
  return h
}

/** 429 全局冷却：任一上游限流时，所有新上游请求先等冷却结束（防重试风暴） */
let globalCooldownUntil = 0

class Semaphore {
  private active = 0
  private waiters: (() => void)[] = []
  async acquire(): Promise<() => void> {
    if (this.active >= MAX_CONCURRENCY) await new Promise<void>((r) => this.waiters.push(r))
    this.active++
    let done = false
    return () => {
      if (done) return
      done = true
      this.active--
      this.waiters.shift()?.()
    }
  }
}
const upstreamSem = new Semaphore(MAX_CONCURRENCY)

/** 可用上游优先（保持配置顺序），全部熔断时按冷却结束时间排序兜底 */
function pickUpstreams(): string[] {
  const now = Date.now()
  const ok = UPSTREAMS.filter((u) => hOf(u).cooldownUntil <= now)
  const down = UPSTREAMS.filter((u) => hOf(u).cooldownUntil > now)
  return [...ok, ...down.sort((a, b) => hOf(a).cooldownUntil - hOf(b).cooldownUntil)]
}

function backoffMs(res: { headers: Record<string, string | string[] | undefined> }, attempt: number): number {
  const ra = Number(res.headers['retry-after'])
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 30_000)
  return Math.min(1500 * 2 ** attempt + Math.random() * 500, 15_000)
}

interface UpstreamResponse {
  status: number
  headers: Record<string, string | string[] | undefined>
  stream: import('node:stream').Readable | null
}

/**
 * node:https GET：socket 层强制 IPv4，手动跟随重定向。
 * hf-mirror 的 /resolve/ 会 307 到 /api/resolve-cache/...?...&etag="..."，
 * 该带 query 的地址会无限挂起 —— 剥掉 query 的干净地址秒通；
 * 其它带签名的重定向保留 query 原样跟随。
 * 上游间歇性限流会挂起连接 → 失败自动重试（最多 4 次）。
 */
function httpsGetOnce(url: string, headers: Record<string, string>, depth = 0): Promise<UpstreamResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const mod = u.protocol === 'http:' ? http : https
    const req = mod.request(
      u,
      { headers, family: 4, timeout: UPSTREAM_TIMEOUT_MS, method: 'GET' },
      (res) => {
        const sc = res.statusCode ?? 0
        if (sc >= 300 && sc < 400 && res.headers.location && depth < 5) {
          res.resume()
          const abs = new URL(res.headers.location, u).toString()
          const clean = abs.includes('/api/resolve-cache/') ? abs.split('?')[0] : abs
          resolve(httpsGetOnce(clean, headers, depth + 1))
          return
        }
        resolve({ status: sc, headers: res.headers, stream: res })
      },
    )
    req.on('timeout', () => req.destroy(new Error('upstream connect timeout (20s)')))
    req.on('error', reject)
    req.end()
  })
}

function buildUpstreamHeaders(req: Connect.IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {}
  if (req.headers.range) headers.Range = String(req.headers.range)
  if (req.headers['if-none-match']) headers['If-None-Match'] = String(req.headers['if-none-match'])
  headers['User-Agent'] = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
  headers.Accept = '*/*'
  return headers
}

interface UpstreamResult extends UpstreamResponse {
  base: string
}

/**
 * 上游请求（header 阶段）：逐家上游 × 各 2 次尝试。
 *  - 429/503/5xx：Retry-After 优先，否则指数退避+抖动；429 设全局冷却；同上游内退避重试
 *  - 网络级故障（连接超时/拒绝）：该上游熔断 30s，立即切换下一家
 *  - 4xx 语义错误（404/403 等）：不重试不转移，直接返回给客户端
 */
async function fetchWithFailover(path: string, headers: Record<string, string>, ctx: string): Promise<UpstreamResult> {
  let lastErr: unknown
  for (const base of pickUpstreams()) {
    for (let i = 0; i < 3; i++) {
      const wait = globalCooldownUntil - Date.now()
      if (wait > 0) await sleep(wait)
      try {
        const res = await httpsGetOnce(base + path, headers)
        if (res.status === 429 || res.status === 503 || res.status >= 500) {
          res.stream?.destroy()
          const ms = backoffMs(res, i)
          const h = hOf(base)
          h.failures++
          h.cooldownUntil = Date.now() + Math.min(ms, 30_000)
          if (res.status === 429) globalCooldownUntil = Date.now() + Math.min(ms, 30_000)
          console.warn(`[hf] ${res.status} @ ${base}${path} → 退避 ${(ms / 1000).toFixed(1)}s (${ctx})`)
          lastErr = new Error(`${res.status} from ${base}`)
          await sleep(ms)
          continue
        }
        const h = hOf(base)
        h.failures = 0
        h.cooldownUntil = 0
        return { ...res, base }
      } catch (e) {
        lastErr = e
        const h = hOf(base)
        h.failures++
        h.cooldownUntil = Date.now() + 30_000
        console.warn(`[hf] ${base} 网络错误：${e instanceof Error ? e.message : e} → 熔断 30s，切换上游 (${ctx})`)
        break
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

const PASS_HEADERS = [
  'content-type', 'content-length', 'content-range', 'etag', 'last-modified',
  'accept-ranges', 'x-linked-size', 'x-total-count', 'x-repo-commit',
] as const

/**
 * 服务端磁盘持久缓存：
 *  预览环境（无痕窗口 / 每次会话清空存储）会把浏览器 Cache API 清掉，
 *  transformers.js 的『二次零下载』随之失效，权重每次都要从 hf-mirror 全量重下。
 *  把下载过的文件落盘到 .hf-cache/ 后，无论浏览器缓存是否被清，
 *  权重都从本地磁盘直接秒出（内网速度），上游只在首次访问时请求一次。
 */
const HF_CACHE_DIR = path.join(ROOT, '.hf-cache')
const HF_CACHE_MAX_BYTES = 4 * 1024 * 1024 * 1024 // 4GB 软上限，超出后不再新增缓存（不影响命中）

interface DiskMeta {
  etag: string | null
  contentType: string | null
  contentLength: number
  lastModified: string | null
  cacheControl: string | null
  size: number
}

/** 把代理路径清洗成缓存相对路径；拒绝任何越权字符 */
function cleanCacheRel(p: string): string | null {
  if (!p.startsWith('/')) return null
  const parts = p.split('/').filter(Boolean)
  if (!parts.length) return null
  if (parts.some((x) => x === '.' || x === '..' || /[\\:]/.test(x))) return null
  return parts.join('/')
}

function diskCacheEntry(rel: string): { file: string; metaPath: string; meta: DiskMeta } | null {
  const file = path.join(HF_CACHE_DIR, rel)
  if (!file.startsWith(HF_CACHE_DIR + path.sep)) return null
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null
    const metaPath = file + '.meta.json'
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as DiskMeta
    if (!meta || typeof meta.size !== 'number') return null
    return { file, metaPath, meta }
  } catch {
    return null
  }
}

function dirSize(dir: string): number {
  let total = 0
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile()) total += fs.statSync(p).size
    }
  }
  try {
    walk(dir)
  } catch {}
  return total
}

function serveFromDisk(
  req: Connect.IncomingMessage,
  res: Connect.ServerResponse,
  entry: { file: string; meta: DiskMeta },
): void {
  const { file, meta } = entry
  const base: Record<string, string> = {
    'access-control-allow-origin': '*',
    'accept-ranges': 'bytes',
    'cache-control': meta.cacheControl ?? 'public, max-age=86400',
    'content-type': meta.contentType ?? 'application/octet-stream',
  }
  if (meta.etag) base.etag = meta.etag
  if (meta.lastModified) base['last-modified'] = meta.lastModified

  const inm = req.headers['if-none-match']
  if (meta.etag && inm && inm.split(',').map((s) => s.trim()).includes(meta.etag) && !req.headers.range) {
    res.writeHead(304, base)
    res.end()
    return
  }

  const size = meta.size
  const range = typeof req.headers.range === 'string' ? /^bytes=(\d*)-(\d*)$/.exec(req.headers.range) : null
  if (range) {
    let start = 0
    let end = size - 1
    if (range[1] === '' && range[2] !== '') {
      start = Math.max(0, size - Number(range[2]))
    } else {
      start = Number(range[1] || 0)
      if (range[2]) end = Math.min(Number(range[2]), size - 1)
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      res.writeHead(416, { ...base, 'content-range': `bytes */${size}` })
      res.end()
      return
    }
    res.writeHead(206, {
      ...base,
      'content-range': `bytes ${start}-${end}/${size}`,
      'content-length': end - start + 1,
    })
    fs.createReadStream(file, { start, end }).pipe(res)
    return
  }

  res.writeHead(200, { ...base, 'content-length': size })
  fs.createReadStream(file).pipe(res)
}

class ByteCounter extends Transform {
  bytes = 0
  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.bytes += chunk.length
    cb(null, chunk)
  }
}

/** 上游流停顿看门狗：STALL_TIMEOUT_MS 无数据 → 销毁流触发续传；正常 end 返回 true */
function pumpWithStallWatch(src: import('node:stream').Readable): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = (ok: boolean): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(ok)
    }
    const reset = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => src.destroy(new Error(`stall >${STALL_TIMEOUT_MS}ms`)), STALL_TIMEOUT_MS)
      ;(timer as unknown as { unref?: () => void }).unref?.()
    }
    src.on('data', reset)
    src.on('end', () => done(true))
    src.on('error', () => done(false))
    src.on('close', () => done(false))
    reset()
  })
}

/**
 * 200 全量下载泵送：上游流 → 字节计数 → 客户端 + 磁盘缓存（tee）。
 * 停顿/断流时从已收字节数发起 Range+If-Range 续传，向同一响应/缓存文件无缝拼接，
 * 客户端与磁盘缓存均无感知；最多 MAX_SPLICES 次，无法续传则放弃并清理半截文件。
 */
async function teeWithResume(
  first: UpstreamResult,
  upPath: string,
  headers: Record<string, string>,
  rel: string,
  res: Connect.ServerResponse,
): Promise<void> {
  const file = path.join(HF_CACHE_DIR, rel)
  const cacheable = file.startsWith(HF_CACHE_DIR + path.sep)
  const tmp = cacheable ? `${file}.part-${Date.now().toString(36)}` : ''
  if (cacheable) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
    } catch (e) {
      console.warn(`[hf] mkdir failed for ${rel}: ${e instanceof Error ? e.message : e}`)
      first.stream!.pipe(res)
      return
    }
  }

  const ws = tmp ? fs.createWriteStream(tmp) : null
  const counter = new ByteCounter()
  counter.on('error', () => {})
  first.stream!.pipe(counter)
  counter.pipe(res)
  if (ws) counter.pipe(ws, { end: false })

  const etag = (first.headers.etag as string) ?? null
  const total = Number(first.headers['content-length'] ?? 0)

  let finalized = false
  const cleanupTmp = (): void => {
    if (!tmp) return
    try {
      fs.unlinkSync(tmp)
    } catch {}
  }

  const finalize = (): void => {
    if (finalized) return
    finalized = true
    counter.end()
    ws?.end(() => {
      try {
        if (dirSize(HF_CACHE_DIR) > HF_CACHE_MAX_BYTES) {
          cleanupTmp()
          console.log('[hf] cache skipped (over 4GB soft cap)')
          return
        }
        fs.renameSync(tmp, file)
        const meta: DiskMeta = {
          etag,
          contentType: (first.headers['content-type'] as string) ?? null,
          contentLength: total,
          lastModified: (first.headers['last-modified'] as string) ?? null,
          cacheControl: (first.headers['cache-control'] as string) ?? null,
          size: fs.statSync(file).size,
        }
        fs.writeFileSync(file + '.meta.json', JSON.stringify(meta))
        console.log(`[hf] cached ${rel} (${(meta.size / 1048576).toFixed(1)} MB)`)
      } catch {
        cleanupTmp()
      }
    })
  }

  const abort = (): void => {
    if (finalized) return
    finalized = true
    src.destroy()
    counter.end()
    ws?.end()
    cleanupTmp()
    res.destroy()
  }
  ws?.on('error', (e) => {
    console.warn(`[hf] cache write error: ${e.message}`)
    abort()
  })

  // 客户端中途断开：终止下载并清理半截文件
  res.on('close', () => {
    if (!finalized && !res.writableFinished) abort()
  })

  let src = first.stream!
  for (let splice = 0; ; ) {
    const ok = await pumpWithStallWatch(src)
    if (ok) {
      finalize()
      return
    }
    const written = counter.bytes
    const canResume =
      !finalized && splice < MAX_SPLICES && written > 0 && (total === 0 || written < total) && !res.writableEnded
    if (!canResume) {
      abort()
      return
    }
    splice++
    console.warn(`[hf] 断流 @ ${written}/${total || '?'}B → 续传 #${splice} (${rel})`)
    try {
      const r2 = await fetchWithFailover(
        upPath,
        { ...headers, Range: `bytes=${written}-`, ...(etag ? { 'If-Range': etag } : {}) },
        rel,
      )
      const cr = String(r2.headers['content-range'] ?? '')
      if (r2.status === 206 && r2.stream && cr.startsWith(`bytes ${written}-`)) {
        src = r2.stream
        src.pipe(counter)
        continue
      }
      // If-Range 校验失败返回 200 全量（文件已变）等：无法续传
      r2.stream?.destroy()
    } catch {
      /* 续传请求失败 → 放弃 */
    }
    abort()
    return
  }
}

/** 同一文件的并发请求合并：等首个下载落盘后直接从磁盘回源 */
const inflight = new Map<string, Promise<void>>()

async function proxyHandler(req: Connect.IncomingMessage, res: Connect.ServerResponse): Promise<void> {
  // connect 已剥掉 '/hf' 前缀，req.url 形如 '/onnx-community/.../resolve/main/config.json'
  const rawUrl = req.url ?? '/'
  const rel = cleanCacheRel(rawUrl.split('?')[0])
  try {
    if (rel) {
      const entry = diskCacheEntry(rel)
      if (entry) {
        console.log(`[hf] HIT ${rel}`)
        serveFromDisk(req, res, entry)
        return
      }
      const pending = inflight.get(rel)
      if (pending) {
        await pending.catch(() => {})
        const e2 = diskCacheEntry(rel)
        if (e2) {
          serveFromDisk(req, res, e2)
          return
        }
      }
    }

    const headers = buildUpstreamHeaders(req)
    const release = await upstreamSem.acquire()
    let upstream: UpstreamResult
    try {
      upstream = await fetchWithFailover(rawUrl, headers, rel ?? rawUrl)
    } catch (e) {
      release()
      throw e
    }

    const out: Record<string, string> = {
      'access-control-allow-origin': '*',
      'cache-control': (upstream.headers['cache-control'] as string) ?? 'public, max-age=3600',
      'x-hf-upstream': upstream.base.replace(/^https?:\/\//, ''),
    }
    for (const k of PASS_HEADERS) {
      const v = upstream.headers[k]
      if (v) out[k] = Array.isArray(v) ? v.join(', ') : v
    }

    // HEAD / 无 body / 非 200 / 客户端带 Range：直通，不落盘
    if (req.method === 'HEAD' || !upstream.stream || upstream.status !== 200 || req.headers.range) {
      release()
      res.writeHead(upstream.status, out)
      res.end()
      // 修复：HEAD 直通时上游流不再消费，必须销毁防止 socket 泄漏
      upstream.stream?.destroy()
      return
    }

    console.log(`[hf] MISS ${rel ?? rawUrl} (via ${out['x-hf-upstream']})`)
    if (rel && inflight.has(rel)) {
      // 理论不可达（上方已 await），防御性兜底
      release()
      upstream.stream.pipe(res)
      return
    }
    // 先写响应头（content-length/etag 等），否则 pipe 走 chunked，下载进度无从计算
    res.writeHead(upstream.status, out)
    const task = teeWithResume(upstream, rawUrl, headers, rel!, res).finally(release)
    // 泵送阶段错误已在内部处置/日志，这里兜底防 unhandled rejection 杀进程
    task.catch(() => {})
    if (rel) {
      inflight.set(rel, task)
      task.finally(() => inflight.delete(rel))
    }
  } catch (e) {
    console.warn(`[hf] proxy error: ${e instanceof Error ? e.message : String(e)}`)
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`hf proxy error: ${e instanceof Error ? e.message : String(e)}`)
    } else {
      res.destroy()
    }
  }
}

function hfProxy(): Plugin {
  // 子路径 preview（PAGES_BASE=/Enjoy-music/）时，请求带 base 前缀：
  // 额外挂一份 '<base>/hf' 保证 preview:pages 下镜像代理仍可用
  const BASE = process.env.PAGES_BASE || '/'
  return {
    name: 'hf-model-proxy',
    configureServer(server) {
      server.middlewares.use('/hf', (req, res) => void proxyHandler(req, res))
      if (BASE !== '/') server.middlewares.use(`${BASE.replace(/\/+$/, '')}/hf`, (req, res) => void proxyHandler(req, res))
    },
    configurePreviewServer(server) {
      server.middlewares.use('/hf', (req, res) => void proxyHandler(req, res))
      if (BASE !== '/') server.middlewares.use(`${BASE.replace(/\/+$/, '')}/hf`, (req, res) => void proxyHandler(req, res))
    },
  }
}

/**
 * /ort/ 原生静态服务：绕过 vite 的 ?import 模块转换
 * （vite 会把 xxx.mjs?import 当模块图文件处理，public 目录文件会 500；
 *  且 wasm 必须以 application/wasm 提供，才能走流式编译）
 */
function ortStatic(): Plugin {
  const serve = (req: Connect.IncomingMessage, res: Connect.ServerResponse, next: Connect.NextFunction): void => {
    if (!req.url?.startsWith('/ort/')) return next()
    const file = path.basename(decodeURIComponent(req.url.split('?')[0]))
    const full = path.join(ROOT, 'public', 'ort', file)
    if (!file || !fs.existsSync(full) || !fs.statSync(full).isFile()) return next()
    const type = file.endsWith('.mjs') || file.endsWith('.js')
      ? 'text/javascript; charset=utf-8'
      : file.endsWith('.wasm')
        ? 'application/wasm'
        : 'application/octet-stream'
    res.setHeader('Content-Type', type)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    fs.createReadStream(full).pipe(res)
  }
  return {
    name: 'ort-static',
    configureServer(server) {
      server.middlewares.use(serve)
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve)
    },
  }
}

/**
 * 预览代理（如 ws-xxx.cn-hongkong-vpc.fcapp.run / preview-xxx.space-z.ai）
 * 会以自定义 Host 头访问本服务。Vite 默认只允许 localhost 等已知主机，
 * 否则报：Blocked request. This host (...) is not allowed.
 * 这里放开 allowedHosts（dev 与 preview 都要配），开发/预览环境可接受。
 */
export default defineConfig({
  // GitHub Pages 项目页构建：PAGES_BASE=/Enjoy-music/ vite build
  // 资源/worker/ort 全部指向 /Enjoy-music/ 子路径；默认 '/' 不影响 dev/preview
  base: process.env.PAGES_BASE || '/',
  plugins: [
    react(),
    ortStatic(),
    hfProxy(),
    VitePWA({
      // autoUpdate：新版本 SW 在下次导航自动接管，旧缓存自动清理
      registerType: 'autoUpdate',
      includeAssets: [
        'demo/demo.mp3',
        'demo/demo.elrc',
        'icons/pwa-192.png',
        'icons/pwa-512.png',
        'icons/pwa-maskable-512.png',
      ],
      manifest: {
        name: '逐字歌词工坊 · MD3 Karaoke',
        short_name: '歌词工坊',
        description: '上传歌曲，浏览器本地 AI 分析逐字歌词，MD3 卡拉OK逐字跟随',
        lang: 'zh-CN',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        background_color: '#141218',
        theme_color: '#141218',
        icons: [
          { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 仅预缓存应用壳（hashed assets + index.html + 小体积演示资源）；
        // 大 wasm / 模型权重不进预缓存：wasm 走运行时 CacheFirst，权重由 transformers.js 自管 Cache
        globPatterns: ['assets/*.{js,css}', 'index.html'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/hf\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // ORT wasm：首次使用后 CacheFirst（含 Range 请求支持），离线可用
            urlPattern: /\/(ort|assets)\/[^/]+\.wasm$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ort-wasm',
              expiration: { maxEntries: 8, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
              rangeRequests: true,
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts: true,
    hmr: { overlay: true },
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts: true,
  },
  worker: { format: 'es' },
  optimizeDeps: {
    // 显式声明 worker 依赖，避免首次创建 Worker 时触发
    // 「new dependencies optimized → 整页 reload」把进行中的分析杀掉
    include: ['@huggingface/transformers'],
    exclude: ['onnxruntime-web', 'onnxruntime-node', 'sharp'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 8192,
  },
})
