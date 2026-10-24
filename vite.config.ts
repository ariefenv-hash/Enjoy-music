import dns from 'node:dns'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

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
const UPSTREAM = 'https://hf-mirror.com'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
    const req = https.request(
      u,
      { headers, family: 4, timeout: 20000, method: 'GET' },
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

async function upstreamFetch(path: string, req: Connect.IncomingMessage): Promise<UpstreamResponse> {
  const headers: Record<string, string> = {}
  if (req.headers.range) headers.Range = String(req.headers.range)
  if (req.headers['if-none-match']) headers['If-None-Match'] = String(req.headers['if-none-match'])
  headers['User-Agent'] = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
  headers.Accept = '*/*'

  let lastErr: unknown
  for (let i = 0; i < 4; i++) {
    try {
      return await httpsGetOnce(UPSTREAM + path, headers)
    } catch (e) {
      lastErr = e
      await sleep(1500 * (i + 1))
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

/** 写盘：tmp 文件 → 原子 rename，失败/中断不落半截文件 */
function teeToDisk(upstream: UpstreamResponse, rel: string, res: Connect.ServerResponse): void {
  const file = path.join(HF_CACHE_DIR, rel)
  if (!file.startsWith(HF_CACHE_DIR + path.sep)) return
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
  } catch (e) {
    console.warn(`[hf] mkdir failed for ${rel}: ${e instanceof Error ? e.message : e}`)
    return
  }
  const tmp = `${file}.part-${Date.now().toString(36)}`
  const ws = fs.createWriteStream(tmp)
  let ok = true
  const cleanup = (): void => {
    if (!ok) return
    ok = false
    try {
      fs.unlinkSync(tmp)
    } catch {}
  }
  ws.on('error', cleanup)
  upstream.stream!.on('error', () => {
    cleanup()
    res.destroy()
  })
  upstream.stream!.pipe(res)
  upstream.stream!.pipe(ws)
  upstream.stream!.on('end', () => {
    ws.end(() => {
      if (!ok) return
      try {
        if (dirSize(HF_CACHE_DIR) > HF_CACHE_MAX_BYTES) {
          cleanup()
          console.log('[hf] cache skipped (over 4GB soft cap)')
          return
        }
        fs.renameSync(tmp, file)
        const meta: DiskMeta = {
          etag: (upstream.headers.etag as string) ?? null,
          contentType: (upstream.headers['content-type'] as string) ?? null,
          contentLength: Number(upstream.headers['content-length'] ?? 0),
          lastModified: (upstream.headers['last-modified'] as string) ?? null,
          cacheControl: (upstream.headers['cache-control'] as string) ?? null,
          size: fs.statSync(file).size,
        }
        fs.writeFileSync(file + '.meta.json', JSON.stringify(meta))
        console.log(`[hf] cached ${rel} (${(meta.size / 1048576).toFixed(1)} MB)`)
      } catch {
        cleanup()
      }
    })
  })
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

    const upstream = await upstreamFetch(rawUrl, req)
    const out: Record<string, string> = {
      'access-control-allow-origin': '*',
      'cache-control': (upstream.headers['cache-control'] as string) ?? 'public, max-age=3600',
    }
    for (const k of PASS_HEADERS) {
      const v = upstream.headers[k]
      if (v) out[k] = Array.isArray(v) ? v.join(', ') : v
    }

    // HEAD / 无 body / 非 200 / Range 请求：直通，不落盘
    if (req.method === 'HEAD' || !upstream.stream || upstream.status !== 200 || req.headers.range) {
      res.writeHead(upstream.status, out)
      res.end()
      // 修复：HEAD 直通时上游流不再消费，必须销毁防止 socket 泄漏
      upstream.stream?.destroy()
      return
    }

    console.log(`[hf] MISS ${rel ?? rawUrl}`)
    if (rel && inflight.has(rel)) {
      // 理论不可达（上方已 await），防御性兜底
      upstream.stream.pipe(res)
      return
    }
    // 先写响应头（content-length/etag 等），否则 pipe 走 chunked，下载进度无从计算
    res.writeHead(upstream.status, out)
    const task = new Promise<void>((resolve) => {
      teeToDisk(upstream, rel!, res)
      upstream.stream!.on('close', resolve)
    })
    if (rel) {
      inflight.set(rel, task)
      task.finally(() => inflight.delete(rel))
    }
  } catch (e) {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`hf proxy error: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function hfProxy(): Plugin {
  return {
    name: 'hf-model-proxy',
    configureServer(server) {
      server.middlewares.use('/hf', (req, res) => void proxyHandler(req, res))
    },
    configurePreviewServer(server) {
      server.middlewares.use('/hf', (req, res) => void proxyHandler(req, res))
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
  plugins: [react(), ortStatic(), hfProxy()],
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
