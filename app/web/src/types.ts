export interface Notebook {
  id: number
  name: string
  icon: string
  parent_id: number | null
  sort_order: number
  note_count: number
  created_at: string
  updated_at: string
}

export interface Tag {
  id: number
  name: string
  note_count: number
}

export interface TagRef {
  id: number
  name: string
}

export interface Note {
  id: number
  notebook_id: number | null
  title: string
  content: string
  pinned: 0 | 1
  starred: 0 | 1
  search_text?: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  tags?: TagRef[]
}

export interface NoteVersion {
  id: number
  note_id: number
  title: string
  content: string
  created_at: string
}

export interface Backlink {
  id: number
  title: string
  updated_at: string
  /** 首条包含 [[标题]] 的源码行（截 100 字） */
  context?: string | null
  /** 命中行 ±3 行窗口（v0.5，展开显示） */
  contextFull?: string | null
}

/** v0.6 未链接提及 */
export interface UnlinkedMention {
  id: number
  title: string
  updated_at: string
  context?: string | null
}

/** v0.8 出链 */
export interface OutgoingLink {
  title: string
  alias: string | null
  id: number | null
}

/** v0.6 全库任务条目（v0.8 日期 / v1.0 优先级） */
export interface TaskItem {
  noteId: number
  noteTitle: string
  checked: boolean
  text: string
  line: string
  lineIndex: number
  due?: string | null
  priority?: number
}

/** v1.0 日历月聚合 */
export interface CalendarMonth {
  journalDates: string[]
  taskDue: Record<string, number>
}

export interface Stats {
  total: number
  starred: number
  trash: number
  notebooks: number
  tags: number
  words: number
  attachments: { count: number; bytes: number }
}

export type ViewKind = 'all' | 'starred' | 'trash' | 'notebook' | 'tag'

export interface View {
  kind: ViewKind
  notebookId?: number
  tagId?: number
}

export type EditorMode = 'edit' | 'split' | 'preview'
export type SortKey = 'updated' | 'created' | 'title'

/** v0.8 多标签页（v0.9 增加固定） */
export interface NoteTab {
  id: number
  title: string
  pinned?: boolean
}

// ---------- v0.2 新增类型 ----------

export interface SearchResult {
  id: number
  title: string
  notebook_id: number | null
  updated_at: string
  deleted_at: string | null
  /** FTS 片段，\u0001/\u0002 为高亮起止标记；LIKE 回退时为 null */
  snippet: string | null
}

export interface SearchResponse {
  mode: 'fts' | 'like' | 'empty'
  total: number
  results: SearchResult[]
}

export interface Attachment {
  id: number
  file_name: string
  orig_name: string
  mime: string
  size: number
  created_at: string
  used_by: number
}

export interface UploadedAttachment {
  id: number
  file_name: string
  url: string
  inline: boolean
}

export interface JournalDay {
  id: number
  title: string
  journal_date: string
  updated_at: string
}

export interface BackupInfo {
  name: string
  size: number
  created_at: string
}

export interface AppSettings {
  backupEnabled: boolean
  backupIntervalHours: number
  backupKeep: number
  backupLastAt: string | null
}

export interface BackupsResponse {
  backups: BackupInfo[]
  settings: AppSettings
  dir: string
}

export interface GraphNode {
  id: number
  title: string
  notebook_id: number | null
  degree: number
}

export interface GraphData {
  nodes: GraphNode[]
  edges: { s: number; t: number }[]
}
