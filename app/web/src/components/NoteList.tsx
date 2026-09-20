import type { CSSProperties } from 'react'
import type { Note, Notebook, SortKey, Tag, View } from '../types'
import { excerpt, relativeTime, tagHue, NOTE_MIME, countTasks } from '../utils'

// v0.6 面包屑：层级笔记本完整路径
function notebookPath(notebooks: Notebook[], id: number | undefined): string {
  if (id === undefined) return ''
  const byId = new Map(notebooks.map((n) => [n.id, n]))
  const parts: string[] = []
  let cur = byId.get(id)
  let guard = 0
  while (cur && guard < 20) {
    parts.unshift(cur.name)
    cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined
    guard += 1
  }
  return parts.join(' / ')
}

interface Props {
  notes: Note[]
  view: View
  notebooks: Notebook[]
  tags: Tag[]
  sort: SortKey
  onSortChange: (s: SortKey) => void
  currentId: number | null
  onSelect: (id: number) => void
  onCreate: () => void
  onCreateFromTemplate: () => void
  onTogglePin: (n: Note) => void
  onToggleStar: (n: Note) => void
  onRestore: (n: Note) => void
  onPurge: (n: Note) => void
  onDelete: (n: Note) => void
  onEmptyTrash: () => void
}

function viewTitle(view: View, notebooks: Notebook[], tags: Tag[]): { label: string; crumb?: string } {
  switch (view.kind) {
    case 'all':
      return { label: '全部笔记' }
    case 'starred':
      return { label: '收藏' }
    case 'trash':
      return { label: '回收站' }
    case 'notebook': {
      const nb = notebooks.find((n) => n.id === view.notebookId)
      const path = notebookPath(notebooks, view.notebookId)
      return { label: nb?.name ?? '笔记本', crumb: path.includes(' / ') ? path : undefined }
    }
    case 'tag':
      return { label: `# ${tags.find((t) => t.id === view.tagId)?.name ?? '标签'}` }
  }
}

export default function NoteList({
  notes, view, notebooks, tags, sort, onSortChange, currentId, onSelect,
  onCreate, onCreateFromTemplate, onTogglePin, onToggleStar, onRestore, onPurge, onDelete, onEmptyTrash,
}: Props) {
  const isTrash = view.kind === 'trash'
  const title = viewTitle(view, notebooks, tags)
  return (
    <section className="notelist">
      <div className="nl-head">
        <div className="nl-title" title={title.crumb}>
          <span className="ellipsis">{title.label}</span>
          {title.crumb && <span className="nl-crumb ellipsis">{title.crumb}</span>}
          <span className="nl-count">{notes.length}</span>
        </div>
        <div className="nl-tools">
          {isTrash ? (
            <button className="btn ghost small" onClick={onEmptyTrash}>清空回收站</button>
          ) : (
            <>
              <select className="nl-sort" value={sort} onChange={(e) => onSortChange(e.target.value as SortKey)} title="排序方式">
                <option value="updated">按更新时间</option>
                <option value="created">按创建时间</option>
                <option value="title">按标题</option>
              </select>
              <button className="btn primary small" onClick={onCreate} title="新建笔记（Ctrl+N）">＋ 新建</button>
              <button className="icon-btn" onClick={onCreateFromTemplate} title="从模板新建">📄</button>
            </>
          )}
        </div>
      </div>

      <div className="nl-list">
        {notes.map((n) => (
          <div
            key={n.id}
            className={`note-item ${n.id === currentId ? 'active' : ''}`}
            onClick={() => onSelect(n.id)}
            draggable={!isTrash}
            title={!isTrash ? '拖到左侧笔记本可移动归类' : undefined}
            onDragStart={(e) => {
              e.dataTransfer.setData(NOTE_MIME, String(n.id))
              e.dataTransfer.effectAllowed = 'move'
            }}
          >
            <div className="ni-title">
              {n.pinned === 1 && <span title="已置顶">📌</span>}
              {n.starred === 1 && <span title="已收藏">⭐</span>}
              <span className="ellipsis">{n.title || '无标题'}</span>
            </div>
            <div className="ni-snip ellipsis">{excerpt(n.content) || '（空笔记）'}</div>
            <div className="ni-meta">
              <span>{relativeTime(n.deleted_at ?? n.updated_at)}</span>
              {(() => {
                const { done, total } = countTasks(n.content)
                return total > 0 ? (
                  <span className={`task-mini ${done === total ? 'all-done' : ''}`} title="任务进度">☑ {done}/{total}</span>
                ) : null
              })()}
              {(n.tags ?? []).slice(0, 3).map((t) => (
                <span key={t.id} className="chip mini" style={{ '--h': tagHue(t.name) } as CSSProperties}>
                  # {t.name}
                </span>
              ))}
            </div>
            <div className="ni-actions" onClick={(e) => e.stopPropagation()}>
              {isTrash ? (
                <>
                  <button className="icon-btn" title="恢复笔记" onClick={() => onRestore(n)}>↩️</button>
                  <button className="icon-btn danger" title="彻底删除" onClick={() => onPurge(n)}>🗑</button>
                </>
              ) : (
                <>
                  <button className="icon-btn" title={n.starred ? '取消收藏' : '收藏'} onClick={() => onToggleStar(n)}>{n.starred ? '★' : '☆'}</button>
                  <button className="icon-btn" title={n.pinned ? '取消置顶' : '置顶'} onClick={() => onTogglePin(n)}>{n.pinned ? '📌' : '📍'}</button>
                  <button className="icon-btn danger" title="移入回收站" onClick={() => onDelete(n)}>🗑</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {!notes.length && (
        <div className="empty">
          <div className="empty-icon">{isTrash ? '🗑️' : '📝'}</div>
          <div>{isTrash ? '回收站是空的' : '这里还没有笔记'}</div>
          {!isTrash && (
            <button className="btn primary" onClick={onCreate}>＋ 新建笔记</button>
          )}
        </div>
      )}
    </section>
  )
}
