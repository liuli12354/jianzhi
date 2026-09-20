import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Notebook, SearchResponse, SearchResult, Tag } from '../types'
import { api } from '../api'
import { relativeTime } from '../utils'

/** 把 FTS snippet 的 \u0001/\u0002 标记转为 <mark> 高亮 */
function Snippet({ text, fallback }: { text: string | null; fallback?: string }) {
  if (!text) return <>{fallback ?? ''}</>
  const parts = text.split(/[\u0001\u0002]/)
  // odd 下标为命中词（split 后奇数段是标记之间的内容）
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}
    </>
  )
}

function TitleHit({ title, q }: { title: string; q: string }) {
  const needle = q.trim()
  if (!needle) return <>{title}</>
  const idx = title.toLowerCase().indexOf(needle.toLowerCase())
  if (idx === -1) return <>{title}</>
  return (
    <>
      {title.slice(0, idx)}
      <mark>{title.slice(idx, idx + needle.length)}</mark>
      {title.slice(idx + needle.length)}
    </>
  )
}

interface Props {
  notebooks: Notebook[]
  tags: Tag[]
  onClose: () => void
  onOpen: (id: number, locateText: string) => void
}

// v1.0 定位文本：FTS snippet 剥离高亮标记；LIKE 模式用查询词
function locateTextOf(n: SearchResult, q: string): string {
  if (n.snippet) return n.snippet.replace(/[\u0001\u0002]/g, '').replace(/…/g, ' ').trim().slice(0, 60)
  return q.trim()
}

export default function SearchModal({ notebooks, tags, onClose, onOpen }: Props) {
  const [q, setQ] = useState('')
  const [notebookId, setNotebookId] = useState('')
  const [tagId, setTagId] = useState('')
  const [data, setData] = useState<SearchResponse | null>(null)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!q.trim()) {
      setData(null)
      setActive(0)
      return
    }
    const t = window.setTimeout(async () => {
      try {
        const res = await api.search({
          q,
          notebookId: notebookId !== '' ? Number(notebookId) : undefined,
          tagId: tagId !== '' ? Number(tagId) : undefined,
        })
        setData(res)
        setActive(0)
      } catch {
        /* 静默失败，下次输入重试 */
      }
    }, 180)
    return () => window.clearTimeout(t)
  }, [q, notebookId, tagId])

  const results = data?.results ?? []

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); onOpen(results[active].id, locateTextOf(results[active], q)) }
  }

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal search-modal" onKeyDown={onKeyDown}>
        <div className="search-bar">
          <span>🔍</span>
          <input
            ref={inputRef}
            autoFocus
            placeholder="搜索标题与正文…（↑↓ 选择，回车打开，Esc 关闭）"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="search-filters">
          <select value={notebookId} onChange={(e) => setNotebookId(e.target.value)}>
            <option value="">全部笔记本</option>
            {notebooks.map((nb) => (
              <option key={nb.id} value={nb.id}>{nb.icon} {nb.name}</option>
            ))}
          </select>
          <select value={tagId} onChange={(e) => setTagId(e.target.value)}>
            <option value="">全部标签</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}># {t.name}</option>
            ))}
          </select>
          {data && data.mode !== 'empty' && q.trim() && (
            <span className="search-mode" title={data.mode === 'fts' ? '全文索引检索（相关度排序）' : '短词子串匹配'}>
              {data.mode === 'fts' ? '⚡ 全文检索' : '🔖 子串匹配'} · {data.total} 条
            </span>
          )}
        </div>
        <div className="search-results">
          {q.trim() && !results.length && <div className="side-hint" style={{ padding: 16 }}>没有匹配的笔记</div>}
          {results.map((n: SearchResult, i) => (
            <div
              key={n.id}
              className={`search-item ${i === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => onOpen(n.id, locateTextOf(n, q))}
            >
              <div className="si-title">
                <TitleHit title={n.title || '无标题'} q={q} />
                {n.deleted_at && <span className="si-trash">回收站</span>}
              </div>
              <div className="si-snip">
                <Snippet text={n.snippet} />
              </div>
              <div className="si-meta">{relativeTime(n.updated_at)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
