import { IconMoon, IconMusic, IconSettings, IconSun } from './Icons'

interface Props {
  mode: 'light' | 'dark'
  onToggleMode: () => void
  onOpenSettings: () => void
  deviceLabel?: string
}

export function TopBar({ mode, onToggleMode, onOpenSettings, deviceLabel }: Props) {
  return (
    <header className="topbar">
      <div className="topbar__logo">
        <IconMusic size={24} />
      </div>
      <div>
        <div className="topbar__title">逐字歌词工坊</div>
        <div className="topbar__sub">
          MD3 · 本地 AI 分析 · {deviceLabel ?? 'WebGPU 就绪'}
        </div>
      </div>
      <div className="topbar__spacer" />
      <button className="m-icon-btn" onClick={onToggleMode} title={mode === 'dark' ? '切换亮色' : '切换暗色'}>
        {mode === 'dark' ? <IconSun size={20} /> : <IconMoon size={20} />}
      </button>
      <button className="m-icon-btn" onClick={onOpenSettings} title="设置">
        <IconSettings size={20} />
      </button>
    </header>
  )
}
