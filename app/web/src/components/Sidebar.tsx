import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, DragEvent as ReactDragEvent, ReactNode } from 'react'
import type { JournalDay, Notebook, Stats, Tag, View } from '../types'
import { api } from '../api'
import { tagHue, NOTE_MIME } from '../utils'
import ActivityHeatmap from './ActivityHeatmap'

interface Props {
  notebooks: Notebook[]
  tags: Tag[]
  stats: Stats | null
  view: View
  onSelectView: (v: View) => void
  onCreateNotebook: (name: string, parentId?: number | null) => Promise<void>
  onRenameNotebook: (id: number, name: string) => Promise<void>
  onMoveNotebook: (id: number, parentId: number | null, position?: number) => Promise<void>
  onDeleteNotebook: (nb: Notebook) => Promise<void>
  onOpenJournal: (date: string) => void
  /** v0.5：笔记拖拽换笔记本（notebookId=null 移入未分类） */
  onDropNote: (noteId: number, notebookId: number | null) => Promise<void>
  /** v0.6 标签管理：重命名（重名即合并）与删除 */
  onRenameTag: (id: number, name: string) => Promise<void>
  onDeleteTag: (tag: Tag) => Promise<void>
  /** v1.1 日历当日详情（点击有任务角标的日期） */
  onOpenDay: (date: string) => void
}

interface NotebookNode {
  nb: Notebook
  children: NotebookNode[]
  /** 子树聚合笔记数（含自身直接笔记） */
  agg: number
}

// 扁平列表 → 树（后端保证 parent 一致性；防御性把父不在列表中的节点视为顶级）
function buildTree(notebooks: Notebook[]): NotebookNode[] {
  const byParent = new Map<number | null, Notebook[]>()
  const ids = new Set(notebooks.map((n) => n.id))
  for (const nb of notebooks) {
    const key = nb.parent_id != null && ids.has(nb.parent_id) ? nb.parent_id : null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(nb)
  }
  const build = (parentKey: number | null): NotebookNode[] =>
    (byParent.get(parentKey) ?? []).map((nb) => {
      const node: NotebookNode = { nb, children: build(nb.id), agg: 0 }
      node.agg = node.nb.note_count + node.children.reduce((s, c) => s + c.agg, 0)
      return node
    })
  return build(null)
}

// 在树中找到 parentId 对应的子节点数组（兄弟序列）
function findChildren(nodes: NotebookNode[], parentId: number | null): NotebookNode[] | null {
  if (parentId === null) return nodes
  for (const n of nodes) {
    if (n.nb.id === parentId) return n.children
    const sub = findChildren(n.children, parentId)
    if (sub) return sub
  }
  return null
}

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']
const pad2 = (n: number) => String(n).padStart(2, '0')

export default function Sidebar({ notebooks, tags, stats, view, onSelectView, onCreateNotebook, onRenameNotebook, onMoveNotebook, onDeleteNotebook, onOpenJournal, onDropNote, onRenameTag, onDeleteTag, onOpenDay }: Props) {
  const [creating, setCreating] = useState<{ parentId: number | null } | null>(null)
  const [newName, setNewName] = useState('')
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const busy = useRef(false)

  // ---- 层级树：折叠状态（localStorage 持久化）与三区拖拽 ----
  const [folded, setFolded] = useState<Record<number, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('nb-folded') ?? '{}') } catch { return {} }
  })
  const toggleFold = (id: number, force?: boolean) => {
    setFolded((f) => {
      const next = { ...f, [id]: force ?? !f[id] }
      localStorage.setItem('nb-folded', JSON.stringify(next))
      return next
    })
  }
  const [dragId, setDragId] = useState<number | null>(null)
  const [drop, setDrop] = useState<{ kind: 'item'; id: number; zone: 'before' | 'after' | 'nest' } | { kind: 'root' } | null>(null)
  const expandTimer = useRef<number | undefined>(undefined)
  // v0.6 标签重命名
  const [editingTagId, setEditingTagId] = useState<number | null>(null)
  const [tagValue, setTagValue] = useState('')
  const tree = buildTree(notebooks)
  const parentOf = new Map(notebooks.map((n) => [n.id, n.parent_id]))

  const submitTagRename = async () => {
    if (busy.current) return
    const name = tagValue.trim()
    if (editingTagId && name) {
      busy.current = true
      try {
        await onRenameTag(editingTagId, name)
      } finally {
        busy.current = false
      }
    }
    setEditingTagId(null)
  }

  // target 是否位于 dragged 的子树内（自身或任一祖先等于 dragged）
  const inSubtreeOf = (draggedId: number, nodeId: number): boolean => {
    let cur: number | null | undefined = nodeId
    while (cur != null) {
      if (cur === draggedId) return true
      cur = parentOf.get(cur)
    }
    return false
  }
  const clearExpandTimer = () => {
    window.clearTimeout(expandTimer.current)
    expandTimer.current = undefined
  }

  const isNoteDrag = (e: ReactDragEvent) => e.dataTransfer.types.includes(NOTE_MIME)

  const itemDragOver = (e: ReactDragEvent<HTMLDivElement>, node: NotebookNode) => {
    // v0.5：笔记拖拽——整个条目都是放置目标
    if (isNoteDrag(e)) {
      e.preventDefault()
      setDrop({ kind: 'item', id: node.nb.id, zone: 'nest' })
      return
    }
    if (dragId === null || inSubtreeOf(dragId, node.nb.id)) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    let zone: 'before' | 'after' | 'nest'
    if (node.children.length && !folded[node.nb.id]) {
      // 有子级且展开：三区；折叠或有孩子都允许嵌套语义（折叠时中/下区都视为嵌套更顺手）
      zone = y < rect.height * 0.25 ? 'before' : y > rect.height * 0.75 ? 'after' : 'nest'
    } else {
      zone = y < rect.height * 0.4 ? 'before' : y > rect.height * 0.6 ? 'after' : 'nest'
    }
    setDrop({ kind: 'item', id: node.nb.id, zone })
    // 悬停自动展开（仅折叠且嵌套语义有意义时）
    clearExpandTimer()
    if (node.children.length && folded[node.nb.id] && zone === 'nest') {
      expandTimer.current = window.setTimeout(() => toggleFold(node.nb.id, false), 500)
    }
  }

  const finishDrop = async () => {
    clearExpandTimer()
    if (dragId === null || !drop) {
      setDragId(null)
      setDrop(null)
      return
    }
    if (drop.kind === 'root') {
      await onMoveNotebook(dragId, null)
    } else {
      const t = drop.id
      if (drop.zone === 'nest') {
        // 追加到目标子级末尾
        await onMoveNotebook(dragId, t)
      } else {
        // 前插/后插：按目标兄弟序列计算下标（剔除拖拽者）
        const parentId = parentOf.get(t) ?? null
        const sibs = (findChildren(tree, parentId) ?? []).map((x) => x.nb.id).filter((id) => id !== dragId)
        const idx = sibs.indexOf(t)
        const pos = drop.zone === 'before' ? Math.max(0, idx) : Math.min(sibs.length, idx + 1)
        await onMoveNotebook(dragId, parentId, pos)
      }
    }
    setDragId(null)
    setDrop(null)
  }

  // 放置分流：笔记拖拽 → 移动归类；笔记本拖拽 → 原 move 逻辑
  const handleItemDrop = (e: ReactDragEvent<HTMLDivElement>, node: NotebookNode) => {
    e.preventDefault()
    if (isNoteDrag(e)) {
      const noteId = Number(e.dataTransfer.getData(NOTE_MIME))
      clearExpandTimer()
      setDragId(null)
      setDrop(null)
      if (Number.isFinite(noteId)) onDropNote(noteId, node.nb.id)
      return
    }
    finishDrop()
  }
  const handleRootDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (isNoteDrag(e)) {
      const noteId = Number(e.dataTransfer.getData(NOTE_MIME))
      setDragId(null)
      setDrop(null)
      if (Number.isFinite(noteId)) onDropNote(noteId, null)
      return
    }
    finishDrop()
  }

  // ---- 每日笔记日历 ----
  const today = new Date()
  const [cal, setCal] = useState({ y: today.getFullYear(), m: today.getMonth() + 1 })
  const [journalDays, setJournalDays] = useState<JournalDay[]>([])
  const [taskDue, setTaskDue] = useState<Record<string, number>>({})
  const todayStr = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`

  useEffect(() => {
    let alive = true
    api.journalMonth(cal.y, cal.m)
      .then((d) => { if (alive) setJournalDays(d) })
      .catch(() => {})
    // v1.0 任务到期分布
    api.calendarMonth(cal.y, cal.m)
      .then((d) => { if (alive) setTaskDue(d.taskDue ?? {}) })
      .catch(() => {})
    return () => { alive = false }
  }, [cal.y, cal.m, stats?.total])

  const shiftMonth = (delta: number) => {
    setCal((c) => {
      const d = new Date(c.y, c.m - 1 + delta, 1)
      return { y: d.getFullYear(), m: d.getMonth() + 1 }
    })
  }

  // 月历网格：周一起始
  const firstWeekday = (new Date(cal.y, cal.m - 1, 1).getDay() + 6) % 7
  const daysInMonth = new Date(cal.y, cal.m, 0).getDate()
  const journalSet = new Set(journalDays.map((d) => d.journal_date))

  const submitCreate = async () => {
    if (busy.current) return
    const name = newName.trim()
    if (!name) {
      setCreating(null)
      return
    }
    busy.current = true
    try {
      await onCreateNotebook(name, creating?.parentId ?? null)
    } finally {
      busy.current = false
      setNewName('')
      setCreating(null)
    }
  }

  const submitRename = async () => {
    if (busy.current) return
    const name = renameValue.trim()
    if (renamingId && name && name !== notebooks.find((n) => n.id === renamingId)?.name) {
      busy.current = true
      try {
        await onRenameNotebook(renamingId, name)
      } finally {
        busy.current = false
      }
    }
    setRenamingId(null)
  }

  const renderNode = (node: NotebookNode, depth: number): ReactNode => {
    const { nb } = node
    const canFold = node.children.length > 0
    const isDropItem = drop?.kind === 'item' && drop.id === nb.id
    const zoneCls = isDropItem ? `drop-${drop.zone}` : ''
    return (
      <div key={nb.id}>
        <div
          className={`side-item nb-item ${view.kind === 'notebook' && view.notebookId === nb.id ? 'active' : ''} ${zoneCls}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          draggable
          onDragStart={(e) => { setDragId(nb.id); setDrop(null); e.dataTransfer.effectAllowed = 'move' }}
          onDragEnd={() => { clearExpandTimer(); setDragId(null); setDrop(null) }}
          onDragOver={(e) => itemDragOver(e, node)}
          onDragLeave={() => setDrop((d) => (d?.kind === 'item' && d.id === nb.id ? null : d))}
          onDrop={(e) => handleItemDrop(e, node)}
          onClick={() => onSelectView({ kind: 'notebook', notebookId: nb.id })}
          onDoubleClick={() => { setRenamingId(nb.id); setRenameValue(nb.name) }}
        >
          <button
            className={`icon-btn nb-fold ${canFold ? '' : 'nb-fold-leaf'}`}
            title={canFold ? (folded[nb.id] ? '展开' : '折叠') : ''}
            onClick={(e) => { e.stopPropagation(); if (canFold) toggleFold(nb.id) }}
          >
            {canFold ? (folded[nb.id] ? '▸' : '▾') : ''}
          </button>
          <span>{nb.icon}</span>
          {renamingId === nb.id ? (
            <input
              className="input side-input"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRename()
                if (e.key === 'Escape') setRenamingId(null)
              }}
              onBlur={submitRename}
              onClick={(e) => e.stopPropagation()}
              draggable={false}
            />
          ) : (
            <span className="ellipsis">{nb.name}</span>
          )}
          <span className="count">{node.agg}</span>
          <span className="row-actions" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn" title="新建子笔记本" onClick={() => { setCreating({ parentId: nb.id }); setNewName('') }}>＋</button>
            <button className="icon-btn" title="重命名（或双击名称）" onClick={() => { setRenamingId(nb.id); setRenameValue(nb.name) }}>✎</button>
            <button className="icon-btn danger" title="删除笔记本" onClick={() => onDeleteNotebook(nb)}>🗑</button>
          </span>
        </div>
        {!folded[nb.id] && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    )
  }

  const browseItem = (kind: View['kind'], icon: string, label: string, count?: number) => (
    <div
      className={`side-item ${view.kind === kind ? 'active' : ''}`}
      onClick={() => onSelectView({ kind } as View)}
    >
      <span>{icon}</span>
      <span className="ellipsis">{label}</span>
      {count !== undefined && <span className="count">{count}</span>}
    </div>
  )

  return (
    <aside className="sidebar">
      <div className="side-section">
        <div className="side-title">浏览</div>
        {browseItem('all', '📚', '全部笔记', stats?.total)}
        {browseItem('starred', '⭐', '收藏', stats?.starred)}
        {browseItem('trash', '🗑️', '回收站', stats?.trash)}
      </div>

      <div className="side-section">
        <div className="side-title">
          <span>每日笔记</span>
          <button className="btn ghost mini" onClick={() => onOpenJournal(todayStr)} title="打开今天的日记">今日</button>
        </div>
        <div className="calendar">
          <div className="cal-head">
            <button className="icon-btn" title="上个月" onClick={() => shiftMonth(-1)}>‹</button>
            <span className="cal-month">{cal.y} 年 {cal.m} 月</span>
            <button className="icon-btn" title="下个月" onClick={() => shiftMonth(1)}>›</button>
          </div>
          <div className="cal-grid">
            {WEEK_LABELS.map((w) => <span key={w} className="cal-wk">{w}</span>)}
            {Array.from({ length: firstWeekday }).map((_, i) => <span key={`pad-${i}`} className="cal-day empty" />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1
              const dateStr = `${cal.y}-${pad2(cal.m)}-${pad2(day)}`
              const has = journalSet.has(dateStr)
              const dueCount = taskDue[dateStr] ?? 0
              const cls = `cal-day${dateStr === todayStr ? ' today' : ''}${has ? ' has' : ''}`
              return (
                <button
                  key={dateStr}
                  className={cls}
                  title={has ? '打开当日日记' : dueCount ? `${dueCount} 个任务到期（点击查看，Shift+点击打开日记）` : '新建当日日记'}
                  onClick={(e) => {
                    if (dueCount > 0 && !e.shiftKey) onOpenDay(dateStr)
                    else onOpenJournal(dateStr)
                  }}
                >
                  {day}
                  {has && <i className="cal-dot" />}
                  {dueCount > 0 && <i className="cal-task-dot" title={`${dueCount} 个任务到期`} />}
                </button>
              )
            })}
          </div>
        </div>
        {journalDays.length > 0 && (
          <div className="cal-foot">本月 {journalDays.length} 天有记录</div>
        )}
      </div>

      <div className="side-section">
        <div
          className={`side-title ${drop?.kind === 'root' ? 'drop-target' : ''}`}
          onDragOver={(e) => { if (dragId !== null || isNoteDrag(e)) { e.preventDefault(); setDrop({ kind: 'root' }) } }}
          onDragLeave={() => setDrop((d) => (d?.kind === 'root' ? null : d))}
          onDrop={handleRootDrop}
        >
          <span>笔记本</span>
          <button className="icon-btn" title="新建顶级笔记本" onClick={() => { setCreating({ parentId: null }); setNewName('') }}>＋</button>
        </div>
        {creating && (
          <input
            className="input side-input"
            autoFocus
            placeholder={
              creating.parentId != null
                ? `在「${notebooks.find((n) => n.id === creating.parentId)?.name ?? ''}」下新建，回车确认`
                : '名称，回车确认'
            }
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitCreate()
              if (e.key === 'Escape') setCreating(null)
            }}
            onBlur={submitCreate}
          />
        )}
        {tree.map((node) => renderNode(node, 0))}
        {dragId !== null && (
          <div
            className={`nb-root-zone ${drop?.kind === 'root' ? 'drop-target' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDrop({ kind: 'root' }) }}
            onDragLeave={() => setDrop((d) => (d?.kind === 'root' ? null : d))}
            onDrop={handleRootDrop}
          >
            ⤴ 拖到此处提升为顶级 / 移出笔记本
          </div>
        )}
        {!notebooks.length && !creating && <div className="side-hint">还没有笔记本，点 ＋ 新建</div>}
      </div>

      <div className="side-section">
        <div className="side-title"><span>标签</span></div>        <div className="tag-cloud">
          {tags.map((t) => (
            <span key={t.id} className="tag-wrap">
              {editingTagId === t.id ? (
                <input
                  className="input side-input tag-edit"
                  autoFocus
                  value={tagValue}
                  onChange={(e) => setTagValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitTagRename()
                    if (e.key === 'Escape') setEditingTagId(null)
                  }}
                  onBlur={submitTagRename}
                />
              ) : (
                <>
                  <span
                    className={`chip ${view.kind === 'tag' && view.tagId === t.id ? 'chip-active' : ''}`}
                    style={{ '--h': tagHue(t.name) } as CSSProperties}
                    title="点击按标签筛选"
                    onClick={() =>
                      onSelectView(view.kind === 'tag' && view.tagId === t.id ? { kind: 'all' } : { kind: 'tag', tagId: t.id })
                    }
                  >
                    # {t.name} <em>{t.note_count}</em>
                  </span>
                  <span className="tag-actions">
                    <button className="icon-btn" title="重命名标签（重名即合并）" onClick={() => { setEditingTagId(t.id); setTagValue(t.name) }}>✎</button>
                    <button className="icon-btn danger" title="删除标签" onClick={() => onDeleteTag(t)}>🗑</button>
                  </span>
                </>
              )}
            </span>
          ))}
          {!tags.length && <div className="side-hint">给笔记添加标签后显示在这里</div>}
        </div>
      </div>

      <ActivityHeatmap refreshKey={stats?.total} />

      <div className="side-foot">
        简知 v1.1.0 · 数据保存在本机
        {stats && (
          <div className="side-foot-sub">{stats.words.toLocaleString()} 字 · 附件 {stats.attachments.count} 个</div>
        )}
      </div>
    </aside>
  )
}
