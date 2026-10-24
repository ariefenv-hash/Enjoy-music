import { useEffect, useRef, useState } from 'react'
import { fmtClock } from '../core/lyrics'
import type { Playback } from '../core/player'
import { useRafFrame } from '../hooks/usePlayTime'
import { IconDownload, IconEdit, IconNext, IconPause, IconPlay, IconPrev, IconSpeed, IconVolume } from './Icons'

interface Props {
  playback: Playback
  title: string
  /** 行边界（上一句/下一句跳转用） */
  lineStarts: number[]
  playing: boolean
  onDownloadLrc: () => void
  onEdit: () => void
  canExport: boolean
}

const RATES = [0.75, 1, 1.25, 1.5, 2]

export function PlayerBar({ playback, title, lineStarts, playing, onDownloadLrc, onEdit, canExport }: Props) {
  const fillRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const sliderRef = useRef<HTMLDivElement>(null)
  const volFillRef = useRef<HTMLDivElement>(null)
  const volHandleRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const volDragging = useRef(false)
  const [rateIdx, setRateIdx] = useState(1)
  const [vol, setVol] = useState(playback.volume())

  // 每帧更新进度滑块与时间（直写 DOM）
  useRafFrame(() => {
    const d = playback.duration || 1
    const t = playback.time()
    const ratio = Math.min(1, Math.max(0, t / d))
    if (fillRef.current) fillRef.current.style.width = `${(ratio * 100).toFixed(3)}%`
    if (handleRef.current) handleRef.current.style.left = `${(ratio * 100).toFixed(3)}%`
    if (timeRef.current && !dragging.current) timeRef.current.textContent = `${fmtClock(t)} / ${fmtClock(d)}`
  })

  const seekRatio = (clientX: number, el: HTMLDivElement) => {
    const rect = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    playback.seek(ratio * (playback.duration || 0))
  }

  const jumpLine = (dir: -1 | 1) => {
    const t = playback.time()
    if (dir === -1) {
      // 上一句：当前行起点前 1.2s 内算"本行重播"
      let prev = 0
      for (const s of lineStarts) {
        if (s < t - 1.2) prev = s
        else break
      }
      playback.seek(Math.max(0, prev - 0.05))
    } else {
      let next = playback.duration
      for (const s of lineStarts) {
        if (s > t + 0.05) {
          next = s
          break
        }
      }
      playback.seek(next + 0.01)
    }
  }

  return (
    <div className="playerbar">
      <div className="playerbar__times t-mono" ref={timeRef}>
        0:00 / 0:00
      </div>
      <div className="playerbar__center">
        <button className="m-icon-btn" title="上一句" onClick={() => jumpLine(-1)}>
          <IconPrev size={22} />
        </button>
        <button className="m-fab" onClick={() => playback.toggle()} title={playing ? '暂停' : '播放'}>
          {playing ? <IconPause size={30} /> : <IconPlay size={30} style={{ marginLeft: 3 }} />}
        </button>
        <button className="m-icon-btn" title="下一句" onClick={() => jumpLine(1)}>
          <IconNext size={22} />
        </button>
        <div
          className="m-slider playerbar__progress"
          ref={sliderRef}
          onPointerDown={(e) => {
            dragging.current = true
            ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
            seekRatio(e.clientX, sliderRef.current!)
          }}
          onPointerMove={(e) => {
            if (dragging.current) seekRatio(e.clientX, sliderRef.current!)
          }}
          onPointerUp={() => {
            dragging.current = false
          }}
        >
          <div className="m-slider__track">
            <div className="m-slider__fill" ref={fillRef} style={{ width: '0%' }} />
            <div className="m-slider__handle" ref={handleRef} style={{ left: '0%' }} />
          </div>
        </div>
        <div className="m-slider playerbar__vol" title="音量">
          <div
            className="m-slider__track"
            onPointerDown={(e) => {
              volDragging.current = true
              const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
              const v = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
              playback.setVolume(v)
              setVol(v)
            }}
            onPointerMove={(e) => {
              if (!volDragging.current) return
              const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
              const v = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
              playback.setVolume(v)
              setVol(v)
            }}
            onPointerUp={() => {
              volDragging.current = false
            }}
          >
            <div
              className="m-slider__fill"
              ref={volFillRef}
              style={{ width: `${vol * 100}%`, background: 'var(--md-onSurfaceVariant)' }}
            />
            <div
              className="m-slider__handle"
              ref={volHandleRef}
              style={{ left: `${vol * 100}%`, background: 'var(--md-onSurfaceVariant)' }}
            />
          </div>
        </div>
        <IconVolume size={18} style={{ color: 'var(--md-onSurfaceVariant)' }} />
      </div>
      <div className="playerbar__right">
        <span className="m-chip hide-sm" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }} title={title}>
          {title}
        </span>
        <button
          className="m-chip m-chip--click"
          onClick={() => {
            const i = (rateIdx + 1) % RATES.length
            setRateIdx(i)
            playback.setRate(RATES[i])
          }}
          title="播放速度"
        >
          <IconSpeed size={15} />
          {RATES[rateIdx]}×
        </button>
        <button className="m-icon-btn hide-sm" onClick={onEdit} title="编辑歌词" disabled={!canExport} style={canExport ? undefined : { opacity: 0.4 }}>
          <IconEdit size={19} />
        </button>
        <button className="m-icon-btn" onClick={onDownloadLrc} title="导出增强 LRC" disabled={!canExport} style={canExport ? undefined : { opacity: 0.4 }}>
          <IconDownload size={19} />
        </button>
      </div>
    </div>
  )
}
