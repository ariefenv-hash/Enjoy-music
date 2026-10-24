import { fmtClock } from '../core/lyrics'
import type { AnalysisProgress, SongProject } from '../types'
import { IconCheck, IconDownload, IconRefresh, IconWarn } from './Icons'

interface RunningProps {
  progress: AnalysisProgress
  fileName: string
  onCancel: () => void
}

export function AnalysisPanelRunning({ progress, fileName, onCancel }: RunningProps) {
  const activeIdx = progress.stages.findIndex((s) => s.state === 'active')
  const doneCount = progress.stages.filter((s) => s.state === 'done').length
  const overall = progress.stages.some((s) => s.state === 'active') ? doneCount / progress.stages.length : 0
  return (
    <div className="m-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="t-title" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          正在分析：{fileName}
        </div>
        <button className="m-btn m-btn--text" onClick={onCancel} style={{ height: 34 }}>
          取消
        </button>
      </div>
      <div className={`m-progress ${activeIdx < 0 ? 'm-progress--indeterminate' : ''}`} style={{ marginTop: 12 }}>
        <div className="m-progress__bar" style={{ width: `${Math.round(overall * 100)}%` }} />
      </div>
      <div className="stage-list">
        {progress.stages.map((s) => (
          <div key={s.id} className={`stage-item ${s.state === 'active' ? 'stage-item--active' : ''} ${s.state === 'done' ? 'stage-item--done' : ''}`}>
            {s.state === 'done' ? (
              <IconCheck size={17} />
            ) : s.state === 'active' ? (
              <span
                className="m-spin"
                style={{
                  width: 15,
                  height: 15,
                  borderRadius: '50%',
                  border: '2px solid var(--md-outlineVariant)',
                  borderTopColor: 'var(--md-primary)',
                  display: 'inline-block',
                  flexShrink: 0,
                }}
              />
            ) : (
              <span style={{ width: 15, height: 15, borderRadius: '50%', border: '2px solid var(--md-outlineVariant)', display: 'inline-block', flexShrink: 0 }} />
            )}
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
            {s.ms != null && <span className="stage-item__time">{(s.ms / 1000).toFixed(1)}s</span>}
          </div>
        ))}
      </div>
      <div className="ana-log" style={{ whiteSpace: 'pre-line' }}>
        {progress.log || '准备中…'}
      </div>
    </div>
  )
}

interface DoneProps {
  project: SongProject
  deviceLabel: string
  onReanalyze: () => void
  onExportLrc: () => void
}

export function AnalysisPanelDone({ project, deviceLabel, onReanalyze, onExportLrc }: DoneProps) {
  const { meta, lines } = project
  const speedup = meta.elapsedMs / 1000 > 0 ? meta.audioSec / (meta.elapsedMs / 1000) : 0
  const wordCount = lines.reduce((s, l) => s + l.words.length, 0)
  const srcLabel: Record<string, string> = {
    asr: 'ASR 识别',
    aligned: '强制对齐',
    'lrc-timed': 'LRC 细化',
    'lrc-enhanced': '自带词级',
    demo: '演示数据',
  }
  return (
    <div className="m-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <IconCheck size={20} style={{ color: 'var(--md-primary)' }} />
        <div className="t-title" style={{ flex: 1 }}>分析完成</div>
        <button className="m-icon-btn" onClick={onReanalyze} title="重新分析">
          <IconRefresh size={19} />
        </button>
        <button className="m-icon-btn" onClick={onExportLrc} title="导出增强 LRC">
          <IconDownload size={19} />
        </button>
      </div>
      <div className="meta-chips">
        <span className="m-chip m-chip--primary">{(meta.elapsedMs / 1000).toFixed(1)}s / {fmtClock(meta.audioSec)}</span>
        <span className="m-chip">{speedup > 0.05 ? `${speedup.toFixed(1)}× 实时` : ''}</span>
        <span className="m-chip m-chip--tonal">{deviceLabel}</span>
        <span className="m-chip">{meta.modelLabel}</span>
        <span className="m-chip">语言 {meta.language}</span>
        <span className="m-chip">{srcLabel[meta.source] ?? meta.source}</span>
        {meta.alignRatio != null && (
          <span className={`m-chip ${meta.alignRatio > 0.75 ? 'm-chip--primary' : ''}`}>
            对齐率 {(meta.alignRatio * 100).toFixed(0)}%
          </span>
        )}
        <span className="m-chip">{lines.length} 行 · {wordCount} 词</span>
        {meta.wordTimestamps === 'fallback' && (
          <span className="m-chip" title="该模型不支持词级输出，已按权重切分">
            <IconWarn size={13} /> 估算词级
          </span>
        )}
      </div>
      <div className="hint-box" style={{ marginTop: 10 }}>
        点击歌词任意 <b>字词</b> 可跳转到该字发音瞬间；分析结果自动缓存在当前会话，重新分析可更换档位或语言。
      </div>
    </div>
  )
}
