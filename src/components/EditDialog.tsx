import { useEffect, useState } from 'react'
import { estimateWords, fmtLrcTime, type LyricLine } from '../core/lyrics'
import { IconClose } from './Icons'

interface Props {
  open: boolean
  lines: LyricLine[]
  onClose: () => void
  onSave: (lines: LyricLine[]) => void
}

/** 歌词编辑：一行一条 "mm:ss.xx 文本"，保存后保留时间并按新文本重切词 */
export function EditDialog({ open, lines, onClose, onSave }: Props) {
  const [text, setText] = useState('')
  useEffect(() => {
    if (open) {
      setText(
        lines
          .map((l) => `${fmtLrcTime(l.start)} ${l.text}`)
          .join('\n'),
      )
    }
  }, [open, lines])

  if (!open) return null

  const save = () => {
    const out: LyricLine[] = []
    for (const row of text.split('\n')) {
      const m = row.match(/^\s*\[(\d+:\d+(?:\.\d+)?)\]\s*(.*)$/) ?? row.match(/^\s*(\d+:\d+(?:\.\d+)?)\s+(.*)$/)
      if (!m) continue
      const parts = m[1].split(':').map(Number)
      const start = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0]
      const content = m[2].trim()
      if (!content) continue
      const prev = out[out.length - 1]
      const end = prev ? start + Math.max(1, (prev.end - prev.start)) : start + 5
      out.push({
        index: out.length,
        text: content,
        start,
        end,
        words: estimateWords(content, start, end),
      })
    }
    // 修正行尾
    for (let i = 0; i < out.length - 1; i++) {
      out[i].end = Math.max(out[i].start + 0.4, out[i + 1].start - 0.05)
      out[i].words = estimateWords(out[i].text, out[i].start, out[i].end)
    }
    onSave(out)
    onClose()
  }

  return (
    <>
      <div className="m-dialog-scrim" onClick={onClose} />
      <div className="m-dialog">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <div className="t-headline" style={{ flex: 1 }}>编辑歌词</div>
          <button className="m-icon-btn" onClick={onClose}>
            <IconClose size={20} />
          </button>
        </div>
        <div className="hint-box" style={{ marginBottom: 12 }}>
          每行格式：<code>mm:ss.xx 歌词文本</code>。修改文本后保存，将按原时间重新切分字级时间戳。
        </div>
        <textarea className="edit-area" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="m-btn m-btn--text" onClick={onClose}>取消</button>
          <button className="m-btn m-btn--filled" onClick={save}>保存</button>
        </div>
      </div>
    </>
  )
}
