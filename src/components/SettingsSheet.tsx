import { useRef } from 'react'
import { MODEL_PRESETS } from '../core/asr/presets'
import { SEEDS, type SeedId } from '../theme'
import { LANG_LABELS, type AppSettings, type LangId } from '../types'
import { IconClose, IconUpload } from './Icons'

interface Props {
  open: boolean
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
  onClose: () => void
  webgpuAvailable: boolean
  onPickWallpaper: (f: File) => void
}

export function SettingsSheet({ open, settings, onChange, onClose, webgpuAvailable, onPickWallpaper }: Props) {
  const wallRef = useRef<HTMLInputElement>(null)
  if (!open) return null
  return (
    <>
      <div className="m-sheet-scrim" onClick={onClose} />
      <div className="m-sheet">
        <div className="m-sheet__handle" />
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 18 }}>
          <div className="t-headline" style={{ flex: 1 }}>设置</div>
          <button className="m-icon-btn" onClick={onClose}>
            <IconClose size={20} />
          </button>
        </div>

        {/* 外观 */}
        <div className="set-section">
          <div className="set-section__title">外观</div>
          {/* 壁纸取色：上传 → 分析 3 色 → 生成主题 */}
          <div
            className={`dropzone dropzone--wall ${settings.seed === 'custom' ? 'dropzone--filled' : ''}`}
            style={{ padding: 14 }}
            onClick={() => wallRef.current?.click()}
            role="button"
            aria-label="上传壁纸自动配色"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              {settings.customPalette ? (
                <img
                  src={settings.customPalette.thumb}
                  alt="壁纸缩略图"
                  style={{ width: 52, height: 52, borderRadius: 14, objectFit: 'cover', flexShrink: 0 }}
                />
              ) : (
                <div className="dropzone__icon" style={{ width: 44, height: 44, borderRadius: 14 }}>
                  <IconUpload size={20} />
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="dropzone__title" style={{ fontSize: 14 }}>
                  上传壁纸，自动生成主题色
                </div>
                <div className="dropzone__hint" style={{ fontSize: 12 }}>
                  {settings.customPalette
                    ? '已应用壁纸配色 · 点击更换壁纸'
                    : '从壁纸中提取 3 种视觉统一的颜色混搭成套主题'}
                </div>
              </div>
              {settings.customPalette && (
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {settings.customPalette.seeds.map((c) => (
                    <span key={c} title={c} style={{ width: 18, height: 18, borderRadius: 9, background: c, border: '1px solid var(--md-outlineVariant)' }} />
                  ))}
                </div>
              )}
            </div>
            <input
              ref={wallRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onPickWallpaper(f)
                e.target.value = ''
              }}
            />
          </div>

          <div className="seed-row" style={{ marginTop: 12 }}>
            {(Object.keys(SEEDS) as SeedId[]).map((id) => (
              <button
                key={id}
                className={`seed-dot ${settings.seed === id ? 'is-on' : ''}`}
                title={SEEDS[id].label}
                style={{
                  background: `linear-gradient(135deg, ${SEEDS[id][settings.mode].primary}, ${SEEDS[id][settings.mode].tertiary})`,
                }}
                onClick={() => onChange({ seed: id, customPalette: settings.customPalette })}
              />
            ))}
            {settings.customPalette && (
              <button
                className={`seed-dot seed-dot--custom ${settings.seed === 'custom' ? 'is-on' : ''}`}
                title="壁纸配色"
                style={{
                  background: `conic-gradient(${settings.customPalette.seeds.join(', ')}, ${settings.customPalette.seeds[0]})`,
                }}
                onClick={() => onChange({ seed: 'custom' })}
              />
            )}
          </div>
          <div className="m-seg" style={{ marginTop: 12 }}>
            <button className={`m-seg__opt ${settings.mode === 'dark' ? 'is-on' : ''}`} onClick={() => onChange({ mode: 'dark' })}>
              <span className="m-seg__dot" /> 暗色
            </button>
            <button className={`m-seg__opt ${settings.mode === 'light' ? 'is-on' : ''}`} onClick={() => onChange({ mode: 'light' })}>
              <span className="m-seg__dot" /> 亮色
            </button>
          </div>
        </div>

        {/* 分析 */}
        <div className="set-section">
          <div className="set-section__title">语音识别</div>
          <div className="m-field">
            <span className="m-field__label">模型档位（首次使用需下载，之后由服务器与浏览器双重缓存）</span>
            <div className="m-seg m-seg--full">
              {MODEL_PRESETS.map((p) => (
                <button
                  key={p.key}
                  className={`m-seg__opt ${settings.preset === p.key && !settings.customModel ? 'is-on' : ''}`}
                  onClick={() => onChange({ preset: p.key, customModel: '' })}
                >
                  <span className="m-seg__dot" />
                  {p.label.replace(' · ', ' ')}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 12, color: 'var(--md-onSurfaceVariant)' }}>
              {MODEL_PRESETS.find((p) => p.key === settings.preset)?.approx} ·{' '}
              {MODEL_PRESETS.find((p) => p.key === settings.preset)?.note}
            </span>
          </div>

          <div className="m-field" style={{ marginTop: 12 }}>
            <span className="m-field__label">自定义模型 ID（可选，需含 ONNX 权重，如微调粤语模型）</span>
            <input
              value={settings.customModel}
              placeholder="留空使用上方档位；例：username/whisper-yue-onnx"
              onChange={(e) => onChange({ customModel: e.target.value })}
            />
          </div>

          <div className="m-field" style={{ marginTop: 12 }}>
            <span className="m-field__label">歌曲语言</span>
            <select
              value={settings.language}
              onChange={(e) => onChange({ language: e.target.value as LangId })}
              style={{
                height: 44,
                borderRadius: 12,
                border: '1px solid var(--md-outlineVariant)',
                background: 'color-mix(in srgb, var(--md-surfaceContainerHighest) 45%, transparent)',
                padding: '0 12px',
                outline: 'none',
                width: '100%',
              }}
            >
              {(Object.keys(LANG_LABELS) as LangId[]).map((k) => (
                <option key={k} value={k}>{LANG_LABELS[k]}</option>
              ))}
            </select>
          </div>

          <div className="m-field" style={{ marginTop: 12 }}>
            <span className="m-field__label">模型下载源</span>
            <div className="m-seg m-seg--full">
              <button className={`m-seg__opt ${settings.mirror === 'mirror' ? 'is-on' : ''}`} onClick={() => onChange({ mirror: 'mirror' })}>
                <span className="m-seg__dot" /> 镜像源（自动回退）
              </button>
              <button className={`m-seg__opt ${settings.mirror === 'hf' ? 'is-on' : ''}`} onClick={() => onChange({ mirror: 'hf' })}>
                <span className="m-seg__dot" /> 直连 HuggingFace
              </button>
            </div>
            <span style={{ display: 'block', fontSize: 12, opacity: 0.6, marginTop: 4 }}>
              可用性自动探测：镜像源 = 本站代理 → hf-mirror.com → huggingface.co；直连失败也会回退 hf-mirror.com
            </span>
          </div>

          <div className="opt-row" style={{ marginTop: 6 }}>
            <div className="opt-row__text">
              <div className="opt-row__title">人声增强（HPSS）</div>
              <div className="opt-row__desc">中值滤波分离伴奏，保留人声；强伴奏歌曲建议开启</div>
            </div>
            <button
              className={`m-switch ${settings.vocalEnhance ? 'is-on' : ''}`}
              role="switch"
              aria-checked={settings.vocalEnhance}
              onClick={() => onChange({ vocalEnhance: !settings.vocalEnhance })}
            />
          </div>
        </div>

        {/* 说明 */}
        <div className="set-section">
          <div className="set-section__title">关于分析引擎</div>
          <div className="hint-box">
            <p>· 推理在<b>你的浏览器本地</b>完成（{webgpuAvailable ? '检测到 WebGPU，将启用 GPU 加速' : '未检测到 WebGPU，将使用 WASM'}），无服务端、无 API 限流。</p>
            <p>· <b>粤语</b>请选「高质量 · v3-Turbo」档（原生 yue 支持）+ 开启人声增强；若能提供歌词文本，效果最佳 —— 采用强制对齐，识别即使有同音字错误，时间戳仍然精准。</p>
            <p>· 提速手段：16kHz 单声道直通、VAD 跳过间奏、分段并行调度、模型浏览器缓存、WebGPU 量化（q4/q8）。</p>
          </div>
        </div>
      </div>
    </>
  )
}
