/**
 * 歌词解析 + 词级估算 + 序列化（从上一版 Next.js 实现移植并扩展）
 *
 * 支持：LRC / Enhanced LRC(A2) / TTML / QRC / 纯文本
 * 新增：wordsToLines（ASR 词序列 → 行结构）、serializeEnhancedLrc（导出）
 */

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
  confidence?: number
}

export type TokenType = 'cjk' | 'latin' | 'digit' | 'punct' | 'space'
export interface Token {
  text: string
  type: TokenType
  weight: number
}

const CJK = '[\\u4e00-\\u9fff\\u3400-\\u4dbf\\uf900-\\ufaff]'
const TOKEN_RE = new RegExp(
  `${CJK}|[A-Za-z][A-Za-z'’-]*|\\d+(?:[.,]\\d+)?|\\s+|[^\\sA-Za-z0-9${CJK}]+`,
  'g',
)

export function parseTime(s: string): number {
  const parts = s.split(':').map(Number)
  if (parts.some((n) => Number.isNaN(n))) return NaN
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0]
}

export function fmtLrcTime(t: number): string {
  const cs = Math.max(0, Math.round(t * 100))
  const m = Math.floor(cs / 6000)
  const s = Math.floor(cs / 100) % 60
  const c = cs % 100
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`
}

export function fmtClock(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0
  const s = Math.floor(t)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Tokenizer + 行级→词级估算
// ---------------------------------------------------------------------------

export function tokenize(line: string): Token[] {
  const out: Token[] = []
  for (const m of line.matchAll(TOKEN_RE)) {
    const text = m[0]
    let type: TokenType
    if (/^\s+$/.test(text)) type = 'space'
    else if (new RegExp(`^${CJK}$`).test(text)) type = 'cjk'
    else if (/^[A-Za-z]/.test(text)) type = 'latin'
    else if (/^\d/.test(text)) type = 'digit'
    else type = 'punct'
    const weight =
      type === 'cjk' ? 1
      : type === 'latin' ? 0.6 + 0.35 * (text.length - 1)
      : type === 'digit' ? 0.6 + 0.3 * (text.length - 1)
      : type === 'punct' ? 0.5
      : 0.25
    out.push({ text, type, weight })
  }
  return out
}

export function estimateWords(line: string, start: number, end: number): LyricWord[] {
  const tokens = tokenize(line)
  let i = 0
  while (i < tokens.length && (tokens[i].type === 'space' || tokens[i].type === 'punct')) i++
  const active = tokens.slice(i)
  if (!active.length) return []
  const total = active.reduce((s, t) => s + t.weight, 0) || 1
  const dur = Math.max(0.25, end - start)
  const unit = dur / total
  const words: LyricWord[] = []
  let t = start
  for (const tok of active) {
    const w = tok.weight * unit
    if (tok.type !== 'space' && tok.type !== 'punct') {
      words.push({ text: tok.text, start: t, end: t + w, isPause: false, estimated: true })
    }
    t += w
  }
  if (words.length) words[words.length - 1].end = end
  return words
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

export function parseLrc(text: string): LyricLine[] {
  const raw: { time: number; text: string }[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^((?:\[\d+:\d+(?:\.\d+)?\])+)(.*)$/)
    if (!m) continue
    const times = [...m[1].matchAll(/\[(\d+:\d+(?:\.\d+)?)\]/g)].map((x) => parseTime(x[1]))
    const content = m[2].trim()
    if (!content) continue
    for (const t of times) if (!Number.isNaN(t)) raw.push({ time: t, text: content })
  }
  raw.sort((a, b) => a.time - b.time)
  return raw.map((l, i) => ({
    index: i,
    text: l.text,
    start: l.time,
    end: raw[i + 1]?.time ?? l.time + 8,
    words: [],
  }))
}

export function parseEnhancedLrc(text: string): LyricLine[] {
  const out: LyricLine[] = []
  const lineRe = /^\[(\d+:\d+(?:\.\d+)?)\](.*)$/
  const wordRe = /<(\d+:\d+(?:\.\d+)?)(?:,(\d+:\d+(?:\.\d+)?))?><?([^<>]*)/g
  for (const raw of text.split(/\r?\n/)) {
    const lm = raw.match(lineRe)
    if (!lm) continue
    const start = parseTime(lm[1])
    const words: LyricWord[] = []
    let m: RegExpExecArray | null
    let cursor = start
    while ((m = wordRe.exec(lm[2]))) {
      const st = m[1] ? parseTime(m[1]) : cursor
      const en = m[2] ? parseTime(m[2]) : NaN
      const txt = m[3]
      if (!txt) continue
      cursor = Number.isNaN(en) ? st : en
      words.push({ text: txt, start: st, end: Number.isNaN(en) ? st : en })
    }
    if (!words.length) continue
    for (let k = 0; k < words.length; k++) {
      if (!(words[k].end > words[k].start)) words[k].end = words[k + 1]?.start ?? start + 8
    }
    out.push({
      index: out.length,
      text: words.map((w) => w.text).join(''),
      start,
      end: Math.max(...words.map((w) => w.end), start + 0.5),
      words,
    })
  }
  return out
}

export function parseTTML(text: string): LyricLine[] {
  if (typeof DOMParser === 'undefined') return []
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) return []
  const ps = Array.from(doc.getElementsByTagName('p'))
  const out: LyricLine[] = []
  for (const p of ps) {
    const start = parseTime(p.getAttribute('begin') ?? '0')
    if (Number.isNaN(start)) continue
    const endAttr = p.getAttribute('end')
    const words: LyricWord[] = []
    for (const sp of Array.from(p.getElementsByTagName('span'))) {
      const b = sp.getAttribute('begin')
      const txt = sp.textContent ?? ''
      if (b == null || !txt.trim()) continue
      const bs = parseTime(b)
      const es = sp.getAttribute('end') ? parseTime(sp.getAttribute('end')!) : NaN
      words.push({ text: txt, start: bs, end: Number.isNaN(es) ? bs : es })
    }
    for (let k = 0; k < words.length; k++) {
      if (!(words[k].end > words[k].start)) words[k].end = words[k + 1]?.start ?? start + 8
    }
    const nextStart = (() => {
      const nextP = ps[out.length + 1]
      return nextP ? parseTime(nextP.getAttribute('begin') ?? '0') : start + 8
    })()
    const end = endAttr ? parseTime(endAttr) : nextStart
    out.push({
      index: out.length,
      text: (p.textContent ?? '').replace(/\s+/g, ' ').trim(),
      start,
      end: Number.isNaN(end) ? start + 8 : end,
      words,
    })
  }
  return out
}

export function parseQRC(text: string): LyricLine[] {
  const out: LyricLine[] = []
  for (const raw of text.split(/\r?\n/)) {
    const lm = raw.match(/^\[(\d+),(\d+)\](.*)$/)
    if (!lm) continue
    const start = Number(lm[1]) / 1000
    const end = start + Number(lm[2]) / 1000
    const words: LyricWord[] = []
    const re = /\((\d+),(\d+),\d+\)([^()]*)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(lm[3]))) {
      const txt = m[3]
      if (!txt.trim()) continue
      words.push({ text: txt, start: Number(m[1]) / 1000, end: (Number(m[1]) + Number(m[2])) / 1000 })
    }
    if (!words.length) continue
    out.push({ index: out.length, text: words.map((w) => w.text).join(''), start, end, words })
  }
  return out
}

/** 自动识别歌词文件格式并解析 */
export function parseLyricsFile(text: string): LyricLine[] {
  const t = text.trim()
  if (!t) return []
  if (t.startsWith('<?xml') || t.includes('<tt ') || t.includes('<tt>')) return parseTTML(t)
  if (/^\[\d+,\d+\]/m.test(t)) return parseQRC(t)
  if (/<\d+:\d+(?:\.\d+)?>/.test(t)) return parseEnhancedLrc(t)
  if (/^\[\d+:\d+(?:\.\d+)?\]/m.test(t)) return parseLrc(t)
  return []
}

/** 纯文本 → 原始行（无时间） */
export function plainLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('[') && !l.startsWith('#'))
}

// ---------------------------------------------------------------------------
// ASR 词序列 → 行
// ---------------------------------------------------------------------------

const LINE_END_RE = /[。？！；?!;.]["'”’）)]?\s*$/

/** 能量包络（可选，用于换气点检测） */
export interface RmsEnv {
  rms: Float32Array
  hopDur: number
}

/**
 * 间隙 [from,to] 内的"凹陷度"：间隙最低能量 ÷ 间隙前后 0.7s 的上下文能量。
 * ≈1 表示间隙和歌唱一样响（间奏/拖音），≪1 表示明显的换气口。
 */
function gapDip(env: RmsEnv | undefined, from: number, to: number): number {
  if (!env || to <= from) return 1
  const { rms, hopDur } = env
  const i0 = Math.max(0, Math.floor(from / hopDur))
  const i1 = Math.min(rms.length - 1, Math.ceil(to / hopDur))
  if (i1 <= i0) return 1
  let min = Infinity
  for (let i = i0; i <= i1; i++) if (rms[i] < min) min = rms[i]
  const ctx = (a: number, b: number) => {
    const j0 = Math.max(0, Math.floor(a / hopDur))
    const j1 = Math.min(rms.length - 1, Math.ceil(b / hopDur))
    let s = 0
    let c = 0
    for (let j = j0; j <= j1; j++) {
      s += rms[j]
      c++
    }
    return c ? s / c : 0
  }
  const base = Math.max(ctx(Math.max(0, from - 0.7), from), ctx(to, to + 0.7), 1e-5)
  return min / base
}

/**
 * 把 ASR 输出的词聚合成歌词行。
 *
 * 分行信号（按优先级）：
 *  1. 行尾标点
 *  2. 明显句间停顿（间隙 > 0.6s）
 *  3. 换气口：间隙虽短（≥0.14s）但能量凹陷明显（< 42%），且当前行已有一定长度
 *  4. 兜底：行长超 7s 时回溯到行内最后一个"疑似换气点"切分
 *
 * 这样行数会随歌词密度自然增长，而不是被"每 7.5s 一行"锁死。
 */
export function wordsToLines(words: LyricWord[], duration: number, env?: RmsEnv): LyricLine[] {
  if (!words.length) return []
  const lines: LyricLine[] = []
  let cur: LyricWord[] = []

  const flush = () => {
    if (!cur.length) return
    const text = cur.map((w) => w.text).join('')
    if (text.trim()) {
      lines.push({
        index: lines.length,
        text: text.trim(),
        start: cur[0].start,
        end: cur[cur.length - 1].end,
        words: cur,
      })
    }
    cur = []
  }

  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    cur.push(w)
    const next = words[i + 1]
    if (!next) break
    const gapDur = next.start - w.end
    const lineLen = next.start - cur[0].start
    const punct = LINE_END_RE.test(w.text)
    let brk = false
    if (punct || cur.length > 32) {
      brk = true
    } else if (gapDur > 0.6) {
      brk = true
    } else if (gapDur >= 0.14 && lineLen >= 2 && gapDip(env, w.end, next.start) < 0.42) {
      brk = true
    } else if (lineLen > 7) {
      // 回溯：在行内从后往前找最后一个疑似换气点（间隙 ≥0.12s 且 dip < 0.6）
      let cut = -1
      for (let k = cur.length - 2; k >= 0; k--) {
        const g = cur[k + 1].start - cur[k].end
        if (g >= 0.12 && gapDip(env, cur[k].end, cur[k + 1].start) < 0.6) {
          // 两段都至少 1.2s 才值得切
          const headLen = cur[k + 1].start - cur[0].start
          const tailLen = cur[cur.length - 1].end - cur[k + 1].start
          if (headLen >= 1.2 && tailLen >= 1.2) {
            cut = k
          }
          break
        }
      }
      if (cut >= 0) {
        const head = cur.slice(0, cut + 1)
        cur = cur.slice(cut + 1)
        // flush head
        const text = head.map((x) => x.text).join('')
        if (text.trim()) {
          lines.push({
            index: lines.length,
            text: text.trim(),
            start: head[0].start,
            end: head[head.length - 1].end,
            words: head,
          })
        }
      } else {
        flush()
      }
      continue
    }
    if (brk) flush()
  }
  flush()

  // 行尾修正：不超过下一行起点
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1]
    if (next && lines[i].end > next.start - 0.02) lines[i].end = Math.max(lines[i].start + 0.3, next.start - 0.02)
  }
  if (lines.length) {
    const last = lines[lines.length - 1]
    last.end = Math.min(Math.max(last.end, last.start + 0.5), duration || last.end)
  }
  return lines
}

/** 按当前播放时间找活动行（行保持高亮到下一行开始，即"间奏保持"策略） */
export function findLineIndex(lines: LyricLine[], t: number): number {
  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].start <= t + 1e-4) idx = i
    else break
  }
  return idx
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

/** 序列化为增强 LRC（词级 <start,end>） */
export function serializeEnhancedLrc(lines: LyricLine[], title?: string): string {
  const head: string[] = []
  if (title) head.push(`[ti:${title}]`)
  head.push('[re:MD3 Karaoke Studio (client Whisper)]')
  const body = lines.map((line) => {
    const words = line.words.length
      ? line.words
      : estimateWords(line.text, line.start, line.end)
    const tags = words.map((w) => `<${fmtLrcTime(w.start)},${fmtLrcTime(w.end)}>${w.text}`).join('')
    return `[${fmtLrcTime(line.start)}]${tags}`
  })
  return [...head, ...body].join('\n') + '\n'
}
