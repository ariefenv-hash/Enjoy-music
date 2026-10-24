import { useEffect, useRef, useState } from 'react'
import { AnalysisPanelDone, AnalysisPanelRunning } from './components/AnalysisPanel'
import { EditDialog } from './components/EditDialog'
import { LyricsStage } from './components/LyricsStage'
import { PlayerBar } from './components/PlayerBar'
import { SettingsSheet } from './components/SettingsSheet'
import { TopBar } from './components/TopBar'
import { UploadPanel } from './components/UploadPanel'
import { asrEngine, detectWebGPU } from './core/asr/engine'
import { parseLyricsFile, serializeEnhancedLrc, type LyricLine } from './core/lyrics'
import { Playback } from './core/player'
import { analyze } from './core/pipeline'
import { DEFAULT_SETTINGS, type AnalysisProgress, type AppSettings, type SongProject } from './types'
import { applyTheme, extractPaletteFromImage } from './theme'

const SETTINGS_KEY = 'md3-karaoke-settings'

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {}
  return { ...DEFAULT_SETTINGS }
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [webgpu, setWebgpu] = useState<boolean | null>(null)
  const [audioFile, setAudioFile] = useState<File | Blob | null>(null)
  const [audioName, setAudioName] = useState<string | null>(null)
  const [audioSize, setAudioSize] = useState<number | null>(null)
  const [lyricsText, setLyricsText] = useState<string | null>(null)
  const [lyricsName, setLyricsName] = useState<string | null>(null)
  const [project, setProject] = useState<SongProject | null>(null)
  const [progress, setProgress] = useState<AnalysisProgress | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const cancelRef = useRef({ aborted: false })
  const playbackRef = useRef<Playback | null>(null)
  if (!playbackRef.current) playbackRef.current = new Playback()
  const playback = playbackRef.current

  // 主题
  useEffect(() => {
    applyTheme(settings.seed, settings.mode, settings.customPalette)
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  const handleWallpaper = async (f: File) => {
    setError(null)
    try {
      const palette = await extractPaletteFromImage(f)
      setSettings((s) => ({ ...s, seed: 'custom', customPalette: palette }))
    } catch (e) {
      setError(`壁纸配色失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // WebGPU 检测 + worker 预热（提前触发依赖加载，避免分析中途被 vite reload 打断）
  useEffect(() => {
    void detectWebGPU().then(setWebgpu)
    asrEngine.warmup()
  }, [])

  // 播放状态
  useEffect(() => playback.onState(() => setPlaying(playback.playing)), [playback])

  // 全屏拖拽上传
  useEffect(() => {
    const over = (e: DragEvent) => {
      e.preventDefault()
      if (e.dataTransfer?.types?.includes('Files')) setDragOver(true)
    }
    const leave = (e: DragEvent) => {
      if (e.relatedTarget == null) setDragOver(false)
    }
    const drop = (e: DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const f = e.dataTransfer?.files?.[0]
      if (f) void handlePickAudio(f)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [])

  const handlePickAudio = async (f: File | Blob) => {
    setError(null)
    setAudioFile(f)
    setAudioName(f instanceof File ? f.name : 'demo.mp3')
    setAudioSize(f.size)
    setProject(null)
    setProgress(null)
    await playback.load(f)
  }

  const handlePickLyrics = async (f: File) => {
    setError(null)
    const text = await f.text()
    setLyricsText(text)
    setLyricsName(f.name)
  }

  const startAnalysis = async () => {
    if (!audioFile || analyzing) return
    setError(null)
    setAnalyzing(true)
    setProgress(null)
    cancelRef.current = { aborted: false }
    try {
      const p = await analyze(
        { file: audioFile, fileName: audioName ?? 'audio', lyricsText: lyricsText ?? undefined, settings },
        { onProgress: setProgress, signal: cancelRef.current },
      )
      setProject(p)
      void playback.play()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg !== 'cancelled') setError(`分析失败：${msg}`)
    } finally {
      setAnalyzing(false)
    }
  }

  const cancelAnalysis = () => {
    cancelRef.current.aborted = true
    setAnalyzing(false)
    setProgress(null)
  }

  const loadDemo = async () => {
    try {
      setError(null)
      // BASE_URL 兼容子路径部署（如 GitHub Pages /Enjoy-music/）
      const base = import.meta.env.BASE_URL
      const [mp3, lrcText] = await Promise.all([
        fetch(`${base}demo/demo.mp3`).then((r) => r.blob()),
        fetch(`${base}demo/demo.elrc`).then((r) => r.text()),
      ])
      const lines = parseLyricsFile(lrcText).map((l, i) => ({ ...l, index: i }))
      await handlePickAudio(new File([mp3], 'demo.mp3', { type: 'audio/mpeg' }))
      setProject({
        fileName: 'demo.mp3（演示曲）',
        duration: playback.duration || 32.5,
        lines,
        meta: {
          model: '-',
          modelLabel: '演示数据（实测词级）',
          language: 'zh',
          device: 'wasm',
          wordTimestamps: 'native',
          source: 'demo',
          elapsedMs: 0,
          audioSec: playback.duration || 32.5,
          voicedSec: playback.duration || 32.5,
          stages: {},
          createdAt: Date.now(),
        },
      })
      await playback.play()
    } catch {
      setError('演示曲加载失败')
    }
  }

  const exportLrc = () => {
    if (!project) return
    const text = serializeEnhancedLrc(project.lines, project.fileName)
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${project.fileName.replace(/\.[^.]+$/, '')}.lrc`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 3000)
  }

  const deviceLabel =
    webgpu == null ? '检测设备中…' : webgpu ? 'WebGPU 已就绪' : 'WASM 模式'

  const showUpload = !analyzing && !project
  const lineStarts = project?.lines.map((l) => l.start) ?? []

  return (
    <div className="app">
      <TopBar
        mode={settings.mode}
        onToggleMode={() => setSettings((s) => ({ ...s, mode: s.mode === 'dark' ? 'light' : 'dark' }))}
        onOpenSettings={() => setSettingsOpen(true)}
        deviceLabel={deviceLabel}
      />

      <div className="main">
        <section className="stage">
          <LyricsStage
            lines={project?.lines ?? []}
            getTime={() => playback.time()}
            playing={playing}
            onSeekWord={(w) => playback.seek(Math.max(0, w.start - 0.02))}
            onSeekLine={(l) => playback.seek(Math.max(0, l.start - 0.05))}
            emptyHint={
              showUpload
                ? '从右侧上传一首歌曲开始分析，或直接播放演示曲体验逐字跟随。'
                : '上传音频后将自动分析出逐字时间轴。'
            }
          />
        </section>

        <aside className="side">
          {error && (
            <div className="m-card" style={{ border: '1px solid var(--md-error)', color: 'var(--md-onSurface)' }}>
              {error}
            </div>
          )}
          {analyzing && progress && (
            <AnalysisPanelRunning progress={progress} fileName={audioName ?? ''} onCancel={cancelAnalysis} />
          )}
          {project && !analyzing && (
            <>
              <AnalysisPanelDone
                project={project}
                deviceLabel={deviceLabel}
                onReanalyze={startAnalysis}
                onExportLrc={exportLrc}
              />
              <button className="m-btn m-btn--outlined" style={{ justifyContent: 'center' }} onClick={() => setProject(null)}>
                上传 / 分析新歌曲
              </button>
            </>
          )}
          {showUpload && (
            <UploadPanel
              settings={settings}
              onSettings={(patch) => setSettings((s) => ({ ...s, ...patch }))}
              audioName={audioName}
              audioSize={audioSize}
              lyricsName={lyricsName}
              onPickAudio={(f) => void handlePickAudio(f)}
              onPickLyrics={(f) => void handlePickLyrics(f)}
              onStart={startAnalysis}
              canStart={!!audioFile && !analyzing}
              onDemo={() => void loadDemo()}
            />
          )}
          {project && !analyzing && (
            <div className="m-card" style={{ padding: 16 }}>
              <div className="t-label" style={{ color: 'var(--md-onSurfaceVariant)', marginBottom: 8 }}>音频信息</div>
              <div className="t-body" style={{ wordBreak: 'break-all' }}>{audioName ?? project.fileName}</div>
              {audioSize != null && (
                <div className="t-body" style={{ color: 'var(--md-onSurfaceVariant)', marginTop: 4 }}>
                  {audioSize > 1048576 ? `${(audioSize / 1048576).toFixed(1)} MB` : `${(audioSize / 1024).toFixed(0)} KB`}
                </div>
              )}
              {lyricsName && (
                <div className="t-body" style={{ color: 'var(--md-onSurfaceVariant)', marginTop: 4 }}>
                  歌词来源：{lyricsName}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      <PlayerBar
        playback={playback}
        title={project?.fileName ?? audioName ?? '未加载音频'}
        lineStarts={lineStarts}
        playing={playing}
        onDownloadLrc={exportLrc}
        onEdit={() => setEditOpen(true)}
        canExport={!!project && project.meta.source !== 'demo'}
      />

      <SettingsSheet
        open={settingsOpen}
        settings={settings}
        onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
        onClose={() => setSettingsOpen(false)}
        webgpuAvailable={webgpu === true}
        onPickWallpaper={(f) => void handleWallpaper(f)}
      />

      <EditDialog
        open={editOpen}
        lines={project?.lines ?? []}
        onClose={() => setEditOpen(false)}
        onSave={(lines: LyricLine[]) => {
          if (!project) return
          setProject({ ...project, lines, meta: { ...project.meta, source: project.meta.source === 'demo' ? 'demo' : project.meta.source } })
        }}
      />

      {dragOver && (
        <div className="global-drag">
          <div className="global-drag__card">
            <div className="stage-empty__art" style={{ width: 72, height: 72, borderRadius: 24 }}>
              ⬆
            </div>
            松开手指，上传音频文件
          </div>
        </div>
      )}
    </div>
  )
}
