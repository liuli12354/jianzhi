// 简知 · HTTP API（Express）
// 本文件不写任何 SQL：数据访问全部经由 src/db.js。
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as store from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const bad = (res, msg) => res.status(400).json({ error: msg })

// 允许内联展示（图片）的 MIME；其余一律按附件下载，防 SVG/HTML 内联执行
const INLINE_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp']

// 本地日期（YYYY-MM-DD）：每日笔记按用户本地时区归档
function localDateStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function buildApp() {
  const app = express()
  // 附件以 base64 JSON 上传，放宽请求体上限（约可容纳 11MB 二进制）
  app.use(express.json({ limit: '20mb' }))
  const api = express.Router()

  api.get('/health', (_req, res) => {
    res.json({ ok: true, name: '简知', version: '1.1.0', time: new Date().toISOString() })
  })

  // ---- 笔记本 ----
  api.get('/notebooks', (_req, res) => res.json(store.listNotebooks()))

  api.get('/notebooks/:id', (req, res) => {
    const nb = store.getNotebook(Number(req.params.id))
    if (!nb) return res.status(404).json({ error: '笔记本不存在' })
    res.json(nb)
  })

  api.post('/notebooks', (req, res) => {
    const name = String(req.body?.name ?? '').trim()
    if (!name) return bad(res, '笔记本名称不能为空')
    if (name.length > 50) return bad(res, '笔记本名称过长（最多 50 字）')
    try {
      res.status(201).json(store.createNotebook({ name, icon: req.body?.icon, parentId: req.body?.parentId ?? null }))
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message || '创建失败' })
    }
  })

  api.patch('/notebooks/:id', (req, res) => {
    const id = Number(req.params.id)
    const b = req.body ?? {}
    // v0.3/v0.4 层级：显式移动（parentId 可为 null 提升为顶级；position 为兄弟插入下标）
    if (b.parentId !== undefined || b.position !== undefined) {
      const moved = store.moveNotebook(id, b.parentId, b.position)
      if (!moved) return res.status(404).json({ error: '笔记本不存在' })
      if (moved.error) return bad(res, moved.error)
      return res.json(moved)
    }
    const nb = store.updateNotebook(id, { name: b.name, icon: b.icon })
    if (!nb) return res.status(404).json({ error: '笔记本不存在' })
    res.json(nb)
  })

  api.delete('/notebooks/:id', (req, res) => {
    const ok = store.deleteNotebook(Number(req.params.id))
    if (!ok) return res.status(404).json({ error: '笔记本不存在' })
    res.json({ ok: true })
  })

  // ---- 笔记 ----
  api.get('/notes', (req, res) => {
    const { notebookId, tagId, q, status, sort } = req.query
    res.json(store.listNotes({
      notebookId: notebookId !== undefined ? Number(notebookId) : undefined,
      tagId: tagId !== undefined ? Number(tagId) : undefined,
      q: q !== undefined ? String(q) : undefined,
      status: status !== undefined ? String(status) : undefined,
      sort: sort !== undefined ? String(sort) : undefined,
    }))
  })

  api.post('/notes', (req, res) => {
    const b = req.body ?? {}
    if (b.notebookId != null && b.notebookId !== undefined) {
      if (!Number.isFinite(Number(b.notebookId))) return bad(res, 'notebookId 无效')
      if (!store.getNotebook(Number(b.notebookId))) return bad(res, '笔记本不存在')
    }
    res.status(201).json(store.createNote({
      notebookId: b.notebookId ?? null,
      title: b.title,
      content: b.content,
      tags: Array.isArray(b.tags) ? b.tags : [],
      pinned: b.pinned,
      starred: b.starred,
    }))
  })

  // 随机漫游：必须在 /notes/:id 之前注册，否则 random 会被当作 id 吞掉
  api.get('/notes/random', (_req, res) => {
    res.json({ note: store.getRandomNote() })
  })

  api.get('/notes/:id', (req, res) => {
    const note = store.getNote(Number(req.params.id))
    if (!note) return res.status(404).json({ error: '笔记不存在' })
    res.json(note)
  })

  api.patch('/notes/:id', (req, res) => {
    const id = Number(req.params.id)
    const b = req.body ?? {}
    const patch = {}
    if (b.title !== undefined) patch.title = b.title
    if (b.content !== undefined) patch.content = b.content
    if (b.notebookId !== undefined) patch.notebookId = b.notebookId
    if (b.pinned !== undefined) patch.pinned = b.pinned
    if (b.starred !== undefined) patch.starred = b.starred
    const note = store.updateNote(id, patch)
    if (!note) return res.status(404).json({ error: '笔记不存在' })
    if (Array.isArray(b.tags)) return res.json(store.setNoteTags(id, b.tags))
    res.json(note)
  })

  // 删除：默认软删除进回收站；?purge=1 彻底删除
  api.delete('/notes/:id', (req, res) => {
    const id = Number(req.params.id)
    if (!store.getNote(id)) return res.status(404).json({ error: '笔记不存在' })
    if (req.query.purge) {
      store.purgeNote(id)
      return res.json({ ok: true, purged: true })
    }
    store.softDeleteNote(id)
    res.json({ ok: true })
  })

  api.post('/notes/:id/restore', (req, res) => {
    const id = Number(req.params.id)
    if (!store.getNote(id)) return res.status(404).json({ error: '笔记不存在' })
    store.restoreNote(id)
    res.json(store.getNote(id))
  })

  api.get('/notes/:id/versions', (req, res) => res.json(store.listVersions(Number(req.params.id))))

  api.post('/notes/:id/versions/:versionId/restore', (req, res) => {
    const note = store.restoreVersion(Number(req.params.id), Number(req.params.versionId))
    if (!note) return res.status(404).json({ error: '版本不存在' })
    res.json(note)
  })

  api.get('/notes/:id/backlinks', (req, res) => {
    res.json({ links: store.listBacklinks(Number(req.params.id)) })
  })

  // v0.8 出链：本笔记 [[标题]] 的解析结果
  api.get('/notes/:id/outgoing', (req, res) => {
    const links = store.listOutgoingLinks(Number(req.params.id))
    if (!links) return res.status(404).json({ error: '笔记不存在' })
    res.json({ links })
  })

  // v0.6 未链接提及：正文含标题但未用 [[]] 引用
  api.get('/notes/:id/unlinked', (req, res) => {
    res.json({ mentions: store.listUnlinkedMentions(Number(req.params.id)) })
  })

  // v0.6 全库任务聚合（v1.1 支持 ?due=YYYY-MM-DD 当日过滤）
  api.get('/tasks', (req, res) => {
    let tasks = store.listAllTasks()
    const due = req.query.due
    if (due !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(due))) return bad(res, 'due 格式应为 YYYY-MM-DD')
      tasks = tasks.filter((t) => t.due === String(due))
    }
    res.json({ tasks })
  })

  // v1.1 编辑活动热力图
  api.get('/activity', (req, res) => {
    res.json(store.getActivity(Number(req.query.days) || 182))
  })

  // v0.7 任务勾选回写源笔记
  api.post('/notes/:id/task-toggle', (req, res) => {
    const b = req.body ?? {}
    const r = store.toggleNoteTask(Number(req.params.id), b.lineIndex, b.checked, b.line)
    if (!r) return res.status(404).json({ error: '笔记不存在' })
    if (r.error) return bad(res, r.error)
    res.json(r)
  })

  // v0.7 提及一键转链
  api.post('/notes/:id/link-mention', (req, res) => {
    const r = store.linkifyMention(Number(req.params.id), req.body?.title)
    if (!r) return res.status(404).json({ error: '笔记不存在' })
    if (r.error) return bad(res, r.error)
    res.json(r)
  })

  api.post('/notes/:id/tags', (req, res) => {
    if (!Array.isArray(req.body?.tags)) return bad(res, 'tags 必须是字符串数组')
    const note = store.setNoteTags(Number(req.params.id), req.body.tags)
    if (!note) return res.status(404).json({ error: '笔记不存在' })
    res.json(note)
  })

  // 双链跳转：按标题精确解析笔记
  api.get('/resolve', (req, res) => {
    const title = String(req.query.title ?? '').trim()
    if (!title) return res.json(null)
    res.json(store.findNoteByTitle(title))
  })

  // ---- 全局搜索（FTS5，相关度 + 片段） ----
  api.get('/search', (req, res) => {
    const { notebookId, tagId, q, status } = req.query
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50))
    res.json(store.searchNotes({
      q: q !== undefined ? String(q) : undefined,
      notebookId: notebookId !== undefined && notebookId !== '' ? Number(notebookId) : undefined,
      tagId: tagId !== undefined && tagId !== '' ? Number(tagId) : undefined,
      status: status !== undefined ? String(status) : 'active',
      limit,
    }))
  })

  // ---- 附件 ----
  // base64 JSON 直传：POST /api/attachments { name, mime, data }
  api.post('/attachments', (req, res) => {
    const b = req.body ?? {}
    if (typeof b.data !== 'string' || b.data.length === 0) return bad(res, '缺少文件内容')
    const buf = Buffer.from(b.data, 'base64')
    if (buf.length === 0) return bad(res, '文件内容无效（base64 解析失败）')
    let name = 'file'
    if (typeof b.name === 'string' && b.name.trim()) name = b.name.trim()
    let mime = 'application/octet-stream'
    if (typeof b.mime === 'string' && b.mime.trim()) mime = b.mime.trim()
    try {
      const att = store.createAttachment({ buf, origName: name, mime })
      res.status(201).json(att)
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message || '附件写入失败' })
    }
  })

  api.get('/attachments', (_req, res) => res.json(store.listAttachments()))

  api.delete('/attachments/:id', (req, res) => {
    const result = store.deleteAttachment(Number(req.params.id))
    if (!result) return res.status(404).json({ error: '附件不存在' })
    if (result.error) return bad(res, result.error)
    res.json({ ok: true })
  })

  // 清理无引用的孤儿附件（默认跳过 1 小时内的新上传；?force=1 强制）
  api.post('/attachments/cleanup', (req, res) => {
    res.json(store.cleanupOrphanAttachments({ force: req.query.force === '1' }))
  })

  // ---- 附件文件服务（/files/*，在静态资源与 SPA 回退之前挂载） ----
  // 防穿越：resolve 后必须仍位于 files 根目录内（绝对路径与 .. 均会被前缀检查拒绝）
  const filesRoot = path.resolve(store.filesDir)
  const filesPrefix = filesRoot + path.sep
  app.use('/files', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    let rel
    try {
      rel = decodeURIComponent(req.path).replace(/^\/+/, '')
    } catch {
      return res.status(404).json({ error: '文件不存在' })
    }
    const abs = path.resolve(filesRoot, rel)
    if (abs === filesRoot || !abs.startsWith(filesPrefix)) {
      return res.status(404).json({ error: '文件不存在' })
    }
    const att = store.getAttachmentByPath(path.relative(filesRoot, abs).split(path.sep).join('/'))
    if (!att || !fs.existsSync(abs)) return res.status(404).json({ error: '文件不存在' })
    const inline = INLINE_MIME.includes(att.mime)
    res.set({
      'Content-Type': att.mime,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(att.orig_name)}`,
    })
    res.sendFile(abs)
  })

  // ---- 每日笔记 ----
  api.get('/journal/today', (_req, res) => {
    res.json({ date: localDateStr(), note: store.getOrCreateJournalNote(localDateStr()) })
  })

  api.post('/journal/:date', (req, res) => {
    const note = store.getOrCreateJournalNote(String(req.params.date))
    if (!note) return bad(res, '日期格式应为 YYYY-MM-DD')
    res.json({ date: String(req.params.date), note })
  })

  api.get('/journal/:year/:month', (req, res) => {
    const list = store.listJournalMonth(req.params.year, req.params.month)
    if (!list) return bad(res, '年月无效')
    res.json(list)
  })

  // v1.0 日历月聚合：日记日期 + 任务到期分布
  api.get('/calendar/:year/:month', (req, res) => {
    const data = store.getCalendarMonth(req.params.year, req.params.month)
    if (!data) return bad(res, '年月无效')
    res.json(data)
  })

  // ---- 备份 ----
  api.get('/backups', (_req, res) => {
    res.json({ backups: store.listBackups(), settings: store.getSettings(), dir: store.backupDir })
  })

  api.post('/backups', async (_req, res) => {
    res.json(await store.createBackup())
  })

  api.delete('/backups/:name', (req, res) => {
    if (!store.deleteBackup(req.params.name)) return res.status(404).json({ error: '备份不存在' })
    res.json({ ok: true })
  })

  api.get('/backups/:name/download', (req, res) => {
    const p = store.getBackupPath(req.params.name)
    if (!p) return res.status(404).json({ error: '备份不存在' })
    const fileName = path.basename(p)
    res.set('Content-Disposition', `attachment; filename="${fileName}"`)
    res.sendFile(p)
  })

  api.post('/backups/:name/restore', async (req, res) => {
    const ok = await store.restoreBackup(req.params.name)
    if (!ok) return res.status(404).json({ error: '备份不存在' })
    res.json({ ok: true })
  })

  // ---- 设置 ----
  api.get('/settings', (_req, res) => res.json(store.getSettings()))
  api.patch('/settings', (req, res) => res.json(store.updateSettings(req.body ?? {})))

  // ---- 图谱 / 标签 / 回收站 / 统计 ----
  api.get('/graph', (_req, res) => res.json(store.getGraph()))
  api.get('/tags', (_req, res) => res.json(store.listTags()))

  // v0.6 标签管理：重命名（重名即合并）与删除
  api.patch('/tags/:id', (req, res) => {
    const r = store.renameTag(Number(req.params.id), req.body?.name)
    if (!r) return res.status(404).json({ error: '标签不存在' })
    if (r.error) return bad(res, r.error)
    res.json(r)
  })
  api.delete('/tags/:id', (req, res) => {
    const ok = store.deleteTag(Number(req.params.id))
    if (!ok) return res.status(404).json({ error: '标签不存在' })
    res.json({ ok: true })
  })

  api.delete('/trash', (_req, res) => { store.emptyTrash(); res.json({ ok: true }) })
  api.get('/stats', (_req, res) => res.json(store.getStats()))

  // ---- 导入 / 导出 ----
  api.post('/import', (req, res) => {
    const list = Array.isArray(req.body?.notes) ? req.body.notes : []
    if (!list.length) return bad(res, '没有可导入的笔记')
    res.status(201).json(store.importNotes(list))
  })

  api.get('/export', (_req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="jianzhi-export.json"')
    res.json(store.exportAll())
  })

  // v0.3：全库导出 Markdown ZIP（按笔记本分目录 + 引用附件）
  api.get('/export/md', (_req, res) => {
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
    const zip = store.buildMarkdownZip()
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="jianzhi-md-${stamp}.zip"`,
    })
    res.send(zip)
  })

  app.use('/api', api)
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }))

  // 生产模式：托管前端构建产物（SPA 回退到 index.html）
  const webDist = path.join(__dirname, '..', '..', 'web', 'dist')
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist))
    // 兼容 Express 4/5 的 SPA 回退写法（Express 5 不再支持 '*' 通配路由）
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next()
      if (req.path.startsWith('/api') || req.path.startsWith('/files')) return res.status(404).json({ error: '不存在' })
      res.sendFile(path.join(webDist, 'index.html'))
    })
  }

  // 统一错误处理
  app.use((err, _req, res, _next) => {
    console.error('[简知] 服务器错误:', err.message)
    res.status(500).json({ error: err.message || '服务器内部错误' })
  })

  return app
}
