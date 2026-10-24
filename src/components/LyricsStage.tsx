import { useEffect, useRef, useState } from 'react'
import { findLineIndex, type LyricLine, type LyricWord } from '../core/lyrics'
import { useRafFrame } from '../hooks/usePlayTime'
import { IconMusic } from './Icons'

interface Props {
  lines: LyricLine[]
  getTime: () => number
  playing: boolean
  onSeekWord: (w: LyricWord) => void
  onSeekLine: (l: LyricLine) => void
  emptyHint?: React.ReactNode
}

/**
 * 卡拉OK逐字舞台：
 *  - 行定位/滚动在 activeLine 变化时经 React 更新
 *  - 字内扫色进度 --p 每帧直写 DOM（background-clip:text 渐变推进）
 *  - 间奏倒计时同样直写
 */
export function LyricsStage({ lines, getTime, playing, onSeekWord, onSeekLine, emptyHint }: Props) {
  const innerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const lineEls = useRef<(HTMLDivElement | null)[]>([])
  const interludeRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef(-1)
  const [activeIdx, setActiveIdx] = useState(-1)

  // 滚动定位
  useEffect(() => {
    const inner = innerRef.current
    const stage = stageRef.current
    if (!inner || !stage) return
    if (activeIdx < 0 || !lines.length) {
      inner.style.transform = 'translate3d(0, -60px, 0)'
      return
    }
    const el = lineEls.current[activeIdx]
    if (!el) return
    const y = el.offsetTop - stage.clientHeight / 2 + el.offsetHeight / 2
    inner.style.transform = `translate3d(0, ${-y}px, 0)`
  }, [activeIdx, lines])

  useRafFrame(() => {
    if (!lines.length) return
    const t = getTime()
    const idx = findLineIndex(lines, t)

    if (idx !== activeRef.current) {
      // 清理上一行的字状态
      const prevEl = lineEls.current[activeRef.current]
      if (prevEl) {
        prevEl.querySelectorAll('.k-word').forEach((el) => {
          const h = el as HTMLElement
          h.classList.remove('k-word--active', 'k-word--done')
          h.style.removeProperty('--p')
        })
      }
      activeRef.current = idx
      setActiveIdx(idx)
    }

    if (idx >= 0) {
      const line = lines[idx]
      const el = lineEls.current[idx]
      if (el) {
        const children = el.children
        const words = line.words
        let wi = -1
        for (let i = 0; i < words.length; i++) {
          if (t >= words[i].start && t < words[i].end) {
            wi = i
            break
          }
        }
        if (wi < 0 && t >= line.end) wi = words.length - 1
        for (let i = 0; i < words.length; i++) {
          const c = children[i] as HTMLElement | undefined
          if (!c) continue
          if (i < wi || (wi < 0 && t >= words[i].end)) {
            c.classList.add('k-word--done')
            c.classList.remove('k-word--active')
            c.style.removeProperty('--p')
          } else if (i === wi) {
            c.classList.add('k-word--active')
            c.classList.remove('k-word--done')
            const w = words[i]
            const p = Math.min(1, Math.max(0, (t - w.start) / Math.max(0.05, w.end - w.start)))
            c.style.setProperty('--p', p.toFixed(4))
          } else {
            c.classList.remove('k-word--active', 'k-word--done')
            c.style.removeProperty('--p')
          }
        }
      }
      // 间奏倒计时
      const next = lines[idx + 1]
      const gap = next ? next.start - t : 0
      const il = interludeRef.current
      if (il) {
        if (next && gap > 4.5) {
          il.style.display = 'flex'
          il.textContent = `间奏 · ${Math.ceil(gap)}s`
        } else {
          il.style.display = 'none'
        }
      }
    } else if (interludeRef.current) {
      interludeRef.current.style.display = 'none'
    }
  }, lines.length > 0)

  if (!lines.length) {
    return (
      <div className="karaoke" ref={stageRef}>
        <div className="stage-empty">
          <div className="stage-empty__art">
            <IconMusic size={54} />
          </div>
          <div className="t-headline" style={{ color: 'var(--md-onSurface)' }}>
            还没有歌词
          </div>
          <div className="t-body" style={{ maxWidth: 380 }}>
            {emptyHint ?? '从右侧上传一首歌曲开始分析，或直接播放演示曲体验逐字跟随。'}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="karaoke" ref={stageRef}>
      <div className="karaoke__scroll">
        <div
          className="karaoke__inner"
          ref={innerRef}
          style={{ transition: 'transform 0.5s cubic-bezier(0.22, 0.9, 0.28, 1)' }}
        >
          {lines.map((line, i) => {
            const dist = Math.abs(i - activeIdx)
            const cls =
              dist === 0 ? 'k-line k-line--active' : dist <= 2 ? 'k-line k-line--near' : 'k-line'
            return (
              <div
                key={i}
                ref={(el) => {
                  lineEls.current[i] = el
                }}
                className={cls}
                onClick={() => onSeekLine(line)}
              >
                {line.words.length
                  ? line.words.map((w, j) => (
                      <span
                        key={j}
                        className="k-word"
                        onClick={(e) => {
                          e.stopPropagation()
                          onSeekWord(w)
                        }}
                      >
                        {w.text}
                      </span>
                    ))
                  : line.text}
              </div>
            )
          })}
          <div style={{ height: '38vh' }} />
          <div style={{ height: '38vh' }} />
        </div>
        <div className="k-interlude" ref={interludeRef} style={{ display: 'none' }} />
      </div>
      {!playing && activeIdx >= 0 && (
        <div
          className="m-chip m-chip--tonal"
          style={{ position: 'absolute', top: 14, right: 16, opacity: 0.85 }}
        >
          已暂停
        </div>
      )}
    </div>
  )
}
