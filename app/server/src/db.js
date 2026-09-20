// 简知 · 数据层（SQLite / better-sqlite3）
// 所有 SQL 集中在本文件，路由层只调用这里的函数，便于将来替换存储实现。
// v0.2：FTS5 全文搜索、附件引用、每日笔记、定时备份、设置存储、关系图谱。
import Database from 'better-sqlite3'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildZip } from './zip.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data')
export const filesDir = path.join(dataDir, 'files')
export const backupDir = path.join(dataDir, 'backups')
const dbPath = path.join(dataDir, 'jianzhi.db')
fs.mkdirSync(dataDir, { recursive: true })

function openDb() {
  const d = new Database(dbPath)
  d.pragma('journal_mode = WAL')
  d.pragma('foreign_keys = ON')
  return d
}

// 恢复备份需要关库重开；v0.1 起所有 prepare 均按调用创建，重开后无需失效任何缓存。
export let db = openDb()

/** 关闭当前数据库并重新打开。 */
export function reopen() {
  try { db.close() } catch { /* 已关闭则忽略 */ }
  db = openDb()
}

// ---------- 建表 / 迁移 ----------

const DDL = [
  `CREATE TABLE IF NOT EXISTS notebooks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    icon        TEXT NOT NULL DEFAULT '📁',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS notes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    notebook_id  INTEGER REFERENCES notebooks(id) ON DELETE SET NULL,
    title        TEXT NOT NULL DEFAULT '无标题',
    content      TEXT NOT NULL DEFAULT '',
    pinned       INTEGER NOT NULL DEFAULT 0,
    starred      INTEGER NOT NULL DEFAULT 0,
    search_text  TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT,
    journal_date TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  )`,
  `CREATE TABLE IF NOT EXISTS note_tags (
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
  )`,
  `CREATE TABLE IF NOT EXISTS versions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id    INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS attachments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name  TEXT NOT NULL UNIQUE,
    orig_name  TEXT NOT NULL,
    mime       TEXT NOT NULL DEFAULT 'application/octet-stream',
    size       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS note_files (
    note_id   INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL REFERENCES attachments(file_name) ON DELETE CASCADE,
    PRIMARY KEY (note_id, file_name)
  )`,
]
for (const sql of DDL) db.prepare(sql).run()

// 旧库补列（v0.1 的库没有 journal_date；v0.1/v0.2 的库没有 notebooks.parent_id；必须在建索引之前执行）
const hasJournalDate = db.prepare(`SELECT COUNT(*) c FROM pragma_table_info('notes') WHERE name = 'journal_date'`).get().c
if (!hasJournalDate) db.prepare('ALTER TABLE notes ADD COLUMN journal_date TEXT').run()
const hasParentId = db.prepare(`SELECT COUNT(*) c FROM pragma_table_info('notebooks') WHERE name = 'parent_id'`).get().c
if (!hasParentId) db.prepare('ALTER TABLE notebooks ADD COLUMN parent_id INTEGER REFERENCES notebooks(id) ON DELETE SET NULL').run()

const INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_notes_notebook ON notes(notebook_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notes_deleted  ON notes(deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_notes_journal  ON notes(journal_date)`,
  `CREATE INDEX IF NOT EXISTS idx_versions_note  ON versions(note_id)`,
]
for (const sql of INDEXES) db.prepare(sql).run()

// FTS5 外部内容表：trigram 分词，中文无需分词即可子串检索；触发器保持同步
const FTS_DDL = [
  `CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
     title, content, content='notes', content_rowid='id', tokenize='trigram'
   )`,
  `CREATE TRIGGER IF NOT EXISTS notes_fts_ai AFTER INSERT ON notes BEGIN
     INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
   END`,
  `CREATE TRIGGER IF NOT EXISTS notes_fts_ad AFTER DELETE ON notes BEGIN
     INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
   END`,
  `CREATE TRIGGER IF NOT EXISTS notes_fts_au AFTER UPDATE ON notes BEGIN
     INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
     INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
   END`,
]
for (const sql of FTS_DDL) db.prepare(sql).run()

const getSetting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null
const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value))

// 首次建 FTS 或检测到索引与笔记条数不一致时重建（幂等）
const ftsCount = db.prepare('SELECT COUNT(*) c FROM notes_fts').get().c
const noteCount = db.prepare('SELECT COUNT(*) c FROM notes').get().c
if (getSetting('fts_ready') !== '2' || ftsCount !== noteCount) {
  db.prepare(`INSERT INTO notes_fts(notes_fts) VALUES ('rebuild')`).run()
  setSetting('fts_ready', '2')
}

const MAX_VERSIONS = 20
const now = () => new Date().toISOString()
const searchOf = (title, content) => `${title}\n${content}`.toLowerCase()
const num = (v) => Number(v)

// ---------- 设置 ----------

function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt
}

export function getSettings() {
  return {
    backupEnabled: getSetting('backup_enabled') !== '0',
    backupIntervalHours: clampInt(getSetting('backup_interval_hours'), 1, 168, 24),
    backupKeep: clampInt(getSetting('backup_keep'), 1, 90, 14),
    backupLastAt: getSetting('backup_last_at') || null,
  }
}

export function updateSettings(patch = {}) {
  if (patch.backupEnabled !== undefined) setSetting('backup_enabled', patch.backupEnabled ? '1' : '0')
  if (patch.backupIntervalHours !== undefined) setSetting('backup_interval_hours', clampInt(patch.backupIntervalHours, 1, 168, 24))
  if (patch.backupKeep !== undefined) setSetting('backup_keep', clampInt(patch.backupKeep, 1, 90, 14))
  return getSettings()
}

// ---------- 笔记本 ----------

export function listNotebooks() {
  return db.prepare(`
    SELECT n.*,
      (SELECT COUNT(*) FROM notes WHERE notebook_id = n.id AND deleted_at IS NULL) AS note_count
    FROM notebooks n
    ORDER BY n.sort_order, n.id
  `).all()
}

export function getNotebook(id) {
  return db.prepare('SELECT * FROM notebooks WHERE id = ?').get(id) ?? null
}

export function createNotebook({ name, icon, parentId = null } = {}) {
  const t = now()
  if (parentId !== null && parentId !== undefined) {
    const pid = Number(parentId)
    if (!Number.isFinite(pid) || !getNotebook(pid)) {
      const e = new Error('父笔记本不存在')
      e.status = 400
      throw e
    }
  }
  const info = db.prepare('INSERT INTO notebooks (name, icon, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(String(name), icon ? String(icon) : '📁', parentId != null ? Number(parentId) : null, t, t)
  return getNotebook(num(info.lastInsertRowid))
}

export function updateNotebook(id, { name, icon } = {}) {
  const cur = getNotebook(id)
  if (!cur) return null
  db.prepare('UPDATE notebooks SET name = ?, icon = ?, updated_at = ? WHERE id = ?')
    .run(
      name !== undefined ? (String(name).trim() || cur.name) : cur.name,
      icon !== undefined ? String(icon) : cur.icon,
      now(), id,
    )
  return getNotebook(id)
}

// 移动笔记本（v0.3 层级树 / v0.4 兄弟排序）：parentId=null 提升为顶级。
// position 为目标父级下兄弟序列的插入下标（越界收敛到边界）；整组按步长 10 重编号，避免中点碰撞。
// 返回：笔记本 | { error } | null(不存在)
export function moveNotebook(id, parentId, position) {
  const nb = getNotebook(id)
  if (!nb) return null

  let pid = null
  if (parentId !== null && parentId !== undefined && parentId !== '') {
    pid = Number(parentId)
    if (!Number.isFinite(pid)) return { error: 'parentId 无效' }
    if (pid === id) return { error: '不能将笔记本移动到它自己' }
    const parent = getNotebook(pid)
    if (!parent) return { error: '目标笔记本不存在' }
    const seen = new Set([id])
    let cur = parent
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      cur = cur.parent_id ? getNotebook(cur.parent_id) : null
    }
    if (cur) return { error: '不能将笔记本移动到它自己的子级' }
  }

  let pos = Number(position)
  if (position !== undefined && !Number.isFinite(pos)) return { error: 'position 无效' }
  if (position === undefined || position === null) pos = Number.MAX_SAFE_INTEGER

  // 兄弟序列（排除自己）→ 插入 → 整组重编号
  const siblings = db.prepare(
    `SELECT id FROM notebooks WHERE id != ? AND ${pid === null ? 'parent_id IS NULL' : 'parent_id = ?'} ORDER BY sort_order, id`
  ).all(...(pid === null ? [id] : [id, pid]))
  const order = siblings.map((r) => r.id)
  pos = Math.max(0, Math.min(order.length, pos))
  order.splice(pos, 0, id)

  db.transaction(() => {
    for (let i = 0; i < order.length; i++) {
      db.prepare('UPDATE notebooks SET parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?')
        .run(pid, (i + 1) * 10, now(), order[i])
    }
  })()
  return getNotebook(id)
}

// 子树 id 集合（含自身），列表按笔记本过滤时聚合显示整个子树的笔记
export function notebookSubtreeIds(id) {
  return db.prepare(`
    WITH RECURSIVE subtree(id) AS (
      SELECT ? UNION ALL SELECT n.id FROM notebooks n JOIN subtree s ON n.parent_id = s.id
    )
    SELECT id FROM subtree
  `).all(Number(id)).map((r) => r.id)
}

export function deleteNotebook(id) {
  const info = db.prepare('DELETE FROM notebooks WHERE id = ?').run(id)
  return info.changes > 0
}

// ---------- 笔记检索 ----------

// 公共过滤片段：标签 / 可见性（笔记本过滤由调用方按子树展开，占位符顺序 = tagId, 子树id..., 查询词）
function listWhere({ tagId, status = 'active' }) {
  let join = ''
  const where = []
  if (tagId !== undefined && tagId !== null && Number.isFinite(Number(tagId))) {
    join = ' JOIN note_tags nt ON nt.note_id = n.id'
    where.push('nt.tag_id = ?')
  }
  if (status === 'active') where.push('n.deleted_at IS NULL')
  else if (status === 'trash') where.push('n.deleted_at IS NOT NULL')
  else if (status === 'starred') where.push('n.starred = 1', 'n.deleted_at IS NULL')
  return { join, where }
}
function filterParams({ tagId }) {
  const params = []
  if (tagId !== undefined && tagId !== null && Number.isFinite(Number(tagId))) params.push(Number(tagId))
  return params
}
// 笔记本过滤 → 子树 id 集合（v0.3 层级树；无有效 notebookId 时返回 null）
function notebookFilterIds(notebookId) {
  if (notebookId === undefined || notebookId === null || !Number.isFinite(Number(notebookId))) return null
  return notebookSubtreeIds(Number(notebookId))
}

// trigram 分词要求查询词 ≥ 3 字符（含单字/双字中文）；不足时回退 LIKE
export function ftsUsable(q) {
  const terms = String(q ?? '').trim().split(/\s+/).filter(Boolean)
  return terms.length > 0 && terms.every((t) => [...t].length >= 3)
}
function ftsMatchExpr(q) {
  return String(q).trim().split(/\s+/).filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(' AND ')
}

// 全量列表检索（列表页 q 筛选）：可用 FTS 时走全文索引，否则 LIKE
export function listNotes({ notebookId, tagId, q, status = 'active', sort = 'updated' } = {}) {
  const { join, where } = listWhere({ tagId, status })
  const params = filterParams({ tagId })
  const nbIds = notebookFilterIds(notebookId)
  if (nbIds) {
    where.push(`n.notebook_id IN (${nbIds.map(() => '?').join(',')})`)
    params.push(...nbIds)
  }

  const query = q !== undefined ? String(q).trim() : ''
  let sql = `SELECT n.* FROM notes n${join}`
  if (query) {
    if (ftsUsable(query)) {
      where.push('n.id IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?)')
      params.push(ftsMatchExpr(query))
    } else {
      where.push('n.search_text LIKE ?')
      params.push(`%${query.toLowerCase()}%`)
    }
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ')
  if (status === 'trash') {
    sql += ' ORDER BY n.deleted_at DESC'
  } else if (sort === 'created') {
    sql += ' ORDER BY n.pinned DESC, n.created_at DESC'
  } else if (sort === 'title') {
    sql += ' ORDER BY n.pinned DESC, n.title COLLATE NOCASE ASC'
  } else {
    sql += ' ORDER BY n.pinned DESC, n.updated_at DESC'
  }
  return db.prepare(sql).all(...params)
}

// 全局搜索（Ctrl+K）：FTS 相关度排序（标题权重 10:1）+ 上下文片段（\x01..\x02 高亮标记）
export function searchNotes({ q, notebookId, tagId, status = 'active', limit = 50 } = {}) {
  const query = String(q ?? '').trim()
  if (!query) return { mode: 'empty', total: 0, results: [] }
  const { join, where } = listWhere({ tagId, status })
  const params = filterParams({ tagId })
  const nbIds = notebookFilterIds(notebookId)
  if (nbIds) {
    where.push(`n.notebook_id IN (${nbIds.map(() => '?').join(',')})`)
    params.push(...nbIds)
  }

  if (!ftsUsable(query)) {
    where.push('n.search_text LIKE ?')
    params.push(`%${query.toLowerCase()}%`)
    const sql = `SELECT n.id, n.title, n.notebook_id, n.updated_at, n.deleted_at, NULL AS snippet
      FROM notes n${join}
      WHERE ${where.join(' AND ')}`
    const rows = db.prepare(sql + ' ORDER BY n.updated_at DESC LIMIT ?').all(...params, limit)
    return { mode: 'like', total: rows.length, results: rows }
  }

  where.push('notes_fts MATCH ?')
  params.push(ftsMatchExpr(query))
  const sql = `
    SELECT n.id, n.title, n.notebook_id, n.updated_at, n.deleted_at,
      bm25(notes_fts, 10.0, 1.0) AS score,
      snippet(notes_fts, 1, char(1), char(2), '…', 14) AS snippet
    FROM notes_fts
    JOIN notes n ON n.id = notes_fts.rowid
    ${join}
    WHERE ${where.join(' AND ')}`
  const rows = db.prepare(sql + ' ORDER BY score LIMIT ?').all(...params, limit)
  return { mode: 'fts', total: rows.length, results: rows }
}

export function getNote(id) {
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(id)
  if (!note) return null
  note.tags = db.prepare(`
    SELECT t.id, t.name FROM tags t
    JOIN note_tags nt ON nt.tag_id = t.id
    WHERE nt.note_id = ?
    ORDER BY t.name
  `).all(id)
  return note
}

// 随机漫游：随机取一篇活跃笔记（v0.5）
export function getRandomNote() {
  const row = db.prepare('SELECT id FROM notes WHERE deleted_at IS NULL ORDER BY RANDOM() LIMIT 1').get()
  return row ? getNote(row.id) : null
}

// 任务勾选回写源笔记（v0.7）：校验目标行未漂移后翻转 [ ]↔[x]，走 updateNote 生成版本快照
// 返回：{ note } | { error } | null(笔记不存在)
export function toggleNoteTask(noteId, lineIndex, checked, lineText) {
  const note = db.prepare('SELECT content FROM notes WHERE id = ?').get(Number(noteId))
  if (!note) return null
  const lines = String(note.content ?? '').split('\n')
  const i = Number(lineIndex)
  if (!Number.isInteger(i) || i < 0 || i >= lines.length) return { error: '行号无效' }
  const m = lines[i].match(TASK_LINE_RE)
  if (!m) return { error: '该行不是任务行' }
  if (lineText !== undefined && String(lineText).trim() !== lines[i].trim()) {
    return { error: '笔记内容已变化，请刷新后重试' }
  }
  lines[i] = lines[i].replace(/\[( |x|X)\]/, checked ? '[x]' : '[ ]')
  return { note: updateNote(Number(noteId), { content: lines.join('\n') }) }
}

// 提及一键转链（v0.7）：在首个非代码块行把裸标题替换为 [[标题]]
// 返回：{ note } | { error } | null(笔记不存在)
export function linkifyMention(noteId, title) {
  const note = db.prepare('SELECT content FROM notes WHERE id = ?').get(Number(noteId))
  if (!note) return null
  const t = String(title ?? '').trim()
  if (!t) return { error: '缺少标题' }
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const bare = new RegExp(`(?<!\\[)${esc}(?!\\])`)
  const lines = String(note.content ?? '').split('\n')
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (bare.test(lines[i])) {
      lines[i] = lines[i].replace(bare, `[[${t}]]`)
      return { note: updateNote(Number(noteId), { content: lines.join('\n') }) }
    }
  }
  return { error: '未找到可转换的提及' }
}

// 标题允许为空字符串：前端会从正文首行派生标题，列表侧用「无标题」兜底显示
export function createNote({ notebookId = null, title, content = '', tags = [], pinned = 0, starred = 0, journalDate = null } = {}) {
  const t = now()
  const finalTitle = (title !== undefined && String(title).trim())
    ? String(title).trim().slice(0, 200)
    : ''
  const info = db.prepare(`
    INSERT INTO notes (notebook_id, title, content, pinned, starred, search_text, created_at, updated_at, journal_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(notebookId === null ? null : Number(notebookId), finalTitle, String(content),
    pinned ? 1 : 0, starred ? 1 : 0, searchOf(finalTitle, content), t, t,
    journalDate ? String(journalDate) : null)
  const id = num(info.lastInsertRowid)
  if (Array.isArray(tags) && tags.length) setNoteTags(id, tags)
  syncNoteFiles(id, String(content))
  return getNote(id)
}

function saveVersionSnapshot(note) {
  db.prepare('INSERT INTO versions (note_id, title, content, created_at) VALUES (?, ?, ?, ?)')
    .run(note.id, note.title, note.content, now())
  // 只保留最近 MAX_VERSIONS 个版本
  const stale = db.prepare('SELECT id FROM versions WHERE note_id = ? ORDER BY id DESC LIMIT -1 OFFSET ?')
    .all(note.id, MAX_VERSIONS)
  const del = db.prepare('DELETE FROM versions WHERE id = ?')
  for (const row of stale) del.run(row.id)
}

export function updateNote(id, patch = {}) {
  const cur = db.prepare('SELECT * FROM notes WHERE id = ?').get(id)
  if (!cur) return null
  const next = {
    title: patch.title !== undefined ? String(patch.title).trim().slice(0, 200) : cur.title,
    content: patch.content !== undefined ? String(patch.content) : cur.content,
    notebook_id: patch.notebookId !== undefined
      ? (patch.notebookId === null ? null : Number(patch.notebookId))
      : cur.notebook_id,
    pinned: patch.pinned !== undefined ? (patch.pinned ? 1 : 0) : cur.pinned,
    starred: patch.starred !== undefined ? (patch.starred ? 1 : 0) : cur.starred,
  }
  // 标题或内容变化时保存历史版本
  if (next.title !== cur.title || next.content !== cur.content) saveVersionSnapshot(cur)
  db.prepare(`
    UPDATE notes SET title = ?, content = ?, notebook_id = ?, pinned = ?, starred = ?, search_text = ?, updated_at = ?
    WHERE id = ?
  `).run(next.title, next.content, next.notebook_id, next.pinned, next.starred, searchOf(next.title, next.content), now(), id)
  if (patch.content !== undefined) syncNoteFiles(id, next.content)
  return getNote(id)
}

export function setNoteTags(noteId, names = []) {
  if (!getNote(noteId)) return null
  const clean = [...new Set(names.map((s) => String(s).trim()).filter(Boolean))].slice(0, 20)
  const findTag = db.prepare('SELECT id FROM tags WHERE name = ?')
  const insertTag = db.prepare('INSERT INTO tags (name) VALUES (?)')
  const link = db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)')
  const unlinkAll = db.prepare('DELETE FROM note_tags WHERE note_id = ?')
  db.transaction(() => {
    unlinkAll.run(noteId)
    for (const name of clean) {
      let tag = findTag.get(name)
      if (!tag) tag = { id: num(insertTag.run(name).lastInsertRowid) }
      link.run(noteId, tag.id)
    }
  })()
  return getNote(noteId)
}

export function softDeleteNote(id) {
  db.prepare('UPDATE notes SET deleted_at = ? WHERE id = ?').run(now(), id)
}

export function restoreNote(id) {
  db.prepare('UPDATE notes SET deleted_at = NULL WHERE id = ?').run(id)
}

export function purgeNote(id) {
  db.prepare('DELETE FROM notes WHERE id = ?').run(id)
}

export function emptyTrash() {
  db.prepare('DELETE FROM notes WHERE deleted_at IS NOT NULL').run()
}

export function listVersions(noteId) {
  return db.prepare('SELECT id, note_id, title, content, created_at FROM versions WHERE note_id = ? ORDER BY id DESC')
    .all(noteId)
}

export function restoreVersion(noteId, versionId) {
  const v = db.prepare('SELECT * FROM versions WHERE id = ? AND note_id = ?').get(versionId, noteId)
  if (!v) return null
  return updateNote(noteId, { title: v.title, content: v.content })
}

// 反向链接：其他笔记正文中出现 [[本笔记标题]]；附带首条命中行上下文（单行 + ±3 行窗口）
export function listBacklinks(noteId) {
  const note = db.prepare('SELECT title FROM notes WHERE id = ?').get(noteId)
  if (!note) return []
  const needle = `%[[${note.title.toLowerCase()}]]%`
  const rows = db.prepare(`
    SELECT id, title, content, updated_at FROM notes
    WHERE deleted_at IS NULL AND id != ? AND search_text LIKE ?
    ORDER BY updated_at DESC LIMIT 50
  `).all(noteId, needle)
  const esc = note.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const hit = new RegExp(`\\[\\[${esc}(?:\\|[^\\[\\]]*)?\\]\\]`, 'i')
  return rows.map((r) => {
    const lines = String(r.content ?? '').split('\n')
    let hitIdx = -1
    let context = null
    for (let i = 0; i < lines.length; i++) {
      if (hit.test(lines[i])) {
        hitIdx = i
        context = lines[i].trim().replace(/^#{1,6}\s*/, '').slice(0, 100)
        break
      }
    }
    // ±3 行窗口：剔除首尾空行，内部空行保留为段落分隔
    let contextFull = null
    if (hitIdx >= 0) {
      const windowLines = lines.slice(Math.max(0, hitIdx - 3), hitIdx + 4)
      while (windowLines.length && !windowLines[0].trim()) windowLines.shift()
      while (windowLines.length && !windowLines[windowLines.length - 1].trim()) windowLines.pop()
      contextFull = windowLines.join('\n').slice(0, 600)
    }
    return { id: r.id, title: r.title, updated_at: r.updated_at, context, contextFull }
  })
}

// 未链接提及（v0.6/v0.7）：正文包含标题但未用 [[ ]] 引用的其他活跃笔记
// v0.7：跳过围栏代码块（``` /~~~）与行内代码 `...` 中的提及
export function listUnlinkedMentions(noteId) {
  const note = db.prepare('SELECT title FROM notes WHERE id = ?').get(noteId)
  if (!note || !note.title.trim()) return []
  const needle = `%${note.title.toLowerCase()}%`
  const rows = db.prepare(`
    SELECT id, title, content, updated_at FROM notes
    WHERE deleted_at IS NULL AND id != ? AND search_text LIKE ?
    ORDER BY updated_at DESC LIMIT 200
  `).all(noteId, needle)
  const esc = note.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const linked = new RegExp(`\\[\\[${esc}(?:\\|[^\\[\\]]*)?\\]\\]`, 'i')
  const bare = new RegExp(`(?<!\\[)${esc}(?!\\])`, 'i')
  const out = []
  for (const r of rows) {
    if (linked.test(r.content)) continue
    const lines = String(r.content ?? '').split('\n')
    let inFence = false
    for (const line of lines) {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence
        continue
      }
      if (inFence) continue
      const stripped = line.replace(/`[^`]*`/g, '') // 去行内代码
      if (bare.test(stripped)) {
        out.push({
          id: r.id,
          title: r.title,
          updated_at: r.updated_at,
          context: line.trim().replace(/^#{1,6}\s*/, '').slice(0, 100),
        })
        break
      }
    }
  }
  return out.slice(0, 50)
}

// ---------- 全库任务聚合（v0.6） ----------

const TASK_LINE_RE = /^\s*(?:[-*+]|\d+\.)\s+\[( |x|X)\]\s+(.*)$/
const TASK_DUE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/
// v1.1 多档优先级（对齐 Obsidian Tasks）：🔺3 / ⏫2 / 🔼1 / 无 0 / ⏬-1；⭐ 为 v1.0 旧约定，兼容映射为 1
const TASK_PRIORITY_RE = /(🔺|⏫|🔼|⏬|⭐)/

function parseTaskPriority(text) {
  const m = text.match(TASK_PRIORITY_RE)
  if (!m) return 0
  return { '🔺': 3, '⏫': 2, '🔼': 1, '⭐': 1, '⏬': -1 }[m[1]] ?? 0
}

export function listAllTasks() {
  const notes = db.prepare(`
    SELECT id, title, content FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC
  `).all()
  const tasks = []
  for (const n of notes) {
    const lines = String(n.content ?? '').split('\n')
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(TASK_LINE_RE)
      if (!m) continue
      tasks.push({
        noteId: n.id,
        noteTitle: n.title || '无标题',
        checked: m[1].toLowerCase() === 'x',
        text: m[2].trim().slice(0, 120),
        line: lines[i].trim(),
        lineIndex: i,
        due: m[2].match(TASK_DUE_RE)?.[1] ?? null,
        priority: parseTaskPriority(m[2]),
      })
      if (tasks.length >= 500) return tasks
    }
  }
  return tasks
}

// 按任务内 ⭐ 优先排序（同段内：⭐ 前、due 升序）
export function sortTasksByPriority(tasks) {
  return [...tasks].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.due ?? '9999').localeCompare(b.due ?? '9999'))
}

// v1.0 日历月聚合：日记日期 + 任务到期分布
export function getCalendarMonth(year, month) {
  const y = Number(year)
  const m = Number(month)
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12 || y < 1970 || y > 2999) return null
  const prefix = `${y}-${String(m).padStart(2, '0')}-`
  const journalDates = db.prepare(`
    SELECT DISTINCT journal_date FROM notes
    WHERE journal_date LIKE ? AND deleted_at IS NULL
  `).all(`${prefix}%`).map((r) => r.journal_date)
  const taskDue = {}
  for (const t of listAllTasks()) {
    if (!t.due || !t.due.startsWith(prefix)) continue
    taskDue[t.due] = (taskDue[t.due] ?? 0) + 1
  }
  return { journalDates, taskDue }
}

// v1.1 编辑活动热力图：近 N 天按日聚合（笔记更新 + 版本快照双信号）
export function getActivity(days = 182) {
  const d = Math.min(366, Math.max(30, Number(days) || 182))
  const rows = db.prepare(`
    SELECT day, COUNT(*) AS c FROM (
      SELECT substr(updated_at, 1, 10) AS day FROM notes WHERE deleted_at IS NULL AND updated_at >= datetime('now', '-' || ? || ' days')
      UNION ALL
      SELECT substr(v.created_at, 1, 10) AS day FROM versions v
      JOIN notes n ON n.id = v.note_id
      WHERE n.deleted_at IS NULL AND v.created_at >= datetime('now', '-' || ? || ' days')
    ) GROUP BY day
  `).all(d, d)
  return { days: d, activity: Object.fromEntries(rows.map((r) => [r.day, r.c])) }
}

// 出链（v0.8）：本笔记 [[标题|别名]] 的解析结果（去重保序，未解析 id=null）
export function listOutgoingLinks(noteId) {
  const note = db.prepare('SELECT content FROM notes WHERE id = ?').get(Number(noteId))
  if (!note) return null
  const seen = new Set()
  const out = []
  for (const m of String(note.content ?? '').matchAll(WIKI_LINK_RE)) {
    const title = m[1].trim()
    const key = title.toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    const alias = (m[2] ?? '').trim()
    const hit = findNoteByTitle(title)
    out.push({ title, alias: alias || null, id: hit ? hit.id : null })
  }
  return out
}

// ---------- 标签 ----------

export function listTags() {
  return db.prepare(`
    SELECT t.id, t.name,
      (SELECT COUNT(*) FROM note_tags nt JOIN notes n ON n.id = nt.note_id
       WHERE nt.tag_id = t.id AND n.deleted_at IS NULL) AS note_count
    FROM tags t
    ORDER BY note_count DESC, t.name ASC
  `).all()
}

// 重命名标签（v0.6）：目标名已存在时合并（引用并入目标标签，删除源标签）
// 返回：{ tag } | { error } | null(不存在)
export function renameTag(id, name) {
  const cur = db.prepare('SELECT * FROM tags WHERE id = ?').get(Number(id))
  if (!cur) return null
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return { error: '标签名不能为空' }
  if ([...trimmed].length > 40) return { error: '标签名过长（最多 40 字）' }
  const clean = trimmed.slice(0, 40)
  const other = db.prepare('SELECT id FROM tags WHERE name = ? AND id != ?').get(clean, cur.id)
  if (other) {
    db.transaction(() => {
      db.prepare('UPDATE OR IGNORE note_tags SET tag_id = ? WHERE tag_id = ?').run(other.id, cur.id)
      db.prepare('DELETE FROM note_tags WHERE tag_id = ?').run(cur.id)
      db.prepare('DELETE FROM tags WHERE id = ?').run(cur.id)
    })()
    return { tag: db.prepare('SELECT * FROM tags WHERE id = ?').get(other.id), merged: true }
  }
  db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(clean, cur.id)
  return { tag: db.prepare('SELECT * FROM tags WHERE id = ?').get(cur.id), merged: false }
}

export function deleteTag(id) {
  const info = db.prepare('DELETE FROM tags WHERE id = ?').run(Number(id))
  return info.changes > 0
}

// ---------- 附件 ----------

const INLINE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'])

export function getAttachmentByPath(fileName) {
  return db.prepare('SELECT * FROM attachments WHERE file_name = ?').get(fileName) ?? null
}

export function getAttachmentById(id) {
  return db.prepare('SELECT * FROM attachments WHERE id = ?').get(Number(id)) ?? null
}

// 删除单个附件：仍被引用时返回 error，不删除
export function deleteAttachment(id) {
  const att = getAttachmentById(id)
  if (!att) return null
  const used = db.prepare('SELECT COUNT(*) c FROM note_files WHERE file_name = ?').get(att.file_name).c
  if (used > 0) return { error: '该附件仍被笔记引用，请先移除引用或使用「清理孤儿附件」' }
  fs.rmSync(path.join(filesDir, att.file_name), { force: true })
  db.prepare('DELETE FROM attachments WHERE id = ?').run(att.id)
  return { ok: true }
}

function sanitizeFileName(name) {
  let base = String(name ?? 'file').split(/[\\/]/).pop() || 'file'
  base = base.replace(/[\u0000-\u001f<>:"|?*\s]+/g, '_').replace(/^\.+/, '_').slice(-100)
  if (!base || base === '_') base = 'file'
  return base
}

export function createAttachment({ buf, origName, mime }) {
  const safeBase = sanitizeFileName(origName)
  const ym = new Date().toISOString().slice(0, 7).replace('-', '')
  fs.mkdirSync(path.join(filesDir, ym), { recursive: true })
  let fileName = ''
  for (let i = 0; i < 5 && !fileName; i++) {
    const candidate = `${ym}/${crypto.randomBytes(5).toString('hex')}-${safeBase}`
    if (!getAttachmentByPath(candidate)) fileName = candidate
  }
  if (!fileName) {
    const e = new Error('附件写入失败，请重试')
    e.status = 500
    throw e
  }
  fs.writeFileSync(path.join(filesDir, fileName), buf)
  const info = db.prepare(
    'INSERT INTO attachments (file_name, orig_name, mime, size, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(fileName, safeBase, mime || 'application/octet-stream', buf.length, now())
  return {
    id: num(info.lastInsertRowid),
    file_name: fileName,
    url: `/files/${fileName}`,
    inline: INLINE_MIME.has(mime),
  }
}

// 同步笔记内容中的 /files/ 引用到 note_files 表（供孤儿清理与统计使用）
// 文件名可能含中文等任意 Unicode 字符，捕获到空白/括号/引号为止，再裁掉句尾标点
const FILE_REF_RE = /\/files\/([^\s)\]>"'`\\]+)/g
export function syncNoteFiles(noteId, content) {
  const refs = new Set()
  for (const m of String(content ?? '').matchAll(FILE_REF_RE)) {
    const name = m[1].replace(/[.,;:!?)。，；：！？、」』]+$/, '')
    if (name && !name.includes('..') && getAttachmentByPath(name)) refs.add(name)
  }
  const del = db.prepare('DELETE FROM note_files WHERE note_id = ?')
  const ins = db.prepare('INSERT OR IGNORE INTO note_files (note_id, file_name) VALUES (?, ?)')
  db.transaction(() => {
    del.run(noteId)
    for (const name of refs) ins.run(noteId, name)
  })()
}

export function listAttachments() {
  return db.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM note_files nf JOIN notes n ON n.id = nf.note_id
       WHERE nf.file_name = a.file_name AND n.deleted_at IS NULL) AS used_by
    FROM attachments a
    ORDER BY a.id DESC
    LIMIT 500
  `).all()
}

function walkFiles(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walkFiles(p))
    else out.push(p)
  }
  return out
}

// 孤儿清理：无任何笔记引用且创建超过 1 小时的附件（给「上传后还没保存」留缓冲）+ 磁盘残留文件
export function cleanupOrphanAttachments({ force = false } = {}) {
  const cutoff = new Date(Date.now() - 3600_000).toISOString()
  let removed = 0
  let bytes = 0
  if (fs.existsSync(filesDir)) {
    const rows = db.prepare(`
      SELECT a.id, a.file_name, a.size, a.created_at FROM attachments a
      WHERE NOT EXISTS (SELECT 1 FROM note_files nf WHERE nf.file_name = a.file_name)
    `).all()
    for (const row of rows) {
      if (!force && row.created_at > cutoff) continue
      fs.rmSync(path.join(filesDir, row.file_name), { force: true })
      db.prepare('DELETE FROM attachments WHERE id = ?').run(row.id)
      removed += 1
      bytes += row.size
    }
    // 库里无记录的磁盘残留（按目录约定 YYYYMM/xxx 识别，且落盘超过 1 小时）
    for (const file of walkFiles(filesDir)) {
      const rel = path.relative(filesDir, file).split(path.sep).join('/')
      if (!/^\d{6}\//.test(rel) || getAttachmentByPath(rel)) continue
      if (!force && fs.statSync(file).mtime.getTime() > Date.now() - 3600_000) continue
      fs.rmSync(file, { force: true })
      removed += 1
    }
  }
  return { removed, bytes }
}

export function attachmentStats() {
  const row = db.prepare('SELECT COUNT(*) c, COALESCE(SUM(size), 0) s FROM attachments').get()
  return { count: row.c, bytes: row.s }
}

// ---------- 每日笔记 ----------

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
export function journalTitle(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`)
  const wd = Number.isNaN(d.getTime()) ? '' : ` ${WEEKDAYS[d.getDay()]}`
  return `${dateStr}${wd} 日记`
}
const JOURNAL_TEMPLATE = `## ✅ 今日完成

- 

## 💡 学习与思考

- 

## 🌱 明日待办

- 
`

function ensureJournalNotebook() {
  const id = getSetting('journal_notebook_id')
  if (id) {
    const nb = getNotebook(Number(id))
    if (nb) return nb
  }
  let nb = db.prepare("SELECT * FROM notebooks WHERE name = '每日笔记' ORDER BY id LIMIT 1").get()
  if (!nb) nb = createNotebook({ name: '每日笔记', icon: '📅' })
  setSetting('journal_notebook_id', nb.id)
  return nb
}

export function getOrCreateJournalNote(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) return null
  const existing = db.prepare(
    'SELECT id FROM notes WHERE journal_date = ? AND deleted_at IS NULL ORDER BY id LIMIT 1'
  ).get(String(dateStr))
  if (existing) return getNote(existing.id)
  const nb = ensureJournalNotebook()
  return createNote({
    notebookId: nb.id,
    title: journalTitle(String(dateStr)),
    content: JOURNAL_TEMPLATE,
    journalDate: String(dateStr),
  })
}

export function listJournalMonth(year, month) {
  const y = Number(year)
  const m = Number(month)
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12 || y < 1970 || y > 2999) return null
  return db.prepare(`
    SELECT id, title, journal_date, updated_at FROM notes
    WHERE journal_date LIKE ? AND deleted_at IS NULL
    ORDER BY journal_date
  `).all(`${y}-${String(m).padStart(2, '0')}-%`)
}

// ---------- 备份 ----------

const BACKUP_NAME_RE = /^jianzhi-\d{8}-\d{6}(?:-\d{1,2})?\.db$/

export function listBackups() {
  fs.mkdirSync(backupDir, { recursive: true })
  const out = []
  for (const name of fs.readdirSync(backupDir)) {
    if (!BACKUP_NAME_RE.test(name)) continue
    const st = fs.statSync(path.join(backupDir, name))
    out.push({ name, size: st.size, created_at: st.mtime.toISOString() })
  }
  out.sort((a, b) => b.name.localeCompare(a.name))
  return out
}

function localStamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function createBackup() {
  fs.mkdirSync(backupDir, { recursive: true })
  // 同一秒内多次备份（如「恢复前快照」紧跟「手动备份」）时追加序号，避免覆盖
  let name = `jianzhi-${localStamp()}.db`
  if (fs.existsSync(path.join(backupDir, name))) {
    for (let i = 1; i <= 99; i++) {
      const candidate = `jianzhi-${localStamp()}-${i}.db`
      if (!fs.existsSync(path.join(backupDir, candidate))) { name = candidate; break }
    }
  }
  const dest = path.join(backupDir, name)
  return db.backup(dest).then(() => {
    const keep = getSettings().backupKeep
    for (const old of listBackups().slice(keep)) {
      try { fs.rmSync(path.join(backupDir, old.name), { force: true }) } catch { /* 忽略 */ }
    }
    setSetting('backup_last_at', now())
    return { name, size: fs.statSync(dest).size, created_at: new Date().toISOString() }
  })
}

// 到点检查：由入口 index.js 定时调用。返回是否实际执行了备份。
export async function maybeRunBackup() {
  const s = getSettings()
  if (!s.backupEnabled) return false
  if (s.backupLastAt) {
    const last = new Date(s.backupLastAt).getTime()
    if (Number.isFinite(last) && Date.now() - last < s.backupIntervalHours * 3600_000) return false
  }
  await createBackup()
  return true
}

function backupFilePath(name) {
  if (!BACKUP_NAME_RE.test(String(name))) return null
  return path.join(backupDir, String(name))
}

export function deleteBackup(name) {
  const p = backupFilePath(name)
  if (!p || !fs.existsSync(p)) return false
  fs.rmSync(p, { force: true })
  return true
}

export function getBackupPath(name) {
  const p = backupFilePath(name)
  return p && fs.existsSync(p) ? p : null
}

// 恢复：先把当前库快照为正式备份（保证恢复可逆）→ 关库 → 覆盖主文件 → 清 WAL/SHM → 重开
export async function restoreBackup(name) {
  const p = backupFilePath(name)
  if (!p) return false
  try { await createBackup() } catch { /* 快照失败不阻塞恢复 */ }
  try { db.close() } catch { /* 忽略 */ }
  for (const suffix of ['-wal', '-shm']) {
    try { fs.rmSync(dbPath + suffix, { force: true }) } catch { /* 忽略 */ }
  }
  fs.copyFileSync(p, dbPath)
  reopen()
  return true
}

// ---------- 图谱 ----------

const WIKI_LINK_RE = /\[\[([^\[\]|\n]+)(?:\|([^\[\]\n]+))?\]\]/g

export function getGraph() {
  const notes = db.prepare(
    'SELECT id, title, notebook_id FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC'
  ).all()
  const byTitle = new Map()
  for (const n of notes) {
    const key = n.title.trim().toLowerCase()
    if (key && !byTitle.has(key)) byTitle.set(key, n.id)
  }
  const edgeSet = new Map()
  const scan = db.prepare('SELECT id, content FROM notes WHERE deleted_at IS NULL')
  for (const row of scan.iterate()) {
    for (const m of row.content.matchAll(WIKI_LINK_RE)) {
      const targetId = byTitle.get(m[1].trim().toLowerCase())
      if (!targetId || targetId === row.id) continue
      const key = row.id < targetId ? `${row.id}-${targetId}` : `${targetId}-${row.id}`
      if (!edgeSet.has(key)) edgeSet.set(key, { s: row.id, t: targetId })
    }
  }
  const degree = new Map()
  const edges = [...edgeSet.values()]
  for (const e of edges) {
    degree.set(e.s, (degree.get(e.s) ?? 0) + 1)
    degree.set(e.t, (degree.get(e.t) ?? 0) + 1)
  }
  return {
    nodes: notes.map((n) => ({ id: n.id, title: n.title || '无标题', notebook_id: n.notebook_id, degree: degree.get(n.id) ?? 0 })),
    edges,
  }
}

// ---------- 其他 ----------

export function findNoteByTitle(title) {
  return db.prepare(`
    SELECT id, title FROM notes
    WHERE deleted_at IS NULL AND lower(title) = lower(?)
    ORDER BY updated_at DESC LIMIT 1
  `).get(String(title).trim()) ?? null
}

export function getStats() {
  return {
    total: db.prepare('SELECT COUNT(*) c FROM notes WHERE deleted_at IS NULL').get().c,
    starred: db.prepare('SELECT COUNT(*) c FROM notes WHERE deleted_at IS NULL AND starred = 1').get().c,
    trash: db.prepare('SELECT COUNT(*) c FROM notes WHERE deleted_at IS NOT NULL').get().c,
    notebooks: db.prepare('SELECT COUNT(*) c FROM notebooks').get().c,
    tags: db.prepare('SELECT COUNT(*) c FROM tags').get().c,
    words: db.prepare('SELECT COALESCE(SUM(LENGTH(content)), 0) c FROM notes WHERE deleted_at IS NULL').get().c,
    attachments: attachmentStats(),
  }
}

export function importNotes(list) {
  let imported = 0
  db.transaction(() => {
    for (const item of list) {
      createNote({
        notebookId: item.notebookId ?? null,
        title: item.title,
        content: item.content ?? '',
        tags: Array.isArray(item.tags) ? item.tags : [],
      })
      imported += 1
    }
  })()
  return { imported }
}

export function exportAll() {
  const notes = db.prepare('SELECT * FROM notes').all().map((n) => ({
    ...n,
    tags: db.prepare('SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ?')
      .all(n.id).map((t) => t.name),
  }))
  return {
    app: 'jianzhi',
    version: 3,
    exported_at: now(),
    notebooks: listNotebooks(),
    tags: listTags(),
    notes,
  }
}

// ---------- Markdown ZIP 导出（v0.3） ----------

function sanitizeExportName(name) {
  let base = String(name ?? '').replace(/[\\/:*?"<>|]/g, '_').replace(/[\u0000-\u001f]/g, '').trim()
  base = base.replace(/^\.+/, '').slice(0, 80).trim()
  return base || '未命名'
}

// 生成全库 Markdown 导出条目：按笔记本分目录 + 被引用附件原样归档
export function buildMarkdownZip() {
  const notes = db.prepare(`
    SELECT id, title, content, notebook_id FROM notes
    WHERE deleted_at IS NULL ORDER BY notebook_id, id
  `).all()
  const nbName = new Map(listNotebooks().map((n) => [n.id, sanitizeExportName(n.name)]))
  const entries = []
  const usedPaths = new Set()
  const filesToInclude = new Map() // attachment file_name -> zip 路径

  for (const n of notes) {
    const folder = n.notebook_id != null && nbName.has(n.notebook_id) ? nbName.get(n.notebook_id) : '未分类'
    const titled = sanitizeExportName(n.title)
    const title = titled === '未命名' ? `笔记-${n.id}` : titled
    let p = `${folder}/${title}.md`
    if (usedPaths.has(p)) p = `${folder}/${title}-${n.id}.md`
    usedPaths.add(p)
    entries.push({ path: p, data: Buffer.from(String(n.content ?? ''), 'utf8') })
    for (const m of String(n.content ?? '').matchAll(FILE_REF_RE)) {
      const name = m[1].replace(/[.,;:!?)。，；：！？、」』]+$/, '')
      if (!name || filesToInclude.has(name)) continue
      if (!getAttachmentByPath(name)) continue
      filesToInclude.set(name, `attachments/${name}`)
    }
  }

  // 附件读取：入库时已清洗文件名，读取前仍强制校验解析后路径位于附件根目录内（防穿越）
  const filesRoot = path.resolve(filesDir)
  for (const [name, zipPath] of filesToInclude) {
    const abs = path.resolve(filesRoot, name)
    if (abs === filesRoot || !abs.startsWith(filesRoot + path.sep)) continue
    if (!fs.existsSync(abs)) continue
    entries.push({ path: zipPath, data: fs.readFileSync(abs) })
  }
  return buildZip(entries)
}
