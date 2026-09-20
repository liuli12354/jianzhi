import { useEffect, useMemo, useState } from 'react'
import type { TaskItem } from '../types'
import { api } from '../api'
import Modal from './Modal'

interface Props {
  onClose: () => void
  onOpenTask: (noteId: number, line: string) => void
  onToast: (msg: string, action?: { label: string; run: () => void }) => void
  onDataChanged: () => void
}

type Filter = 'open' | 'overdue' | 'done' | 'all'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'open', label: '未完成' },
  { key: 'overdue', label: '⚠️ 逾期' },
  { key: 'done', label: '已完成' },
  { key: 'all', label: '全部' },
]

const todayStr = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function dueClass(due: string): string {
  const today = todayStr()
  if (due < today) return 'overdue'
  if (due === today) return 'today'
  return 'future'
}

// v1.1 多档优先级 chip（对齐 Obsidian Tasks 档位）
const PRIORITY_EMOJI: Record<string, string> = { '3': '🔺', '2': '⏫', '1': '🔼', '-1': '⏬' }
const PRIORITY_LABEL: Record<string, string> = { '3': '最高优先级', '2': '高优先级', '1': '中优先级', '-1': '低优先级' }

// 任务汇总（v0.6/v0.7）：全库 GFM 任务按笔记分组，点击任务打开笔记并定位；勾选直接回写源笔记
export default function TasksModal({ onClose, onOpenTask, onToast, onDataChanged }: Props) {
  const [tasks, setTasks] = useState<TaskItem[] | null>(null)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState<Filter>('open')
  const [groupBy, setGroupBy] = useState<'note' | 'date'>('note')

  useEffect(() => {
    api.listTasks()
      .then((d) => setTasks(d.tasks))
      .catch((e) => setErr((e as Error).message))
  }, [])

  const reload = async () => {
    const d = await api.listTasks()
    setTasks(d.tasks)
    onDataChanged()
  }

  const toggle = async (t: TaskItem) => {
    try {
      await api.toggleTask(t.noteId, t.lineIndex, !t.checked, t.line)
      await reload()
      const newLine = t.line.replace(/\[( |x|X)\]/, !t.checked ? '[x]' : '[ ]')
      onToast(!t.checked ? '已完成' : '已标记为未完成', {
        label: '撤销',
        run: () => {
          api.toggleTask(t.noteId, t.lineIndex, t.checked, newLine)
            .then(reload)
            .then(() => onToast('已撤销'))
            .catch((e) => onToast((e as Error).message))
        },
      })
    } catch (e) {
      onToast((e as Error).message)
    }
  }

  const filtered = useMemo(() => {
    if (!tasks) return []
    const today = todayStr()
    return tasks.filter((t) => {
      if (filter === 'all') return true
      if (filter === 'done') return t.checked
      if (filter === 'overdue') return !t.checked && !!t.due && t.due < today
      return !t.checked
    })
  }, [tasks, filter])

  // 按笔记分组（保持后端排序）
  const noteGroups = useMemo(() => {
    const map = new Map<string, TaskItem[]>()
    for (const t of filtered) {
      const key = `${t.noteId}\u0000${t.noteTitle}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(t)
    }
    return [...map.entries()].map(([key, items]) => ({
      key,
      noteId: Number(key.split('\u0000')[0]),
      noteTitle: key.split('\u0000')[1],
      items,
    }))
  }, [filtered])

  // v0.9 日期五段式分组：逾期 → 今天 → 未来 → 无日期 → 已完成（段内 ⭐ 优先、due 升序）
  const byPriorityDue = (a: TaskItem, b: TaskItem) =>
    (b.priority ?? 0) - (a.priority ?? 0) || (a.due ?? '9999').localeCompare(b.due ?? '9999')
  const dateGroups = useMemo(() => {
    const today = todayStr()
    const buckets: { label: string; items: TaskItem[] }[] = [
      { label: '⚠️ 逾期', items: [] },
      { label: '📅 今天', items: [] },
      { label: '🔜 未来', items: [] },
      { label: '📝 无日期', items: [] },
      { label: '✅ 已完成', items: [] },
    ]
    for (const t of filtered) {
      if (t.checked) buckets[4].items.push(t)
      else if (!t.due) buckets[3].items.push(t)
      else if (t.due < today) buckets[0].items.push(t)
      else if (t.due === today) buckets[1].items.push(t)
      else buckets[2].items.push(t)
    }
    buckets.forEach((b) => b.items.sort(byPriorityDue))
    return buckets.filter((b) => b.items.length)
  }, [filtered])

  const openCount = tasks?.filter((t) => !t.checked).length ?? 0
  const doneCount = tasks?.filter((t) => t.checked).length ?? 0

  const renderRow = (t: TaskItem, i: number) => (
    <div key={`${t.noteId}-${t.lineIndex}-${i}`} className={`task-row ${t.checked ? 'done' : ''}`}>
      <button
        className="task-box-btn"
        title={t.checked ? '标记为未完成' : '标记为完成（回写源笔记）'}
        onClick={() => toggle(t)}
      >
        {t.checked ? '☑' : '☐'}
      </button>
      <button
        className="task-text-btn"
        title="点击打开笔记并定位到该行"
        onClick={() => onOpenTask(t.noteId, t.line)}
      >
        <span className="task-text ellipsis">{t.text || '（空任务）'}</span>
      </button>
      {t.priority != null && t.priority !== 0 && (
        <span className={`due-chip prio p${t.priority}`} title={PRIORITY_LABEL[String(t.priority)] ?? '优先级'}>
          {t.text.includes('⭐') ? '⭐' : (PRIORITY_EMOJI[String(t.priority)] ?? '')}
        </span>
      )}
      {t.due && <span className={`due-chip ${dueClass(t.due)}`}>📅 {t.due.slice(5)}</span>}
    </div>
  )

  return (
    <Modal title={`✅ 任务汇总${tasks ? ` · 未完成 ${openCount} / 已完成 ${doneCount}` : ''}`} onClose={onClose} width={640}>
      {err && <div className="side-hint" style={{ padding: 16 }}>加载失败：{err}</div>}
      {!err && !tasks && <div className="side-hint" style={{ padding: 16 }}>加载中…</div>}
      {tasks && (
        <>
          <div className="task-filters">
            {FILTERS.map((f) => (
              <button key={f.key} className={`btn small ${filter === f.key ? 'primary' : 'ghost'}`} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
            <span className="task-filters-sep" />
            <span className="task-group-label">分组</span>
            <div className="seg">
              {([['note', '笔记'], ['date', '日期']] as const).map(([k, label]) => (
                <button key={k} className={groupBy === k ? 'on' : ''} onClick={() => setGroupBy(k)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="task-groups">
            {groupBy === 'note' && (
              <>
                {!noteGroups.length && <div className="side-hint" style={{ padding: 16 }}>{filter === 'open' ? '太棒了，没有未完成的任务' : '没有任务'}</div>}
                {noteGroups.map((g) => (
                  <div key={g.key} className="task-group">
                    <button className="task-note" title="打开这篇笔记" onClick={() => onOpenTask(g.noteId, g.items[0]?.line ?? '')}>
                      📄 {g.noteTitle}
                      <span className="task-note-count">{g.items.length}</span>
                    </button>
                    {g.items.map(renderRow)}
                  </div>
                ))}
              </>
            )}
            {groupBy === 'date' && (
              <>
                {!dateGroups.length && <div className="side-hint" style={{ padding: 16 }}>没有任务</div>}
                {dateGroups.map((g) => (
                  <div key={g.label} className="task-group">
                    <div className="task-date-head">{g.label}<span className="task-note-count">{g.items.length}</span></div>
                    {g.items.map(renderRow)}
                  </div>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}
