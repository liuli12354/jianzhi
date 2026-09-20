import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Note } from '../types'
import { excerpt } from '../utils'

export interface CommandAction {
  id: string
  title: string
  kbd?: string
  run: () => void
}

interface Props {
  actions: CommandAction[]
  notes: Note[]
  onClose: () => void
  onOpenNote: (id: number) => void
}

interface Row {
  key: string
  group: '命令' | '跳转到笔记'
  title: string
  hint?: string
  badge?: string
  run: () => void
  score: number
}

// v0.5 最近使用（MRU）：执行过的命令下次打开置顶，localStorage 持久化
const MRU_KEY = 'palette-mru'
const MRU_MAX = 8
function readMru(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(MRU_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, MRU_MAX) : []
  } catch {
    return []
  }
}
function recordMru(id: string) {
  const next = [id, ...readMru().filter((x) => x !== id)].slice(0, MRU_MAX)
  localStorage.setItem(MRU_KEY, JSON.stringify(next))
}

// 模糊匹配评分（v0.4/v0.9）：前缀 0 分最优 > 子串（越靠前越好）> 子序列（长度惩罚）> 不命中
// v0.9：可传入拼音首字母串参与匹配（中文命令「xjbj」可命中）
function fuzzyScore(text: string, kw: string): number {
  if (!kw) return 10
  const t = text.toLowerCase()
  const idx = t.indexOf(kw)
  if (idx === 0) return 0
  if (idx > 0) return 1 + idx * 0.01
  let i = 0
  for (const ch of t) {
    if (ch === kw[i]) i += 1
    if (i === kw.length) return 50 + t.length * 0.01
  }
  return Number.POSITIVE_INFINITY
}

// 命令面板（Ctrl+P）：动作注册表 + 笔记跳转，与 Ctrl+K 内容搜索分工
export default function CommandPalette({ actions, notes, onClose, onOpenNote }: Props) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [mru, setMru] = useState<string[]>(readMru)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // v0.9 拼音首字母匹配：懒加载 pinyin-pro，不占主包
  const pyFn = useRef<((t: string) => string) | null>(null)
  const pyCache = useRef(new Map<string, string>())
  const [pinyinReady, setPinyinReady] = useState(false)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    import('pinyin-pro')
      .then((m) => {
        pyFn.current = (t: string) => m.pinyin(t, { pattern: 'first', toneType: 'none', type: 'array' }).join('')
        setPinyinReady(true)
      })
      .catch(() => { /* 加载失败降级为纯文本匹配 */ })
  }, [])

  const pyOf = (text: string): string => {
    const fn = pyFn.current
    if (!fn) return ''
    let v = pyCache.current.get(text)
    if (v === undefined) {
      v = fn(text)
      pyCache.current.set(text, v)
    }
    return v
  }

  // 综合评分：标题原文与拼音首字母串取最优
  // 调研惯例（doc 15）：小写关键词匹配拼音，含大写时只匹配原文
  const bestScore = (title: string, extra?: string, kwOffset = 0): number => {
    const s1 = fuzzyScore(title, kw)
    if (!extra || !kw || !/^[a-z]+$/.test(kw)) return s1
    return Math.min(s1, fuzzyScore(extra, kw) + kwOffset)
  }

  const kw = q.trim().toLowerCase()

  const rows = useMemo<Row[]>(() => {
    const mruIdx = new Map(mru.map((id, i) => [id, i]))
    const actionRows: Row[] = actions
      .map((a) => ({
        key: `a-${a.id}`,
        group: '命令' as const,
        title: a.title,
        hint: a.kbd,
        badge: mruIdx.has(a.id) ? '⏱ 最近' : undefined,
        run: () => {
          recordMru(a.id)
          setMru(readMru())
          a.run()
        },
        score: bestScore(a.title, pyOf(a.title)),
      }))
      .filter((r) => Number.isFinite(r.score))
    // MRU 置顶（按最近次序），其余按评分
    actionRows.sort((x, y) => {
      const mx = mruIdx.get(x.key.slice(2))
      const my = mruIdx.get(y.key.slice(2))
      if (mx !== undefined && my !== undefined) return mx - my
      if (mx !== undefined) return -1
      if (my !== undefined) return 1
      return x.score - y.score
    })
    const noteRows: Row[] = notes
      .map((n) => {
        const title = n.title || '无标题'
        const s = Math.min(
          bestScore(title, pyOf(title)),
          fuzzyScore(excerpt(n.content, 40), kw) + 5,
        )
        return { key: `n-${n.id}`, group: '跳转到笔记' as const, title, hint: excerpt(n.content, 36), run: () => onOpenNote(n.id), score: s }
      })
      .filter((r) => Number.isFinite(r.score))
      .slice(0, 30)
    // 组内按评分升序（稳定：同分保持原序），命令组在前
    actionRows.sort((x, y) => x.score - y.score)
    noteRows.sort((x, y) => x.score - y.score)
    return [...actionRows, ...noteRows]
  }, [actions, notes, kw, onOpenNote, mru, pinyinReady])

  useEffect(() => {
    setActive(0)
  }, [q])

  // 键盘选中项保持可见
  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (rows.length ? (a + 1) % rows.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (rows.length ? (a - 1 + rows.length) % rows.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const row = rows[active]
      if (row) {
        onClose()
        row.run()
      }
    }
  }

  const pick = (row: Row) => {
    onClose()
    row.run()
  }

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal search-modal" onKeyDown={onKeyDown}>
        <div className="search-bar">
          <span>⌘</span>
          <input
            ref={inputRef}
            autoFocus
            placeholder="输入命令或笔记标题…（↑↓ 选择，回车执行，Esc 关闭）"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="search-results" ref={listRef}>
          {!rows.length && <div className="side-hint" style={{ padding: 16 }}>没有匹配的命令或笔记</div>}
          {rows.map((row, i) => {
            const showGroup = i === 0 || rows[i - 1].group !== row.group
            return (
              <div key={row.key}>
                {showGroup && <div className="palette-group">{row.group}</div>}
                <div
                  className={`search-item palette-item ${i === active ? 'active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(row)}
                >
                  <div className="si-title">
                    {row.badge && <span className="palette-badge">{row.badge}</span>}
                    {row.title}
                    {row.hint && <span className="palette-hint">{row.hint}</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
