// 后端 API 封装
import type {
  AppSettings, Attachment, Backlink, BackupInfo, BackupsResponse, CalendarMonth, GraphData, JournalDay,
  Notebook, Note, NoteVersion, OutgoingLink, SearchResponse, Stats, Tag, TaskItem, UnlinkedMention, UploadedAttachment,
} from './types'
import { renderMarkdown } from './markdown'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `请求失败（HTTP ${res.status}）`
    try {
      const data = await res.json()
      if (data?.error) msg = data.error
    } catch {
      /* 忽略非 JSON 响应 */
    }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export const api = {
  // ---- 笔记本 ----
  listNotebooks: () => fetch('/api/notebooks').then((r) => handle<Notebook[]>(r)),
  createNotebook: (name: string, parentId?: number | null) =>
    fetch('/api/notebooks', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name, parentId: parentId ?? null }) }).then((r) => handle<Notebook>(r)),
  updateNotebook: (id: number, patch: { name?: string; parentId?: number | null; position?: number }) =>
    fetch(`/api/notebooks/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) }).then((r) => handle<Notebook>(r)),
  deleteNotebook: (id: number) => fetch(`/api/notebooks/${id}`, { method: 'DELETE' }).then((r) => handle<{ ok: boolean }>(r)),

  // ---- 笔记 ----
  listNotes: (params: Record<string, string | number | undefined> = {}) =>
    fetch(`/api/notes${qs(params)}`).then((r) => handle<Note[]>(r)),
  getNote: (id: number) => fetch(`/api/notes/${id}`).then((r) => handle<Note>(r)),
  getRandomNote: () => fetch('/api/notes/random').then((r) => handle<{ note: Note | null }>(r)),
  createNote: (data: { notebookId?: number | null; title?: string; content?: string; tags?: string[] }) =>
    fetch('/api/notes', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(data) }).then((r) => handle<Note>(r)),
  updateNote: (
    id: number,
    patch: { title?: string; content?: string; notebookId?: number | null; pinned?: boolean; starred?: boolean; tags?: string[] },
  ) => fetch(`/api/notes/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) }).then((r) => handle<Note>(r)),
  deleteNote: (id: number) => fetch(`/api/notes/${id}`, { method: 'DELETE' }).then((r) => handle<{ ok: boolean }>(r)),
  purgeNote: (id: number) => fetch(`/api/notes/${id}?purge=1`, { method: 'DELETE' }).then((r) => handle<{ ok: boolean }>(r)),
  restoreNote: (id: number) => fetch(`/api/notes/${id}/restore`, { method: 'POST' }).then((r) => handle<Note>(r)),
  listVersions: (id: number) => fetch(`/api/notes/${id}/versions`).then((r) => handle<NoteVersion[]>(r)),
  restoreVersion: (id: number, versionId: number) =>
    fetch(`/api/notes/${id}/versions/${versionId}/restore`, { method: 'POST' }).then((r) => handle<Note>(r)),
  getBacklinks: (id: number) => fetch(`/api/notes/${id}/backlinks`).then((r) => handle<{ links: Backlink[] }>(r)),
  getUnlinkedMentions: (id: number) =>
    fetch(`/api/notes/${id}/unlinked`).then((r) => handle<{ mentions: UnlinkedMention[] }>(r)),
  listTasks: (params?: { due?: string }) =>
    fetch(`/api/tasks${qs({ due: params?.due })}`).then((r) => handle<{ tasks: TaskItem[] }>(r)),
  getOutgoing: (id: number) => fetch(`/api/notes/${id}/outgoing`).then((r) => handle<{ links: OutgoingLink[] }>(r)),
  // v0.7 任务勾选回写 / 提及一键转链
  toggleTask: (noteId: number, lineIndex: number, checked: boolean, line: string) =>
    fetch(`/api/notes/${noteId}/task-toggle`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ lineIndex, checked, line }) }).then((r) => handle<{ note: Note }>(r)),
  linkifyMention: (noteId: number, title: string) =>
    fetch(`/api/notes/${noteId}/link-mention`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ title }) }).then((r) => handle<{ note: Note }>(r)),
  resolveTitle: (title: string) => fetch(`/api/resolve${qs({ title })}`).then((r) => handle<Note | null>(r)),

  // ---- 标签 / 回收站 / 统计 ----
  listTags: () => fetch('/api/tags').then((r) => handle<Tag[]>(r)),
  renameTag: (id: number, name: string) =>
    fetch(`/api/tags/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ name }) }).then((r) => handle<{ tag: Tag; merged: boolean }>(r)),
  deleteTag: (id: number) => fetch(`/api/tags/${id}`, { method: 'DELETE' }).then((r) => handle<{ ok: boolean }>(r)),
  emptyTrash: () => fetch('/api/trash', { method: 'DELETE' }).then((r) => handle<{ ok: boolean }>(r)),
  stats: () => fetch('/api/stats').then((r) => handle<Stats>(r)),

  // ---- 导入 / 导出 ----
  importNotes: (notes: { title?: string; content?: string; tags?: string[] }[]) =>
    fetch('/api/import', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ notes }) }).then((r) => handle<{ imported: number }>(r)),

  // ---- 全局搜索（FTS5） ----
  search: (params: { q: string; notebookId?: number; tagId?: number; limit?: number }) =>
    fetch(`/api/search${qs(params as Record<string, string | number | undefined>)}`).then((r) => handle<SearchResponse>(r)),

  // ---- 附件 ----
  uploadAttachment: async (file: File): Promise<UploadedAttachment> => {
    const buf = new Uint8Array(await file.arrayBuffer())
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < buf.length; i += chunk) {
      binary += String.fromCharCode(...buf.subarray(i, i + chunk))
    }
    const res = await fetch('/api/attachments', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: file.name, mime: file.type || 'application/octet-stream', data: btoa(binary) }),
    })
    return handle<UploadedAttachment>(res)
  },
  listAttachments: () => fetch('/api/attachments').then((r) => handle<Attachment[]>(r)),
  deleteAttachment: (id: number) => fetch(`/api/attachments/${id}`, { method: 'DELETE' }).then((r) => handle<{ ok: boolean }>(r)),
  cleanupAttachments: (force = false) =>
    fetch(`/api/attachments/cleanup${force ? '?force=1' : ''}`, { method: 'POST' }).then((r) => handle<{ removed: number; bytes: number }>(r)),

  // ---- 每日笔记 ----
  journalToday: () => fetch('/api/journal/today').then((r) => handle<{ date: string; note: Note }>(r)),
  journalOpen: (date: string) =>
    fetch(`/api/journal/${date}`, { method: 'POST', headers: JSON_HEADERS, body: '{}' }).then((r) => handle<{ date: string; note: Note }>(r)),
  journalMonth: (year: number, month: number) => fetch(`/api/journal/${year}/${month}`).then((r) => handle<JournalDay[]>(r)),
  calendarMonth: (year: number, month: number) => fetch(`/api/calendar/${year}/${month}`).then((r) => handle<CalendarMonth>(r)),
  getActivity: (days = 182) => fetch(`/api/activity?days=${days}`).then((r) => handle<{ days: number; activity: Record<string, number> }>(r)),

  // ---- 备份与设置 ----
  listBackups: () => fetch('/api/backups').then((r) => handle<BackupsResponse & { settings: AppSettings }>(r)),
  createBackup: () => fetch('/api/backups', { method: 'POST' }).then((r) => handle<BackupInfo>(r)),
  deleteBackup: (name: string) => fetch(`/api/backups/${encodeURIComponent(name)}`, { method: 'DELETE' }).then((r) => handle<{ ok: boolean }>(r)),
  restoreBackup: (name: string) =>
    fetch(`/api/backups/${encodeURIComponent(name)}/restore`, { method: 'POST' }).then((r) => handle<{ ok: boolean }>(r)),
  getSettings: () => fetch('/api/settings').then((r) => handle<AppSettings>(r)),
  updateSettings: (patch: Partial<AppSettings>) =>
    fetch('/api/settings', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) }).then((r) => handle<AppSettings>(r)),

  // ---- 图谱 ----
  graph: () => fetch('/api/graph').then((r) => handle<GraphData>(r)),
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function downloadJsonBackup() {
  const res = await fetch('/api/export')
  if (!res.ok) throw new Error(`导出失败（HTTP ${res.status}）`)
  const blob = await res.blob()
  downloadBlob(`jianzhi-backup-${new Date().toISOString().slice(0, 10)}.json`, blob)
}

// v0.3：全库导出 Markdown ZIP（按笔记本分目录 + 引用附件）
export async function downloadMarkdownZip() {
  const res = await fetch('/api/export/md')
  if (!res.ok) throw new Error(`导出失败（HTTP ${res.status}）`)
  const blob = await res.blob()
  downloadBlob(`jianzhi-md-${new Date().toISOString().slice(0, 10)}.zip`, blob)
}

export function exportNoteAsMarkdown(note: Note) {
  const safeName = (note.title || '无标题').replace(/[\\/:*?"<>|]/g, '_')
  downloadBlob(`${safeName}.md`, new Blob([note.content], { type: 'text/markdown;charset=utf-8' }))
}

// v0.8 单篇导出独立 HTML（内联样式，可直接打开/打印）
const HTML_CSS = `
  body { max-width: 760px; margin: 32px auto; padding: 0 20px; font-family: -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; color: #1f2329; line-height: 1.8; }
  h1 { border-bottom: 1px solid #e4e7ec; padding-bottom: .3em; }
  code { background: #f1f3f5; border-radius: 4px; padding: 2px 5px; font-size: .88em; font-family: Consolas, monospace; }
  pre { background: #f1f3f5; border: 1px solid #e4e7ec; border-radius: 8px; padding: 12px 14px; overflow-x: auto; }
  pre code { background: transparent; padding: 0; }
  blockquote { margin: .8em 0; padding: 4px 14px; border-left: 3px solid #4c6ef5; background: #edf2ff; color: #5f6672; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #e4e7ec; padding: 6px 10px; text-align: left; }
  th { background: #f1f3f6; }
  img { max-width: 100%; border-radius: 8px; }
  a { color: #4c6ef5; }
  .wikilink { color: #4c6ef5; border-bottom: 1px dashed #4c6ef5; text-decoration: none; }
  @media print { body { margin: 0; } }
`

export function exportNoteAsHtml(note: Note) {
  const body = renderMarkdown(note.content)
  const title = (note.title || '无标题')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title><style>${HTML_CSS}</style></head><body><article>${body}</article></body></html>`
  const safeName = (note.title || '无标题').replace(/[\\/:*?"<>|]/g, '_')
  downloadBlob(`${safeName}.html`, new Blob([html], { type: 'text/html;charset=utf-8' }))
}
