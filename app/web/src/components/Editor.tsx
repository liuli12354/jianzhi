import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, ClipboardEvent as ReactClipboardEvent } from 'react'
import type { Backlink, EditorMode, Note, NoteVersion, Notebook, OutgoingLink, UnlinkedMention } from '../types'
import { htmlToMarkdown } from '../htmlToMarkdown'
import { api, exportNoteAsMarkdown } from '../api'
import { formatFull, relativeTime, tagHue } from '../utils'
import { parseOutline, taskProgress } from '../markdown'
import Markdown from './Markdown'
import Modal from './Modal'

interface Props {
  note: Note | null
  loading: boolean
  notebooks: Notebook[]
  onSave: (id: number, patch: Record<string, unknown>) => Promise<Note>
  onOpenTitle: (title: string) => void
  onOpenBacklink: (id: number, context: string | null) => void
  onDelete: (note: Note) => void
  onToast: (msg: string) => void
  /** v0.4 反链定位请求（App 在打开笔记后下发） */
  locateReq?: { noteId: number; text: string; seq: number } | null
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export default function Editor({ note, loading, notebooks, onSave, onOpenTitle, onOpenBacklink, onDelete, onToast, locateReq }: Props) {
  const [title, setTitle] = useState(note?.title ?? '')
  const [content, setContent] = useState(note?.content ?? '')
  const [mode, setMode] = useState<EditorMode>(() => (window.innerWidth >= 1280 ? 'split' : 'edit'))
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [tagDraft, setTagDraft] = useState('')
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [versions, setVersions] = useState<NoteVersion[]>([])
  const [backlinks, setBacklinks] = useState<Backlink[]>([])
  const [mentions, setMentions] = useState<UnlinkedMention[]>([])
  const [outgoing, setOutgoing] = useState<OutgoingLink[]>([])
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const saveTimer = useRef<number | undefined>(undefined)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const inTrash = note?.deleted_at != null

  const outline = useMemo(() => parseOutline(content), [content])
  const tasks = useMemo(() => taskProgress(content), [content])

  // 空标题时从正文首行派生（对齐 Notion 的体验）
  const firstMeaningfulLine = (c: string) => {
    for (const raw of c.split('\n')) {
      const line = raw.trim().replace(/^#+\s*/, '').replace(/[*`>~]/g, '').trim()
      if (line) return line.slice(0, 60)
    }
    return ''
  }

  const persist = useCallback(
    async (nextTitle: string, nextContent: string) => {
      if (!note) return undefined
      const finalTitle = nextTitle.trim() ? nextTitle : (firstMeaningfulLine(nextContent) || '无标题')
      setSaveState('saving')
      try {
        const updated = await onSave(note.id, { title: finalTitle, content: nextContent })
        if (!nextTitle.trim() && updated.title !== nextTitle) setTitle(updated.title)
        setSaveState('saved')
        window.setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 1600)
        return updated
      } catch (e) {
        setSaveState('idle')
        onToast(`保存失败：${(e as Error).message}`)
        return undefined
      }
    },
    [note, onSave, onToast],
  )

  const scheduleSave = (t: string, c: string) => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => { persist(t, c) }, 800)
  }

  // Ctrl/Cmd + S 立即保存
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        window.clearTimeout(saveTimer.current)
        if (note) persist(title, content)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [note, title, content, persist])

  // 反向链接列表
  useEffect(() => {
    if (!note) {
      setBacklinks([])
      return
    }
    let alive = true
    api.getBacklinks(note.id)
      .then((d) => { if (alive) setBacklinks(d.links) })
      .catch(() => {})
    return () => { alive = false }
  }, [note?.id])

  // v0.7 提及一键转链：转链后同时刷新提及与反链（提及应移入反链）
  const linkifyMention = async (m: UnlinkedMention) => {
    if (!note) return
    try {
      await api.linkifyMention(m.id, note.title)
      onToast(`已把「${m.title}」中的提及转为链接`)
      const [d1, d2] = await Promise.all([api.getUnlinkedMentions(note.id), api.getBacklinks(note.id)])
      setMentions(d1.mentions)
      setBacklinks(d2.links)
    } catch (e) {
      onToast((e as Error).message)
    }
  }

  // v0.4 反链定位：locateReq 变化时滚动到引用行并闪烁
  useEffect(() => {
    if (!locateReq || !note || locateReq.noteId !== note.id || !locateReq.text) return
    const run = () => {
      const ta = taRef.current
      if (mode === 'edit' && ta) {
        const lines = ta.value.split('\n')
        const plain = locateReq.text.replace(/\[\[|\]\]/g, '').trim()
        const idx = lines.findIndex((l) => l.includes(locateReq.text) || l.includes(plain))
        if (idx >= 0) {
          const lh = parseFloat(getComputedStyle(ta).lineHeight) || 27
          ta.scrollTop = Math.max(0, idx * lh - ta.clientHeight / 3)
          ta.classList.add('flash-outline')
          window.setTimeout(() => ta.classList.remove('flash-outline'), 1300)
        }
        return
      }
      const pane = previewRef.current
      if (!pane) return
      // 预览态文本不含 [[ ]] 与任务标记，统一剥离后匹配
      const plain = locateReq.text
        .replace(/\[\[|\]\]/g, '')
        .replace(/^\s*(?:[-*+]|\d+\.)\s+\[( |x|X)\]\s*/, '')
        .trim()
      const els = pane.querySelectorAll('p, li, h1, h2, h3, h4, blockquote, td, pre')
      const target = [...els].find((el) => el.textContent?.includes(plain) || el.textContent?.includes(locateReq.text))
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        target.classList.add('flash')
        window.setTimeout(() => target.classList.remove('flash'), 1300)
      }
    }
    // Markdown 渲染是同步的，短延时等布局稳定即可（rAF 在部分内嵌环境不触发）
    const t = window.setTimeout(run, 60)
    return () => window.clearTimeout(t)
  }, [locateReq, note, mode])

  // 未链接提及（v0.6）
  useEffect(() => {
    if (!note || !note.title.trim()) {
      setMentions([])
      return
    }
    let alive = true
    api.getUnlinkedMentions(note.id)
      .then((d) => { if (alive) setMentions(d.mentions) })
      .catch(() => {})
    return () => { alive = false }
  }, [note?.id])

  // ---- 文本操作 ----
  const replaceContent = (next: string, selStart?: number, selEnd?: number) => {
    setContent(next)
    scheduleSave(title, next)
    if (selStart !== undefined) {
      requestAnimationFrame(() => {
        const ta = taRef.current
        if (!ta) return
        ta.focus()
        ta.selectionStart = selStart
        ta.selectionEnd = selEnd ?? selStart
      })
    }
  }

  const insertAtCursor = (text: string) => {
    const ta = taRef.current
    if (!ta) {
      // 预览模式下拖入：追加到文末
      const next = content.replace(/\s*$/, '') + (content.trim() ? '\n\n' : '') + text + '\n'
      replaceContent(next)
      return
    }
    const s = ta.selectionStart
    const e = ta.selectionEnd
    const next = content.slice(0, s) + text + content.slice(e)
    replaceContent(next, s + text.length)
  }

  const applyWrap = (before: string, after: string, placeholder: string) => {
    const ta = taRef.current
    if (!ta) return
    const s = ta.selectionStart
    const e = ta.selectionEnd
    const selected = content.slice(s, e) || placeholder
    const next = content.slice(0, s) + before + selected + after + content.slice(e)
    replaceContent(next, s + before.length, s + before.length + selected.length)
  }

  const applyLinePrefix = (prefix: string) => {
    const ta = taRef.current
    if (!ta) return
    const s = ta.selectionStart
    const e = ta.selectionEnd
    const start = content.lastIndexOf('\n', Math.max(0, s - 1)) + 1
    const nl = content.indexOf('\n', e)
    const end = nl === -1 ? content.length : nl
    const replaced = content.slice(start, end).split('\n').map((l) => prefix + l).join('\n')
    const next = content.slice(0, start) + replaced + content.slice(end)
    replaceContent(next, start + replaced.length)
  }

  // 出链（v0.8）
  useEffect(() => {
    if (!note) {
      setOutgoing([])
      return
    }
    let alive = true
    api.getOutgoing(note.id)
      .then((d) => { if (alive) setOutgoing(d.links) })
      .catch(() => {})
    return () => { alive = false }
  }, [note?.id, content])

  // ---- 图片 / 附件上传（粘贴、拖拽、按钮） ----
  const uploadFiles = async (files: File[]) => {
    if (!note || !files.length) return
    for (const f of files) {
      if (f.size > MAX_UPLOAD_BYTES) {
        onToast(`「${f.name}」超过 10MB，已跳过`)
        continue
      }
      setUploading(true)
      try {
        const att = await api.uploadAttachment(f)
        const md = att.inline ? `![${f.name}](${att.url})` : `[${f.name}](${att.url})`
        insertAtCursor(md)
        onToast(`已插入「${f.name}」`)
      } catch (e) {
        onToast(`上传失败：${(e as Error).message}`)
      } finally {
        setUploading(false)
      }
    }
  }

  // v0.8 追踪 Shift 键状态（paste 事件不携带修饰键），Ctrl+Shift+V 逃逸纯文本
  const shiftHeld = useRef(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => { shiftHeld.current = e.shiftKey }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', down)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', down)
    }
  }, [])

  const onPasteTa = (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const dt = e.clipboardData
    const files = Array.from(dt?.files ?? [])
    if (files.length) {
      e.preventDefault()
      uploadFiles(files)
      return
    }
    // v0.8：HTML 粘贴自动转 Markdown（网页收集场景），Ctrl+Shift+V 逃逸为纯文本
    const html = dt?.getData('text/html')
    if (html && html.trim() && !shiftHeld.current) {
      try {
        const md = htmlToMarkdown(html)
        if (md.trim()) {
          e.preventDefault()
          insertAtCursor(md)
        }
      } catch {
        /* 转换失败回退浏览器默认粘贴 */
      }
    }
  }

  // v0.8 Enter 智能续行：列表/任务前缀延续，空项退出列表
  const onKeyDownTa = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      applyWrap('  ', '', '')
      return
    }
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing) return
    const ta = taRef.current
    if (!ta) return
    const s = ta.selectionStart
    const lineStart = content.lastIndexOf('\n', Math.max(0, s - 1)) + 1
    const line = content.slice(lineStart, s)
    const m = line.match(/^(\s*)(?:([-*+])\s+(\[[ xX]\]\s+)?|(\d+)\.\s+)(.*)$/)
    if (!m) return
    e.preventDefault()
    const [, indent, bullet, task, num, rest] = m
    // 标记后无内容 → 退出列表
    if (!rest.trim()) {
      const next = content.slice(0, lineStart) + content.slice(s)
      replaceContent(next, lineStart)
      return
    }
    let prefix: string
    if (bullet) prefix = `${indent}${bullet} ${task ? '[ ] ' : ''}`
    else prefix = `${indent}${Number(num) + 1}. `
    const insert = `\n${prefix}`
    const next = content.slice(0, s) + insert + content.slice(s)
    replaceContent(next, s + insert.length)
  }

  const onDropBody = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length) uploadFiles(files)
  }

  // ---- 任务复选框回写 ----
  const toggleTask = (index: number) => {
    let n = 0
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*[-*+]\s+\[)([ xX])(\].*)$/)
      if (!m) continue
      if (n === index) {
        lines[i] = m[1] + (m[2] === ' ' ? 'x' : ' ') + m[3]
        break
      }
      n += 1
    }
    replaceContent(lines.join('\n'))
  }

  // ---- 大纲跳转 ----
  const scrollToHeading = (id: string) => {
    const el = document.getElementById(id)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // ---- 标签 ----
  const addTag = async () => {
    const name = tagDraft.trim()
    if (!name || !note) return
    const names = [...(note.tags ?? []).map((t) => t.name), name]
    setTagDraft('')
    try {
      await onSave(note.id, { tags: names })
    } catch (e) {
      onToast((e as Error).message)
    }
  }
  const removeTag = async (name: string) => {
    if (!note) return
    try {
      await onSave(note.id, { tags: (note.tags ?? []).map((t) => t.name).filter((n) => n !== name) })
    } catch (e) {
      onToast((e as Error).message)
    }
  }

  // ---- 版本历史 ----
  const openVersions = async () => {
    if (!note) return
    try {
      setVersions(await api.listVersions(note.id))
      setVersionsOpen(true)
    } catch (e) {
      onToast((e as Error).message)
    }
  }
  const doRestoreVersion = async (v: NoteVersion) => {
    if (!note) return
    try {
      const updated = await api.restoreVersion(note.id, v.id)
      setTitle(updated.title)
      setContent(updated.content)
      setVersionsOpen(false)
      onToast('已恢复到历史版本')
    } catch (e) {
      onToast((e as Error).message)
    }
  }

  if (loading) {
    return (
      <section className="editor">
        <div className="empty"><div>加载中…</div></div>
      </section>
    )
  }

  if (!note) {
    return (
      <section className="editor">
        <div className="empty">
          <div className="empty-icon">🗒️</div>
          <div>在左侧选择一篇笔记，或新建一篇</div>
          <div className="empty-tips">
            <kbd>Ctrl N</kbd> 新建 · <kbd>Ctrl K</kbd> 搜索 · <kbd>Ctrl S</kbd> 保存
          </div>
        </div>
      </section>
    )
  }

  const wordCount = content.replace(/\s/g, '').length
  const showEditorPane = !inTrash && mode !== 'preview'
  const showPreviewPane = inTrash || mode !== 'edit'

  return (
    <section className="editor">
      <div className="ed-head">
        <input
          className="ed-title"
          value={title}
          placeholder="无标题"
          disabled={inTrash}
          onChange={(e) => { setTitle(e.target.value); scheduleSave(e.target.value, content) }}
        />
        <div className="ed-actions">
          <button
            className="icon-btn"
            title={note.starred ? '取消收藏' : '收藏'}
            disabled={inTrash}
            onClick={() => onSave(note.id, { starred: !note.starred }).catch((e) => onToast((e as Error).message))}
          >
            {note.starred ? '★' : '☆'}
          </button>
          <button
            className="icon-btn"
            title={note.pinned ? '取消置顶' : '置顶'}
            disabled={inTrash}
            onClick={() => onSave(note.id, { pinned: !note.pinned }).catch((e) => onToast((e as Error).message))}
          >
            {note.pinned ? '📌' : '📍'}
          </button>
          <div className="seg">
            {([['edit', '编辑'], ['split', '分屏'], ['preview', '预览']] as const).map(([m, label]) => (
              <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{label}</button>
            ))}
          </div>
          <button className="icon-btn" title="版本历史" onClick={openVersions}>🕒</button>
          <button className="icon-btn" title="导出为 .md 文件" onClick={() => exportNoteAsMarkdown(note)}>⬇️</button>
          <button className="icon-btn danger" title={inTrash ? '彻底删除' : '移入回收站'} onClick={() => onDelete(note)}>🗑</button>
        </div>
      </div>

      <div className="ed-meta">
        <select
          className="ed-notebook"
          value={note.notebook_id ?? ''}
          disabled={inTrash}
          onChange={(e) => {
            const v = e.target.value
            onSave(note.id, { notebookId: v === '' ? null : Number(v) }).catch((err) => onToast((err as Error).message))
          }}
        >
          <option value="">（未分类）</option>
          {notebooks.map((nb) => (
            <option key={nb.id} value={nb.id}>{nb.icon} {nb.name}</option>
          ))}
        </select>
        <span className="ed-time">更新于 {relativeTime(note.updated_at)}</span>
        <span className="ed-save">{uploading ? '⬆️ 上传中…' : saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '✓ 已保存' : ''}</span>
        {tasks.total > 0 && (
          <span className="ed-tasks" title="任务完成度">✅ {tasks.done}/{tasks.total}</span>
        )}
        <span className="ed-count">{wordCount} 字</span>
      </div>

      <div className="ed-tags">
        {(note.tags ?? []).map((t) => (
          <span key={t.id} className="chip" style={{ '--h': tagHue(t.name) } as CSSProperties}>
            # {t.name}
            {!inTrash && (
              <button className="chip-x" title="移除标签" onClick={() => removeTag(t.name)}>×</button>
            )}
          </span>
        ))}
        {!inTrash && (
          <input
            className="tag-input"
            placeholder="＋ 标签，回车添加"
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addTag() }}
          />
        )}
      </div>

      {inTrash && <div className="ed-trash-banner">该笔记在回收站中，恢复后才能编辑。</div>}

      {showEditorPane && (
        <div className="ed-toolbar">
          <button onClick={() => applyWrap('**', '**', '加粗文字')} title="加粗">B</button>
          <button onClick={() => applyWrap('*', '*', '斜体文字')} title="斜体"><i>I</i></button>
          <button onClick={() => applyLinePrefix('## ')} title="标题">H2</button>
          <button onClick={() => applyLinePrefix('> ')} title="引用">❝</button>
          <button onClick={() => applyLinePrefix('- ')} title="无序列表">• 列表</button>
          <button onClick={() => applyLinePrefix('1. ')} title="有序列表">1. 编号</button>
          <button onClick={() => applyLinePrefix('- [ ] ')} title="任务列表">☑ 任务</button>
          <button onClick={() => applyWrap('`', '`', '代码')} title="行内代码">‹ ›</button>
          <button onClick={() => applyWrap('\n```js\n', '\n```\n', 'console.log(1)')} title="代码块">{'{ }'}</button>
          <button onClick={() => applyWrap('[', '](https://)', '链接文字')} title="链接">🔗</button>
          <button onClick={() => applyWrap('[[', ']]', '笔记标题')} title="双链到其他笔记">[[ ]]</button>
          <button onClick={() => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); insertAtCursor(`📅 ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `) }} title="插入今天日期（任务到期标记）">📅</button>
          <button
            onClick={() => fileRef.current?.click()}
            title="插入图片或附件（也可直接粘贴 / 拖拽）"
            disabled={uploading}
          >
            🖼 图片
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = ''
              uploadFiles(files)
            }}
          />
        </div>
      )}

      <div
        className={`editor-body mode-${inTrash ? 'preview' : mode} ${dragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); if (!inTrash) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDropBody}
      >
        {showEditorPane && (
          <textarea
            ref={taRef}
            className="ed-input"
            value={content}
            placeholder={'用 Markdown 书写…\n\n支持 [[双链]]、- [ ] 待办、表格、代码块，可直接粘贴 / 拖入图片'}
            onChange={(e) => { setContent(e.target.value); scheduleSave(title, e.target.value) }}
            onKeyDown={onKeyDownTa}
            onPaste={onPasteTa}
          />
        )}
        {showPreviewPane && (
          <div className="md-pane" ref={previewRef}>
            <Markdown source={content} onOpenTitle={onOpenTitle} onToggleTask={inTrash ? undefined : toggleTask} />
          </div>
        )}
        {showPreviewPane && !inTrash && outline.length > 0 && (
          <aside className="toc-pane">
            <div className="toc-title">大纲</div>
            {outline.map((o) => (
              <button
                key={o.id}
                className={`toc-item lv${o.level}`}
                style={{ paddingLeft: 8 + (o.level - 1) * 12 }}
                onClick={() => scrollToHeading(o.id)}
                title={o.text}
              >
                {o.text}
              </button>
            ))}
          </aside>
        )}
      </div>

      {outgoing.length > 0 && (
        <div className="backlinks outgoing">
          <div className="bl-title">➡️ 出链（{outgoing.length}）</div>
          {outgoing.map((l) => (
            <button
              key={l.title}
              className={`bl-item ${l.id == null ? 'bl-missing' : ''}`}
              onClick={() => (l.id == null ? onOpenTitle(l.title) : onOpenBacklink(l.id, null))}
              title={l.id == null ? '目标笔记未创建，点击全局搜索' : '点击打开目标笔记'}
            >
              <span className="bl-main">
                <span className="ellipsis">{l.alias ? `${l.title}（${l.alias}）` : l.title}</span>
              </span>
              {l.id == null && <span className="bl-time">未创建</span>}
            </button>
          ))}
        </div>
      )}

      {backlinks.length > 0 && (
        <div className="backlinks">
          <div className="bl-title">
            <span>🔗 反向链接（{backlinks.length}）</span>
            {backlinks.some((l) => l.contextFull) && (
              <button
                className="icon-btn bl-all"
                onClick={() => {
                  const withFull = backlinks.filter((l) => l.contextFull)
                  const allOpen = withFull.every((l) => expanded.has(l.id))
                  setExpanded(allOpen ? new Set() : new Set(withFull.map((l) => l.id)))
                }}
              >
                {backlinks.filter((l) => l.contextFull).every((l) => expanded.has(l.id)) ? '全部收起' : '全部展开'}
              </button>
            )}
          </div>
          {backlinks.map((l) => (
            <div key={l.id} className="bl-wrap">
              <button className="bl-item" onClick={() => onOpenBacklink(l.id, l.context ?? null)} title="点击跳转并定位引用行">
                <span className="bl-main">
                  <span className="ellipsis">{l.title}</span>
                  {l.context && <span className="bl-context ellipsis">{l.context}</span>}
                </span>
                <span className="bl-time">{relativeTime(l.updated_at)}</span>
              </button>
              {l.contextFull && (
                <span className="bl-actions">
                  <button
                    className="icon-btn bl-expand"
                    title={expanded.has(l.id) ? '收起上下文' : '展开上下文（±3 行）'}
                    onClick={() => setExpanded((s) => {
                      const next = new Set(s)
                      if (next.has(l.id)) next.delete(l.id)
                      else next.add(l.id)
                      return next
                    })}
                  >
                    {expanded.has(l.id) ? '▾' : '▸'}
                  </button>
                </span>
              )}
              {l.contextFull && expanded.has(l.id) && (
                <div className="bl-full">{l.contextFull}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {mentions.length > 0 && (
        <div className="backlinks unlinked">
          <div className="bl-title">💬 未链接提及（{mentions.length}）</div>
          {mentions.map((m) => (
            <div key={m.id} className="bl-wrap">
              <button className="bl-item" onClick={() => onOpenBacklink(m.id, m.context ?? null)} title="点击跳转并定位提及行">
                <span className="bl-main">
                  <span className="ellipsis">{m.title}</span>
                  {m.context && <span className="bl-context ellipsis">{m.context}</span>}
                </span>
                <span className="bl-time">{relativeTime(m.updated_at)}</span>
              </button>
              <span className="bl-actions">
                <button
                  className="icon-btn bl-expand"
                  title={`把「${note.title}」转为 [[链接]]`}
                  onClick={() => linkifyMention(m)}
                >
                  🔗
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {versionsOpen && (
        <Modal title={`版本历史 · ${note.title || '无标题'}`} onClose={() => setVersionsOpen(false)} width={660}>
          {!versions.length && (
            <div className="side-hint" style={{ padding: 12 }}>暂无历史版本（修改标题或内容并保存后自动生成，保留最近 20 个）</div>
          )}
          {versions.map((v) => (
            <div key={v.id} className="ver-item">
              <div className="ver-head">
                <span className="ver-time">{formatFull(v.created_at)}</span>
                <span className="ver-title ellipsis">{v.title || '无标题'}</span>
                <button className="btn small" onClick={() => doRestoreVersion(v)}>恢复此版本</button>
              </div>
              <pre className="ver-content">{v.content.slice(0, 800)}{v.content.length > 800 ? '…' : ''}</pre>
            </div>
          ))}
        </Modal>
      )}
    </section>
  )
}
