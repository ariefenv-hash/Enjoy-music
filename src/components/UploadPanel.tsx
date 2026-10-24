import { useRef, useState } from 'react'
import { MODEL_PRESETS } from '../core/asr/presets'
import { LANG_LABELS, type AppSettings, type LangId } from '../types'
import { IconBolt, IconLyrics, IconSpark, IconUpload } from './Icons'

interface Props {
  settings: AppSettings
  onSettings: (patch: Partial<AppSettings>) => void
  audioName: string | null
  audioSize: number | null
  lyricsName: string | null
  onPickAudio: (f: File) => void
  onPickLyrics: (f: File) => void
  onStart: () => void
  canStart: boolean
  onDemo: () => void
}

export function fmtSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

export function UploadPanel(props: Props) {
  const { settings, onSettings, audioName, audioSize, lyricsName, onPickAudio, onPickLyrics, onStart, canStart, onDemo } = props
  const [over, setOver] = useState<'audio' | 'lyrics' | null>(null)
  const audioRef = useRef<HTMLInputElement>(null)
  const lyricsRef = useRef<HTMLInputElement>(null)

  const drop = (e: React.DragEvent, kind: 'audio' | 'lyrics') => {
    e.preventDefault()
    setOver(null)
    const f = e.dataTransfer.files?.[0]
    if (!f) return
    if (kind === 'audio') onPickAudio(f)
    else onPickLyrics(f)
  }

  return (
    <div className="m-card">
      <div className="t-title" style={{ marginBottom: 14 }}>上传歌曲</div>

      {/* 音频 */}
      <div
        className={`dropzone ${audioName ? 'dropzone--filled' : ''} ${over === 'audio' ? 'is-over' : ''}`}
        onClick={() => audioRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver('audio')
        }}
        onDragLeave={() => setOver(null)}
        onDrop={(e) => drop(e, 'audio')}
      >
        <div className="dropzone__icon">
          <IconUpload size={24} />
        </div>
        {audioName ? (
          <div className="dropzone__meta">
            <div className="dropzone__name">{audioName}</div>
            <div className="dropzone__size">{audioSize ? fmtSize(audioSize) : ''} · 点击更换</div>
          </div>
        ) : (
          <>
            <div className="dropzone__title">拖拽音频文件到此处，或点击选择</div>
            <div className="dropzone__hint">支持 mp3 / wav / m4a / flac / ogg，建议 ≤ 60MB</div>
          </>
        )}
        <input
          ref={audioRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg,.aac"
          className="sr-only"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onPickAudio(f)
            e.target.value = ''
          }}
        />
      </div>

      {/* 歌词（可选） */}
      <div
        className={`dropzone ${lyricsName ? 'dropzone--filled' : ''} ${over === 'lyrics' ? 'is-over' : ''}`}
        style={{ marginTop: 12 }}
        onClick={() => lyricsRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver('lyrics')
        }}
        onDragLeave={() => setOver(null)}
        onDrop={(e) => drop(e, 'lyrics')}
      >
        <div className="dropzone__icon" style={{ background: 'var(--md-tertiaryContainer)', color: 'var(--md-onTertiaryContainer)' }}>
          <IconLyrics size={24} />
        </div>
        {lyricsName ? (
          <div className="dropzone__meta">
            <div className="dropzone__name">{lyricsName}</div>
            <div className="dropzone__size">将把时间戳对齐到你的歌词 · 点击更换</div>
          </div>
        ) : (
          <>
            <div className="dropzone__title">歌词文件（可选）</div>
            <div className="dropzone__hint">
              纯文本 / .lrc / .elrc / .ttml / .qrc —— 提供后强制对齐到你的文本，识别更准
            </div>
          </>
        )}
        <input
          ref={lyricsRef}
          type="file"
          accept=".txt,.lrc,.elrc,.ttml,.qrc,.trc,text/plain"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onPickLyrics(f)
            e.target.value = ''
          }}
        />
      </div>

      {/* 模型档位 */}
      <div className="m-field" style={{ marginTop: 16 }}>
        <span className="m-field__label">分析档位</span>
        <div className="m-seg m-seg--full">
          {MODEL_PRESETS.map((p) => (
            <button
              key={p.key}
              className={`m-seg__opt ${settings.preset === p.key ? 'is-on' : ''}`}
              onClick={() => onSettings({ preset: p.key, customModel: '' })}
              title={`${p.approx} · ${p.note}`}
            >
              <span className="m-seg__dot" />
              {p.key === 'fast' ? <IconBolt size={15} /> : p.key === 'quality' ? <IconSpark size={15} /> : null}
              {p.label.replace(' · ', ' ')}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: 'var(--md-onSurfaceVariant)', marginTop: 4 }}>
          {MODEL_PRESETS.find((p) => p.key === settings.preset)?.note}
        </span>
      </div>

      {/* 语言 */}
      <div className="m-field" style={{ marginTop: 12 }}>
        <span className="m-field__label">歌曲语言</span>
        <select
          value={settings.language}
          onChange={(e) => onSettings({ language: e.target.value as LangId })}
          className="m-field-select"
          style={{
            height: 44,
            borderRadius: 12,
            border: '1px solid var(--md-outlineVariant)',
            background: 'color-mix(in srgb, var(--md-surfaceContainerHighest) 45%, transparent)',
            padding: '0 12px',
            outline: 'none',
          }}
        >
          {(Object.keys(LANG_LABELS) as LangId[]).map((k) => (
            <option key={k} value={k}>
              {LANG_LABELS[k]}
              {k === 'yue' ? '（需高质量档）' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* 人声增强 */}
      <div className="opt-row" style={{ marginTop: 6 }}>
        <div className="opt-row__text">
          <div className="opt-row__title">人声增强</div>
          <div className="opt-row__desc">HPSS 分离抑制伴奏与鼓点，强伴奏下准确率更高（多花几秒）</div>
        </div>
        <button
          className={`m-switch ${settings.vocalEnhance ? 'is-on' : ''}`}
          role="switch"
          aria-checked={settings.vocalEnhance}
          onClick={() => onSettings({ vocalEnhance: !settings.vocalEnhance })}
        />
      </div>

      <button className="m-btn m-btn--filled m-btn--large" style={{ width: '100%', marginTop: 14, justifyContent: 'center' }} disabled={!canStart} onClick={onStart}>
        <IconUpload size={18} />
        开始分析
      </button>
      <button className="m-btn m-btn--text" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} onClick={onDemo}>
        直接播放演示曲（无需分析）
      </button>
    </div>
  )
}
