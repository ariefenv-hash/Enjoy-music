import { createRoot } from 'react-dom/client'
import App from './App'
import { Playback } from './core/player'
import './styles/base.css'
import './styles/md3.css'
import './styles/layout.css'
import { applyTheme } from './theme'

// 渲染前同步恢复主题（配合 index.html 的 data-* 预设，避免闪烁）
try {
  const s = JSON.parse(localStorage.getItem('md3-karaoke-settings') || '{}')
  applyTheme(s.seed ?? 'violet', s.mode === 'light' ? 'light' : 'dark', s.customPalette ?? null)
} catch {
  applyTheme('violet', 'dark')
}

// 预热 AudioContext（部分浏览器需要用户手势后才可用，这里仅创建）
void new Playback()

createRoot(document.getElementById('root')!).render(<App />)
