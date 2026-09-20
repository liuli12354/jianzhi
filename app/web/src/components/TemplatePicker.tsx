import { useEffect, useState } from 'react'
import type { Note } from '../types'
import { api } from '../api'
import { excerpt } from '../utils'
import Modal from './Modal'

interface Props {
  onClose: () => void
  onPick: (tpl: Note) => void
}

const TEMPLATE_NOTEBOOK = '模板'

// v0.9 从模板新建：模板 = 「模板」笔记本中的笔记
export default function TemplatePicker({ onClose, onPick }: Props) {
  const [templates, setTemplates] = useState<Note[] | null>(null)
  const [notebookMissing, setNotebookMissing] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const nbs = await api.listNotebooks()
    const nb = nbs.find((n) => n.name === TEMPLATE_NOTEBOOK)
    if (!nb) {
      setNotebookMissing(true)
      setTemplates([])
      return
    }
    setNotebookMissing(false)
    setTemplates(await api.listNotes({ notebookId: nb.id, sort: 'title' }))
  }

  useEffect(() => {
    load().catch(() => setTemplates([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const createNotebook = async () => {
    setBusy(true)
    try {
      await api.createNotebook(TEMPLATE_NOTEBOOK)
      await load()
    } catch {
      /* toast 由上层处理？本组件自持：忽略 */
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="📄 从模板新建笔记" onClose={onClose} width={520}>
      {templates === null && <div className="side-hint" style={{ padding: 16 }}>加载中…</div>}
      {templates !== null && notebookMissing && (
        <div style={{ padding: 8 }}>
          <div className="side-hint" style={{ padding: '4px 8px 12px' }}>
            还没有「{TEMPLATE_NOTEBOOK}」笔记本。创建后，把任意笔记移动进去即可作为模板（支持 {'{{date}}'} / {'{{time}}'} 变量）。
          </div>
          <button className="btn primary small" disabled={busy} onClick={createNotebook}>
            创建「{TEMPLATE_NOTEBOOK}」笔记本
          </button>
        </div>
      )}
      {templates !== null && !notebookMissing && (
        <div className="task-groups">
          {!templates.length && (
            <div className="side-hint" style={{ padding: 16 }}>
              模板笔记本还是空的——把笔记移动到「{TEMPLATE_NOTEBOOK}」笔记本即可作为模板。
            </div>
          )}
          {templates.map((t) => (
            <button key={t.id} className="bl-item" onClick={() => onPick(t)} title="用这个模板新建笔记">
              <span className="bl-main">
                <span className="ellipsis">{t.title || '无标题'}</span>
                {excerpt(t.content, 40) && <span className="bl-context ellipsis">{excerpt(t.content, 40)}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
