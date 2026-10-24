/**
 * 强制对齐：把用户提供的歌词文本对齐到 ASR 词级时间戳。
 *
 * 采用 Needleman-Wunsch 全局对齐（字符级归一化匹配），对 ASR 同音字错误
 * 具备容错性 —— 即使识别有误，只要大部分字匹配上，就能把时间戳"迁移"
 * 到用户的正确文本上。这是粤语等 ASR 弱项语言保证逐字质量的关键：
 * 识别可以错，但时间是对的。
 *
 * 支持两种输入：
 *  - 纯文本行（无时间）：按顺序指针逐行向后搜索匹配
 *  - 带行级时间的 LRC：以行时间为锚点，在锚点附近窗口内对齐（词级细化）
 */
import { estimateWords, type LyricLine, type LyricWord } from './lyrics'

// ---------------------------------------------------------------------------
// 归一化：全文 → 匹配单元序列（CJK 单字 / 拉丁数字整词）
// ---------------------------------------------------------------------------

export interface Unit {
  ch: string
  /** 所属 word 在词数组中的下标 */
  wordIdx: number
}

export function normalizeUnits(text: string): string[] {
  const t = text.normalize('NFKC').toLowerCase()
  const units: string[] = []
  for (const m of t.matchAll(/[\u4e00-\u9fff\u3400-\u4dbf]|[\p{L}\p{N}]+/gu)) {
    const s = m[0]
    if (/^[\u4e00-\u9fff\u3400-\u4dbf]$/.test(s)) units.push(s)
    else units.push(s.replace(/[^\p{L}\p{N}]/gu, ''))
  }
  return units.filter(Boolean)
}

function wordsToUnits(words: LyricWord[]): Unit[] {
  const units: Unit[] = []
  words.forEach((w, wi) => {
    for (const u of normalizeUnits(w.text)) units.push({ ch: u, wordIdx: wi })
  })
  return units
}

// ---------------------------------------------------------------------------
// Needleman-Wunsch
// ---------------------------------------------------------------------------

interface NwResult {
  score: number
  pairs: { i: number; j: number }[]
}

function nw(a: string[], b: string[]): NwResult {
  const n = a.length
  const m = b.length
  if (!n || !m) return { score: 0, pairs: [] }
  const GAP = -1
  const MATCH = 2
  const MISS = -1.2
  // 滚动数组 + 回溯指针（规模小，直接全量 DP）
  const dp: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(m + 1))
  const bt: Uint8Array[] = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1))
  for (let i = 1; i <= n; i++) {
    dp[i][0] = dp[i - 1][0] + GAP
    bt[i][0] = 1
  }
  for (let j = 1; j <= m; j++) {
    dp[0][j] = dp[0][j - 1] + GAP
    bt[0][j] = 2
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = a[i - 1] === b[j - 1] ? MATCH : MISS
      const d = dp[i - 1][j - 1] + s
      const u = dp[i - 1][j] + GAP
      const l = dp[i][j - 1] + GAP
      let best = d
      let dir = 0
      if (u > best) {
        best = u
        dir = 1
      }
      if (l > best) {
        best = l
        dir = 2
      }
      dp[i][j] = best
      bt[i][j] = dir
    }
  }
  const pairs: { i: number; j: number }[] = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    const dir = bt[i][j]
    if (dir === 0 && i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) pairs.push({ i: i - 1, j: j - 1 })
      i--
      j--
    } else if (dir === 1 || j === 0) {
      i--
    } else {
      j--
    }
  }
  pairs.reverse()
  return { score: dp[n][m], pairs }
}

// ---------------------------------------------------------------------------
// 行级对齐
// ---------------------------------------------------------------------------

export interface RawLine {
  text: string
  /** LRC 行级时间锚点（可选） */
  anchor?: number
  /** 该行的右边界（下一行起点，锚点模式用） */
  bound?: number
}

export interface AlignResult {
  lines: LyricLine[]
  /** 匹配单元 / 总单元 */
  ratio: number
}

export function alignLyricsToWords(raw: RawLine[], words: LyricWord[], duration: number): AlignResult {
  if (!words.length) {
    // 无 ASR 结果：均匀分布
    const lines = evenDistribution(raw, duration)
    return { lines, ratio: 0 }
  }

  const wu = wordsToUnits(words)
  const wStart = words.map((w) => w.start)
  const wEnd = words.map((w) => w.end)

  let pointer = 0
  let totalUnits = 0
  let matchedUnits = 0
  const results: { text: string; start?: number; end?: number; confidence: number }[] = []

  for (const line of raw) {
    const units = normalizeUnits(line.text)
    totalUnits += units.length
    if (!units.length) {
      results.push({ text: line.text, confidence: 0 })
      continue
    }

    // 确定搜索窗口 [ws, we) 在 wu 下标空间
    let ws = Math.max(0, pointer)
    let we = Math.min(wu.length, pointer + Math.ceil(units.length * 2.2) + 28)
    if (line.anchor != null) {
      const a = line.anchor!
      const b = line.bound ?? a + 15
      // 锚点模式：窗口 = [anchor-2, bound+3] 覆盖的词下标范围
      let lo = 0
      let hi = wStart.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (wStart[mid] < a - 2) lo = mid + 1
        else hi = mid
      }
      let endIdx = lo
      while (endIdx < wEnd.length && wEnd[endIdx] <= b + 3) endIdx++
      ws = lo
      we = Math.min(wu.length, Math.max(lo + units.length + 6, endIdx + 4))
    }

    const winUnits = wu.slice(ws, we).map((u) => u.ch)
    const { pairs } = nw(units, winUnits)

    if (pairs.length >= Math.max(2, units.length * 0.35)) {
      const first = pairs[0]
      const last = pairs[pairs.length - 1]
      const firstWord = wu[ws + first.j].wordIdx
      const lastWord = wu[ws + last.j].wordIdx
      let start = wStart[firstWord]
      let end = wEnd[lastWord]
      if (end <= start) end = start + 0.4
      results.push({ text: line.text, start, end, confidence: pairs.length / units.length })
      matchedUnits += pairs.length
      // 指针推进（锚点模式下以匹配终点为准）
      if (line.anchor == null) pointer = ws + last.j + 1
      else pointer = Math.max(pointer, ws + last.j + 1)
    } else {
      results.push({ text: line.text, confidence: pairs.length / Math.max(1, units.length) })
      matchedUnits += pairs.length
    }
  }

  // 未匹配行：在相邻已匹配行之间插值
  const lines: LyricLine[] = []
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (r.start != null) {
      lines.push(makeLine(i, r.text, r.start, r.end!, words, r.confidence))
      continue
    }
    const prev = findNeighbor(results, i, -1)
    const next = findNeighbor(results, i, 1)
    const from = prev ? prev.end! : 0
    const to = next ? next.start! : duration || from + 8
    const span = Math.max(0.5, Math.min(to - from, 14))
    lines.push(makeLine(i, r.text, from, from + span, words, 0))
  }

  // 保证时间单调
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].start < lines[i - 1].start) {
      lines[i].start = lines[i - 1].start
      if (lines[i].end < lines[i].start + 0.4) lines[i].end = lines[i].start + 0.4
    }
  }
  return { lines, ratio: totalUnits ? matchedUnits / totalUnits : 0 }
}

function findNeighbor(
  results: { text: string; start?: number; end?: number; confidence: number }[],
  i: number,
  dir: -1 | 1,
): { start?: number; end?: number } | null {
  let j = i + dir
  while (j >= 0 && j < results.length) {
    if (dir === -1 && results[j].end != null) return results[j]
    if (dir === 1 && results[j].start != null) return results[j]
    j += dir
  }
  return null
}

function makeLine(
  index: number,
  text: string,
  start: number,
  end: number,
  _words: LyricWord[],
  confidence: number,
): LyricLine {
  return { index, text, start, end: Math.max(end, start + 0.3), words: estimateWords(text, start, end), confidence }
}

function evenDistribution(raw: RawLine[], duration: number): LyricLine[] {
  const n = raw.length
  if (!n) return []
  const dur = duration || n * 5
  const per = dur / n
  return raw.map((r, i) => {
    const start = i * per
    const end = Math.min(dur, (i + 1) * per - Math.min(0.35, per * 0.12))
    return { index: i, text: r.text, start, end, words: estimateWords(r.text, start, end), confidence: 0 }
  })
}
