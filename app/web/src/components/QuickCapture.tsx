import { useEffect, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

interface Props {
  onClose: () => void
  onSave: (text: string) => Promise<void>
  onSaveToJournal: (text: string) => Promise<void>
}

// v1.0 从正文前 200 字符解析 #标签（排除标题行），最多 5 个
export function parseQuickTags(text: string): string[] {
  const head = text.slice(0, 200)
  const tags = new Set<string>()
  for (const line of head.split('\n')) {
    if (/^#{1,6}\s/.test(line.trim())) continue
    for (const m of line.matchAll(/(?:^|\s)#([^\s#。，；！？,;!?]+)/g)) {
      const name = m[1].trim()
      if (name) tags.add(name)
    }
  }
  return [...tags].slice(0, 5)
}

// v1.0 快速捕获：flomo/Memos 式极简记录，Ctrl+Enter 保存到未分类
export default function QuickCapture({ onClose, onSave, onSaveToJournal }: Props) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [toJournal, setToJournal] = useState(() => localStorage.getItem('qc-journal') === '1')

  const toggleJournal = () => {
    setToJournal((v) => {
      localStorage.setItem('qc-journal', v ? '0' : '1')
      return !v
    })
  }

  useEffect(() => {
    // 聚焦到末尾
    const ta = document.querySelector('.qc-input') as HTMLTextAreaElement | null
    ta?.focus()
  }, [])

  const save = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      if (toJournal) await onSaveToJournal(text)
      else await onSave(text)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      save()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  const tags = parseQuickTags(text)

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal quick-capture" onKeyDown={onKeyDown}>
        <div className="qc-head">
          <span>⚡ 快速记录</span>
          <span className="qc-hint">支持 #标签 · Ctrl+Enter 保存</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <textarea
          className="qc-input"
          autoFocus
          rows={4}
          placeholder="想到什么记什么…&#10;开头写 #标签 即可自动归类"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="qc-actions">
          <label className="qc-journal" title="开启后保存到今天的日记（无则创建），内容追加不新建笔记">
            <input type="checkbox" checked={toJournal} onChange={toggleJournal} />
            写入今日日记
          </label>
          <span className="side-hint">{tags.length ? tags.map((t) => `#${t}`).join(' ') : toJournal ? '追加到今日日记' : '保存到未分类'}</span>
          <button className="btn primary small" disabled={busy || !text.trim()} onClick={save}>
            保存（Ctrl+Enter）
          </button>
        </div>
      </div>
    </div>
  )
}
