import { useEffect, useState } from 'react'
import type { TaskItem } from '../types'
import { api } from '../api'
import Modal from './Modal'

interface Props {
  date: string
  onClose: () => void
  onOpenTask: (noteId: number, line: string) => void
  onOpenJournal: () => void
}

// v1.1 日历当日详情：当日到期任务列表 + 日记入口
export default function DayDetailModal({ date, onClose, onOpenTask, onOpenJournal }: Props) {
  const [tasks, setTasks] = useState<TaskItem[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api.listTasks({ due: date })
      .then((d) => setTasks(d.tasks))
      .catch((e) => setErr((e as Error).message))
  }, [date])

  return (
    <Modal title={`📅 ${date}`} onClose={onClose} width={520}>
      {err && <div className="side-hint" style={{ padding: 16 }}>加载失败：{err}</div>}
      {!err && tasks === null && <div className="side-hint" style={{ padding: 16 }}>加载中…</div>}
      {tasks !== null && (
        <>
          <button className="btn ghost small" onClick={onOpenJournal}>📝 打开当日日记</button>
          <div className="task-groups" style={{ marginTop: 8 }}>
            {!tasks.length && <div className="side-hint" style={{ padding: 12 }}>这天没有到期的任务</div>}
            {tasks.map((t, i) => (
              <div key={`${t.noteId}-${t.lineIndex}-${i}`} className={`task-row ${t.checked ? 'done' : ''}`}>
                <button
                  className="task-box-btn"
                  title={t.checked ? '标记为未完成' : '标记为完成（回写源笔记）'}
                onClick={() => {
                  api.toggleTask(t.noteId, t.lineIndex, !t.checked, t.line)
                    .then(() => api.listTasks({ due: date }))
                    .then((d) => setTasks(d.tasks))
                    .catch((e) => setErr((e as Error).message))
                }}
                >
                  {t.checked ? '☑' : '☐'}
                </button>
                <button className="task-text-btn" title="点击打开笔记并定位到该行" onClick={() => onOpenTask(t.noteId, t.line)}>
                  <span className="task-text ellipsis">{t.text || '（空任务）'}</span>
                </button>
                {t.priority !== 0 && (
                  <span className="due-chip prio" title="有优先级">⭐</span>
                )}
                <span className="si-meta" style={{ fontSize: 11 }}>《{t.noteTitle}》</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}
