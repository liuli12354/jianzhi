import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { Note, NoteTab, Notebook, SortKey, Stats, Tag, View } from './types'
import { api, downloadJsonBackup, downloadMarkdownZip, exportNoteAsHtml } from './api'
import Sidebar from './components/Sidebar'
import NoteList from './components/NoteList'
import Editor from './components/Editor'
import SearchModal from './components/SearchModal'
import GraphModal from './components/GraphModal'
import SettingsModal from './components/SettingsModal'
import CommandPalette from './components/CommandPalette'
import TasksModal from './components/TasksModal'
import TemplatePicker from './components/TemplatePicker'
import QuickCapture, { parseQuickTags } from './components/QuickCapture'
import DayDetailModal from './components/DayDetailModal'
import type { CommandAction } from './components/CommandPalette'
import Modal from './components/Modal'

export default function App() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [view, setView] = useState<View>({ kind: 'all' })
  const [sort, setSort] = useState<SortKey>('updated')
  const [currentId, setCurrentId] = useState<number | null>(null)
  const [current, setCurrent] = useState<Note | null>(null)
  const [loadingCurrent, setLoadingCurrent] = useState(false)
  const [tabs, setTabs] = useState<NoteTab[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('note-tabs-v1') ?? 'null')
      return Array.isArray(v?.tabs) ? v.tabs.filter((t: NoteTab) => t && typeof t.id === 'number') : []
    } catch {
      return []
    }
  })
  const storedActiveId = useMemo(() => {
    try {
      const v = JSON.parse(localStorage.getItem('note-tabs-v1') ?? 'null')
      return typeof v?.activeId === 'number' ? v.activeId : null
    } catch {
      return null
    }
  }, [])
  // 刷新恢复：激活上次的标签（笔记已删则移除该签）
  const didRestoreTabs = useRef(false)
  useEffect(() => {
    if (didRestoreTabs.current) return
    didRestoreTabs.current = true
    if (storedActiveId != null) {
      openNote(storedActiveId).catch(() => {
        setTabs((ts) => ts.filter((t) => t.id !== storedActiveId))
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [searchOpen, setSearchOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [graphOpen, setGraphOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tasksOpen, setTasksOpen] = useState(false)
  const [tplOpen, setTplOpen] = useState(false)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [toast, setToast] = useState<{ msg: string; action?: { label: string; run: () => void } } | null>(null)
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null)
  const confirmResolver = useRef<((ok: boolean) => void) | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const showToast = useCallback((msg: string, action?: { label: string; run: () => void }) => {
    setToast({ msg, action })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), action ? 5000 : 2400)
  }, [])

  const askConfirm = useCallback(
    (msg: string) =>
      new Promise<boolean>((resolve) => {
        confirmResolver.current = resolve
        setConfirmMsg(msg)
      }),
    [],
  )
  const settleConfirm = (ok: boolean) => {
    confirmResolver.current?.(ok)
    confirmResolver.current = null
    setConfirmMsg(null)
  }

  const refreshMeta = useCallback(async () => {
    const [nbs, tgs, st] = await Promise.all([api.listNotebooks(), api.listTags(), api.stats()])
    setNotebooks(nbs)
    setTags(tgs)
    setStats(st)
  }, [])

  const refreshNotes = useCallback(async () => {
    const params: Record<string, string | number | undefined> = {}
    if (view.kind === 'trash') {
      params.status = 'trash'
    } else {
      if (view.kind === 'starred') params.status = 'starred'
      if (view.kind === 'notebook') params.notebookId = view.notebookId
      if (view.kind === 'tag') params.tagId = view.tagId
      params.sort = sort
    }
    setNotes(await api.listNotes(params))
  }, [view, sort])

  useEffect(() => {
    refreshMeta().catch((e) => showToast((e as Error).message))
  }, [refreshMeta, showToast])

  useEffect(() => {
    refreshNotes().catch((e) => showToast('加载列表失败：' + (e as Error).message))
  }, [refreshNotes, showToast])

  // ---- 当前笔记 ----
  // v0.8 多标签页：打开即建签、保存同步标题
  const ensureTab = useCallback((id: number, title: string) => {
    setTabs((ts) => (ts.some((t) => t.id === id) ? ts : [...ts, { id, title }]))
  }, [])

  const openNote = useCallback(
    async (id: number) => {
      setCurrentId(id)
      setLoadingCurrent(true)
      try {
        const note = await api.getNote(id)
        setCurrent(note)
        ensureTab(id, note.title || '无标题')
      } catch (e) {
        showToast(`打开失败：${(e as Error).message}`)
      } finally {
        setLoadingCurrent(false)
      }
    },
    [ensureTab, showToast],
  )

  const closeTab = useCallback(
    async (id: number) => {
      const t = tabs.find((x) => x.id === id)
      if (t?.pinned) {
        const ok = await askConfirm(`关闭固定的标签「${t.title}」？`)
        if (!ok) return
      }
      const idx = tabs.findIndex((x) => x.id === id)
      const next = tabs.filter((x) => x.id !== id)
      setTabs(next)
      if (id === currentId) {
        if (next.length) {
          const act = next[Math.min(idx, next.length - 1)]
          openNote(act.id)
        } else {
          setCurrent(null)
          setCurrentId(null)
        }
      }
    },
    [tabs, currentId, openNote, askConfirm],
  )

  // v0.9 标签页固定 / 拖拽排序 / 持久化
  const togglePinTab = useCallback((id: number) => {
    setTabs((ts) => {
      const t = ts.find((x) => x.id === id)
      if (!t) return ts
      const updated = { ...t, pinned: !t.pinned }
      const others = ts.filter((x) => x.id !== id)
      return updated.pinned ? [updated, ...others] : [...others, updated]
    })
  }, [])

  const moveTab = useCallback((id: number, insertAt: number) => {
    setTabs((ts) => {
      const from = ts.findIndex((t) => t.id === id)
      if (from === -1) return ts
      const next = [...ts]
      const [item] = next.splice(from, 1)
      next.splice(Math.max(0, Math.min(next.length, insertAt)), 0, item)
      return next
    })
  }, [])

  useEffect(() => {
    localStorage.setItem('note-tabs-v1', JSON.stringify({ tabs, activeId: currentId }))
  }, [tabs, currentId])

  const createNote = useCallback(async () => {
    const notebookId = view.kind === 'notebook' ? view.notebookId : null
    const note = await api.createNote({ notebookId, title: '', content: '' })
    await Promise.all([refreshNotes(), refreshMeta()])
    setCurrent(note)
    setCurrentId(note.id)
    ensureTab(note.id, note.title || '无标题')
    return note
  }, [view, refreshNotes, refreshMeta, ensureTab])

  const saveNote = useCallback(
    async (id: number, patch: Record<string, unknown>) => {
      const updated = await api.updateNote(id, patch)
      setCurrent((prev) => (prev && prev.id === id ? updated : prev))
      setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, title: updated.title || '无标题' } : t)))
      refreshNotes().catch(() => {})
      refreshMeta().catch(() => {})
      return updated
    },
    [refreshNotes, refreshMeta],
  )

  // ---- 删除 / 恢复 ----
  const purgeNote = useCallback(
    async (note: Note) => {
      const ok = await askConfirm(`彻底删除「${note.title || '无标题'}」？该操作不可恢复，建议先导出备份。`)
      if (!ok) return
      await api.purgeNote(note.id)
      showToast('已彻底删除')
      setTabs((ts) => ts.filter((t) => t.id !== note.id))
      if (currentId === note.id) {
        setCurrent(null)
        setCurrentId(null)
      }
      await Promise.all([refreshNotes(), refreshMeta()])
    },
    [askConfirm, currentId, refreshNotes, refreshMeta, showToast],
  )

  const deleteNote = useCallback(
    async (note: Note) => {
      if (note.deleted_at) {
        await purgeNote(note)
        return
      }
      const ok = await askConfirm(`确定将「${note.title || '无标题'}」移入回收站吗？`)
      if (!ok) return
      await api.deleteNote(note.id)
      showToast('已移入回收站', {
        label: '撤销',
        run: () => {
          api.restoreNote(note.id)
            .then(async () => {
              await Promise.all([refreshNotes(), refreshMeta()])
              showToast('已撤销')
            })
            .catch((e) => showToast((e as Error).message))
        },
      })
      setTabs((ts) => ts.filter((t) => t.id !== note.id))
      if (currentId === note.id) {
        setCurrent(null)
        setCurrentId(null)
      }
      await Promise.all([refreshNotes(), refreshMeta()])
    },
    [askConfirm, currentId, purgeNote, refreshNotes, refreshMeta, showToast],
  )

  const restoreNote = useCallback(
    async (note: Note) => {
      await api.restoreNote(note.id)
      showToast('已恢复')
      await Promise.all([refreshNotes(), refreshMeta()])
    },
    [refreshNotes, refreshMeta, showToast],
  )

  const emptyTrash = useCallback(async () => {
    const ok = await askConfirm('清空回收站？其中所有笔记将被彻底删除，不可恢复。')
    if (!ok) return
    await api.emptyTrash()
    showToast('回收站已清空')
    await Promise.all([refreshNotes(), refreshMeta()])
  }, [askConfirm, refreshNotes, refreshMeta, showToast])

  // ---- 置顶 / 收藏 ----
  const toggleFlag = useCallback(
    async (note: Note, field: 'pinned' | 'starred') => {
      await api.updateNote(note.id, { [field]: !note[field] })
      await Promise.all([refreshNotes(), refreshMeta()])
      if (currentId === note.id) setCurrent(await api.getNote(note.id))
    },
    [currentId, refreshNotes, refreshMeta],
  )
  const togglePin = useCallback((n: Note) => { toggleFlag(n, 'pinned') }, [toggleFlag])
  const toggleStar = useCallback((n: Note) => { toggleFlag(n, 'starred') }, [toggleFlag])

  // ---- 笔记本 ----
  const createNotebook = useCallback(
    async (name: string, parentId: number | null = null) => {
      await api.createNotebook(name, parentId)
      await refreshMeta()
      showToast(`已创建笔记本「${name}」`)
    },
    [refreshMeta, showToast],
  )

  // v0.3 层级：拖拽嵌套 / 提升 / 兄弟排序（v0.7 支持撤销）
  const moveNotebook = useCallback(
    async (id: number, parentId: number | null, position?: number) => {
      const prev = notebooks.find((n) => n.id === id)
      try {
        await api.updateNotebook(id, { parentId, position })
        await refreshMeta()
        if (prev) {
          // 原兄弟序列（含自身）中的下标 = 撤销时按剩余兄弟计算的位置
          const prevSiblings = notebooks
            .filter((n) => (n.parent_id ?? null) === (prev.parent_id ?? null))
            .sort((a, b) => a.sort_order - b.sort_order)
          const prevIndex = prevSiblings.findIndex((n) => n.id === id)
          showToast('已移动笔记本', {
            label: '撤销',
            run: () => {
              api.updateNotebook(id, { parentId: prev.parent_id, position: Math.max(0, prevIndex) })
                .then(() => refreshMeta())
                .catch((e) => showToast((e as Error).message))
            },
          })
        }
      } catch (e) {
        showToast((e as Error).message)
      }
    },
    [notebooks, refreshMeta, showToast],
  )

  const renameNotebook = useCallback(
    async (id: number, name: string) => {
      await api.updateNotebook(id, { name })
      await refreshMeta()
    },
    [refreshMeta],
  )

  const deleteNotebook = useCallback(
    async (nb: Notebook) => {
      const ok = await askConfirm(`删除笔记本「${nb.name}」？其中的 ${nb.note_count} 篇笔记会保留，只是不再归属任何笔记本。`)
      if (!ok) return
      await api.deleteNotebook(nb.id)
      setView((v) => (v.kind === 'notebook' && v.notebookId === nb.id ? { kind: 'all' } : v))
      await Promise.all([refreshNotes(), refreshMeta()])
      showToast('笔记本已删除')
    },
    [askConfirm, refreshNotes, refreshMeta, showToast],
  )

  // ---- 导入 / 导出 ----
  const onImportFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!files.length) return
    try {
      const payload = await Promise.all(
        files.map(async (f) => ({
          title: f.name.replace(/\.(md|markdown|txt)$/i, ''),
          content: await f.text(),
        })),
      )
      const { imported } = await api.importNotes(payload)
      showToast(`已导入 ${imported} 篇笔记`)
      await Promise.all([refreshNotes(), refreshMeta()])
    } catch (err) {
      showToast((err as Error).message)
    }
  }

  const onExportAll = () => {
    downloadJsonBackup()
      .then(() => showToast('已导出全部数据（JSON 备份）'))
      .catch((e) => showToast((e as Error).message))
  }

  // ---- 双链跳转 ----
  const openByTitle = useCallback(
    async (title: string) => {
      const t = title.trim()
      if (!t) return
      try {
        const hit = await api.resolveTitle(t)
        if (!hit) {
          showToast(`未找到标题为「${t}」的笔记`)
          return
        }
        setView({ kind: 'all' })
        await openNote(hit.id)
      } catch (e) {
        showToast((e as Error).message)
      }
    },
    [openNote, showToast],
  )

  // v0.4 反链定位：打开笔记并滚动到引用行（state 下发，Editor 挂载后执行）
  const [locateReq, setLocateReq] = useState<{ noteId: number; text: string; seq: number } | null>(null)
  const openBacklink = useCallback(
    async (id: number, context: string | null) => {
      setView({ kind: 'all' })
      await openNote(id)
      setLocateReq({ noteId: id, text: context ?? '', seq: Date.now() })
    },
    [openNote],
  )

  // v0.6 标签管理：重命名（重名即合并）与删除
  const renameTag = useCallback(
    async (id: number, name: string) => {
      try {
        const r = await api.renameTag(id, name)
        await refreshMeta()
        showToast(r.merged ? `已合并到「${r.tag.name}」` : `已重命名为「${r.tag.name}」`)
      } catch (e) {
        showToast((e as Error).message)
      }
    },
    [refreshMeta, showToast],
  )
  const deleteTag = useCallback(
    async (tag: Tag) => {
      const ok = await askConfirm(`删除标签「${tag.name}」？${tag.note_count} 篇笔记的该标签引用将被解除（笔记本身不受影响）。`)
      if (!ok) return
      try {
        await api.deleteTag(tag.id)
        await refreshMeta()
        showToast('标签已删除')
      } catch (e) {
        showToast((e as Error).message)
      }
    },
    [askConfirm, refreshMeta, showToast],
  )

  // v0.6 任务汇总定位：打开笔记并滚动到任务行
  const openTask = useCallback(
    async (noteId: number, line: string) => {
      setTasksOpen(false)
      setView({ kind: 'all' })
      await openNote(noteId)
      setLocateReq({ noteId, text: line, seq: Date.now() })
    },
    [openNote],
  )

  // v0.9 从模板新建：{{date}}/{{time}}/{{title}} 变量替换
  const createFromTemplate = useCallback(
    async (tpl: Note) => {
      setTplOpen(false)
      const now = new Date()
      const p = (n: number) => String(n).padStart(2, '0')
      const dateStr = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
      const timeStr = `${p(now.getHours())}:${p(now.getMinutes())}`
      const notebookId = view.kind === 'notebook' ? view.notebookId : null
      const content = tpl.content
        .replace(/\{\{date\}\}/g, dateStr)
        .replace(/\{\{time\}\}/g, timeStr)
        .replace(/\{\{title\}\}/g, '')
      // 标题从首行派生（去掉 # 与双链符号），避免模板笔记初始显示「无标题」
      const firstLine = content.split('\n').find((l) => l.trim()) ?? ''
      const title = firstLine.replace(/^#+\s*/, '').replace(/\[\[|\]\]/g, '').trim().slice(0, 60)
      const note = await api.createNote({ notebookId, title, content })
      await Promise.all([refreshNotes(), refreshMeta()])
      setCurrent(note)
      setCurrentId(note.id)
      ensureTab(note.id, note.title || '无标题')
      showToast(`已从模板「${tpl.title || '无标题'}」创建`)
    },
    [view, refreshNotes, refreshMeta, ensureTab, showToast],
  )

  // v1.0 快速捕获：保存到未分类，开头 #标签 自动归类（v1.1 支持写入今日日记）
  const saveQuickCapture = useCallback(
    async (text: string) => {
      const tags = parseQuickTags(text)
      const note = await api.createNote({ title: '', content: text, tags })
      await Promise.all([refreshNotes(), refreshMeta()])
      showToast(`已保存${tags.length ? `（标签 ${tags.map((t) => `#${t}`).join(' ')}）` : ''}`)
      void note
    },
    [refreshNotes, refreshMeta, showToast],
  )

  const saveQuickToJournal = useCallback(
    async (text: string) => {
      const { note } = await api.journalToday()
      const d = new Date()
      const p = (n: number) => String(n).padStart(2, '0')
      const stamp = `${p(d.getHours())}:${p(d.getMinutes())}`
      const block = `\n\n## ⚡ ${stamp}\n\n${text.trim()}\n`
      const content = note.content.trim() ? note.content + block : block.trim()
      await api.updateNote(note.id, { content })
      await Promise.all([refreshNotes(), refreshMeta()])
      showToast('已写入今日日记')
    },
    [refreshNotes, refreshMeta, showToast],
  )

  // v1.1 日历当日详情
  const [dayOpen, setDayOpen] = useState<string | null>(null)
  const openDayDetail = useCallback((date: string) => setDayOpen(date), [])

  // v0.5 随机漫游
  const openRandom = useCallback(async () => {
    try {
      const { note } = await api.getRandomNote()
      if (!note) {
        showToast('还没有笔记可以漫游')
        return
      }
      setView({ kind: 'all' })
      await openNote(note.id)
    } catch (e) {
      showToast((e as Error).message)
    }
  }, [openNote, showToast])

  // v0.5 笔记拖拽换笔记本（v0.7 支持撤销）
  const moveNoteToNotebook = useCallback(
    async (noteId: number, notebookId: number | null) => {
      try {
        const cur = await api.getNote(noteId)
        const prevNb = cur.notebook_id
        const nbName = notebookId == null ? '未分类' : notebooks.find((n) => n.id === notebookId)?.name ?? '笔记本'
        await api.updateNote(noteId, { notebookId })
        await Promise.all([refreshNotes(), refreshMeta()])
        showToast(`已移动到「${nbName}」`, {
          label: '撤销',
          run: () => {
            moveNoteToNotebook(noteId, prevNb)
          },
        })
      } catch (e) {
        showToast((e as Error).message)
      }
    },
    [notebooks, refreshNotes, refreshMeta, showToast],
  )

  // ---- 每日笔记 ----
  const openJournal = useCallback(
    async (date?: string) => {
      try {
        const { note } = date ? await api.journalOpen(date) : await api.journalToday()
        setView({ kind: 'all' })
        await Promise.all([refreshNotes(), refreshMeta()])
        await openNote(note.id)
      } catch (e) {
        showToast((e as Error).message)
      }
    },
    [openNote, refreshNotes, refreshMeta, showToast],
  )

  // document.title 跟随当前笔记（v0.4）
  useEffect(() => {
    document.title = current ? `${current.title || '无标题'} · 简知` : '简知 · 个人知识库'
  }, [current])

  // ---- 全局快捷键 ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
      if (mod && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setPaletteOpen(true)
      }
      if (e.altKey && e.key.toLowerCase() === 'w' && currentId != null) {
        e.preventDefault()
        closeTab(currentId)
      }
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        createNote().catch((err) => showToast((err as Error).message))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [createNote, showToast, currentId, closeTab])

  // ---- 主题 ----
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  )
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.dataset.theme = next
    localStorage.setItem('theme', next)
  }

  // ---- 命令面板动作注册表（Ctrl+P） ----
  const paletteActions = useMemo<CommandAction[]>(() => [
    { id: 'new-note', title: '新建笔记', kbd: 'Ctrl N', run: () => { createNote().catch((e) => showToast((e as Error).message)) } },
    { id: 'quick-capture', title: '快速记录一条', run: () => setCaptureOpen(true) },
    { id: 'new-from-template', title: '从模板新建笔记', run: () => setTplOpen(true) },
    { id: 'journal-today', title: '打开今日笔记', run: () => { openJournal().catch((e) => showToast((e as Error).message)) } },
    { id: 'random-roam', title: '随机漫游一篇笔记', run: () => { openRandom().catch((e) => showToast((e as Error).message)) } },
    { id: 'open-tasks', title: '打开任务汇总', run: () => setTasksOpen(true) },
    { id: 'export-note-html', title: '导出当前笔记为 HTML', run: () => { if (current) { exportNoteAsHtml(current); showToast('已导出 HTML') } else showToast('先打开一篇笔记') } },
    { id: 'open-search', title: '全局搜索内容', kbd: 'Ctrl K', run: () => setSearchOpen(true) },
    { id: 'view-all', title: '查看全部笔记', run: () => setView({ kind: 'all' }) },
    { id: 'view-starred', title: '查看收藏', run: () => setView({ kind: 'starred' }) },
    { id: 'view-trash', title: '查看回收站', run: () => setView({ kind: 'trash' }) },
    { id: 'graph', title: '打开知识图谱', run: () => setGraphOpen(true) },
    { id: 'settings', title: '打开设置', run: () => setSettingsOpen(true) },
    { id: 'export-json', title: '导出 JSON 备份', run: () => { downloadJsonBackup().then(() => showToast('已导出全部数据')).catch((e) => showToast((e as Error).message)) } },
    { id: 'export-md-zip', title: '导出 Markdown ZIP（全库）', run: () => { downloadMarkdownZip().then(() => showToast('已导出 Markdown ZIP')).catch((e) => showToast((e as Error).message)) } },
    { id: 'toggle-theme', title: '切换深色 / 浅色主题', run: () => toggleTheme() },
    { id: 'empty-trash', title: '清空回收站', run: () => { emptyTrash().catch(() => {}) } },
  ], [createNote, openJournal, openRandom, emptyTrash, showToast, toggleTheme, current])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          📒 简知 <span className="brand-sub">个人知识库</span>
        </div>
        <button className="search-trigger" onClick={() => setSearchOpen(true)}>
          🔍 搜索笔记… <kbd>Ctrl K</kbd>
        </button>
        <div className="topbar-actions">
          <button className="btn ghost" onClick={() => openJournal()} title="打开今天的日记">
            📅 今日
          </button>
          <button className="btn ghost" onClick={() => setCaptureOpen(true)} title="快速记录一条（Ctrl+Enter 保存）">
            ⚡ 记录
          </button>
          <button className="btn ghost" onClick={() => openRandom()} title="随机漫游一篇笔记">
            🎲 随机
          </button>
          <button className="btn ghost" onClick={() => setTasksOpen(true)} title="全库任务汇总">
            ✅ 任务
          </button>
          <button className="btn ghost" onClick={() => setGraphOpen(true)} title="按双向链接查看知识图谱">
            🕸 图谱
          </button>
          <label className="btn ghost" title="导入 .md / .txt 文件">
            导入
            <input type="file" accept=".md,.markdown,.txt" multiple hidden onChange={onImportFiles} />
          </label>
          <button className="btn ghost" onClick={onExportAll} title="导出全部数据为 JSON 备份">
            导出
          </button>
          <button className="btn ghost" onClick={toggleTheme} title="切换浅色 / 深色主题">
            {theme === 'dark' ? '☀️ 浅色' : '🌙 深色'}
          </button>
          <button className="btn ghost" onClick={() => setSettingsOpen(true)} title="备份与设置">
            ⚙️ 设置
          </button>
        </div>
      </header>

      {tabs.length > 0 && (
        <div className="tabbar">
          {tabs.map((t) => (
            <div
              key={t.id}
              className={`note-tab ${t.id === currentId ? 'active' : ''} ${t.pinned ? 'pinned' : ''}`}
              onClick={() => openNote(t.id)}
              onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.id) } }}
              onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(t.id)) }}
              onDragOver={(e) => { e.preventDefault() }}
              onDrop={(e) => {
                e.preventDefault()
                const id = Number(e.dataTransfer.getData('text/plain'))
                if (!Number.isFinite(id) || id === t.id) return
                const from = tabs.findIndex((x) => x.id === id)
                const to = tabs.findIndex((x) => x.id === t.id)
                if (from === -1 || to === -1) return
                moveTab(id, from < to ? to - 1 : to)
              }}
              title={t.title}
            >
              {t.pinned && <span className="tab-pin-mark" title="已固定">📌</span>}
              <span className="ellipsis">{t.title}</span>
              <span className="tab-ops" onClick={(e) => e.stopPropagation()}>
                <button className="tab-pin" title={t.pinned ? '取消固定' : '固定标签页'} onClick={() => togglePinTab(t.id)}>📍</button>
                <button className="tab-close" title="关闭标签页（中键点击或 Alt+W）" onClick={() => closeTab(t.id)}>×</button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="main">
        <Sidebar
          notebooks={notebooks}
          tags={tags}
          stats={stats}
          view={view}
          onSelectView={setView}
          onCreateNotebook={createNotebook}
          onRenameNotebook={renameNotebook}
          onMoveNotebook={moveNotebook}
          onDeleteNotebook={deleteNotebook}
          onOpenJournal={(d) => openJournal(d)}
          onDropNote={moveNoteToNotebook}
          onRenameTag={renameTag}
          onDeleteTag={deleteTag}
          onOpenDay={openDayDetail}
        />
        <NoteList
          notes={notes}
          view={view}
          notebooks={notebooks}
          tags={tags}
          sort={sort}
          onSortChange={setSort}
          currentId={currentId}
          onSelect={openNote}
          onCreate={() => createNote().catch((e) => showToast((e as Error).message))}
          onCreateFromTemplate={() => setTplOpen(true)}
          onTogglePin={togglePin}
          onToggleStar={toggleStar}
          onRestore={restoreNote}
          onPurge={purgeNote}
          onDelete={deleteNote}
          onEmptyTrash={emptyTrash}
        />
        <Editor
          key={current?.id ?? 'none'}
          note={current}
          loading={loadingCurrent}
          notebooks={notebooks}
          onSave={saveNote}
          onOpenTitle={openByTitle}
          onOpenBacklink={openBacklink}
          locateReq={locateReq}
          onDelete={deleteNote}
          onToast={showToast}
        />
      </div>

      {searchOpen && (
        <SearchModal
          notebooks={notebooks}
          tags={tags}
          onClose={() => setSearchOpen(false)}
          onOpen={async (id, locateText) => {
            setSearchOpen(false)
            setView({ kind: 'all' })
            await openNote(id)
            if (locateText) setLocateReq({ noteId: id, text: locateText, seq: Date.now() })
          }}
        />
      )}

      {paletteOpen && (
        <CommandPalette
          actions={paletteActions}
          notes={notes}
          onClose={() => setPaletteOpen(false)}
          onOpenNote={async (id) => {
            setPaletteOpen(false)
            setView({ kind: 'all' })
            await openNote(id)
          }}
        />
      )}

      {graphOpen && (
        <GraphModal
          notebooks={notebooks}
          onClose={() => setGraphOpen(false)}
          onOpenNote={async (id) => {
            setGraphOpen(false)
            setView({ kind: 'all' })
            await openNote(id)
          }}
        />
      )}

      {tasksOpen && (
        <TasksModal
          onClose={() => setTasksOpen(false)}
          onOpenTask={openTask}
          onToast={showToast}
          onDataChanged={() => { refreshNotes().catch(() => {}); refreshMeta().catch(() => {}) }}
        />
      )}

      {tplOpen && (
        <TemplatePicker
          onClose={() => setTplOpen(false)}
          onPick={(tpl) => createFromTemplate(tpl).catch((e) => showToast((e as Error).message))}
        />
      )}

      {captureOpen && (
        <QuickCapture onClose={() => setCaptureOpen(false)} onSave={saveQuickCapture} onSaveToJournal={saveQuickToJournal} />
      )}

      {dayOpen && (
        <DayDetailModal
          date={dayOpen}
          onClose={() => setDayOpen(null)}
          onOpenTask={async (noteId, line) => {
            setDayOpen(null)
            setView({ kind: 'all' })
            await openNote(noteId)
            setLocateReq({ noteId, text: line, seq: Date.now() })
          }}
          onOpenJournal={() => {
            setDayOpen(null)
            openJournal(dayOpen)
          }}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onToast={showToast}
          onDataChanged={() => { refreshMeta().catch(() => {}) }}
        />
      )}

      {confirmMsg && (
        <Modal title="请确认" onClose={() => settleConfirm(false)} width={460}>
          <p className="confirm-text">{confirmMsg}</p>
          <div className="confirm-actions">
            <button className="btn" onClick={() => settleConfirm(false)}>取消</button>
            <button className="btn primary" onClick={() => settleConfirm(true)}>确定</button>
          </div>
        </Modal>
      )}

      {toast && (
        <div className="toast">
          {toast.msg}
          {toast.action && (
            <button
              className="toast-action"
              onClick={() => {
                const a = toast.action
                if (!a) return
                setToast(null)
                a.run()
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
