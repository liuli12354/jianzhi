import { useEffect, useState } from 'react'
import type { AppSettings, BackupsResponse, Stats } from '../types'
import { api, downloadMarkdownZip } from '../api'
import { formatFull } from '../utils'
import Modal from './Modal'

interface Props {
  onClose: () => void
  onToast: (msg: string) => void
  onDataChanged: () => void
}

const fmtSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export default function SettingsModal({ onClose, onToast, onDataChanged }: Props) {
  const [info, setInfo] = useState<BackupsResponse | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const [res, st] = await Promise.all([api.listBackups(), api.stats()])
    setInfo(res)
    setDraft(res.settings)
    setStats(st)
  }

  useEffect(() => {
    load().catch((e) => onToast((e as Error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveSettings = async () => {
    if (!draft) return
    setBusy(true)
    try {
      await api.updateSettings({
        backupEnabled: draft.backupEnabled,
        backupIntervalHours: draft.backupIntervalHours,
        backupKeep: draft.backupKeep,
      })
      onToast('备份设置已保存')
      await load()
      onDataChanged()
    } catch (e) {
      onToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const createNow = async () => {
    setBusy(true)
    try {
      const b = await api.createBackup()
      onToast(`已创建备份 ${b.name}`)
      await load()
    } catch (e) {
      onToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const doRestore = async (name: string) => {
    if (!window.confirm(`恢复备份「${name}」？\n\n当前数据会先自动备份一份，然后被该备份覆盖。恢复完成后页面将刷新。`)) return
    setBusy(true)
    try {
      await api.restoreBackup(name)
      onToast('已恢复，页面即将刷新…')
      window.setTimeout(() => window.location.reload(), 800)
    } catch (e) {
      onToast((e as Error).message)
      setBusy(false)
    }
  }

  const doDelete = async (name: string) => {
    if (!window.confirm(`删除备份「${name}」？不可恢复。`)) return
    try {
      await api.deleteBackup(name)
      await load()
    } catch (e) {
      onToast((e as Error).message)
    }
  }

  const cleanup = async () => {
    setBusy(true)
    try {
      const r = await api.cleanupAttachments(true)
      onToast(r.removed > 0 ? `已清理 ${r.removed} 个孤儿附件，释放 ${fmtSize(r.bytes)}` : '没有需要清理的孤儿附件')
      await load()
      onDataChanged()
    } catch (e) {
      onToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="⚙️ 设置" onClose={onClose} width={640}>
      {!info || !draft ? (
        <div className="side-hint" style={{ padding: 16 }}>加载中…</div>
      ) : (
        <div className="settings">
          <section className="set-section">
            <div className="set-title">自动备份</div>
            <label className="set-row">
              <input
                type="checkbox"
                checked={draft.backupEnabled}
                onChange={(e) => setDraft({ ...draft, backupEnabled: e.target.checked })}
              />
              启用定时备份（服务端每 5 分钟巡检，到点自动执行）
            </label>
            <div className="set-row">
              <span>备份间隔</span>
              <input
                type="number"
                min={1}
                max={168}
                value={draft.backupIntervalHours}
                disabled={!draft.backupEnabled}
                onChange={(e) => setDraft({ ...draft, backupIntervalHours: Number(e.target.value) || 24 })}
              />
              小时
            </div>
            <div className="set-row">
              <span>保留份数</span>
              <input
                type="number"
                min={1}
                max={90}
                value={draft.backupKeep}
                disabled={!draft.backupEnabled}
                onChange={(e) => setDraft({ ...draft, backupKeep: Number(e.target.value) || 14 })}
              />
              份
            </div>
            <div className="set-actions">
              <button className="btn small" disabled={busy} onClick={saveSettings}>保存设置</button>
              <button className="btn primary small" disabled={busy} onClick={createNow}>立即备份</button>
              <span className="set-last">
                {draft.backupLastAt ? `上次备份：${formatFull(draft.backupLastAt)}` : '尚未备份过'}
              </span>
            </div>
          </section>

          <section className="set-section">
            <div className="set-title">备份记录（{info.backups.length}）</div>
            {!info.backups.length && <div className="side-hint">还没有备份，点「立即备份」创建第一份</div>}
            <div className="backup-list">
              {info.backups.map((b) => (
                <div key={b.name} className="backup-row">
                  <span className="bk-name ellipsis" title={b.name}>{b.name}</span>
                  <span className="bk-size">{fmtSize(b.size)}</span>
                  <span className="bk-time">{formatFull(b.created_at)}</span>
                  <span className="bk-actions">
                    <button className="btn ghost mini" disabled={busy} onClick={() => doRestore(b.name)}>恢复</button>
                    <a className="btn ghost mini" href={`/api/backups/${encodeURIComponent(b.name)}/download`}>下载</a>
                    <button className="btn ghost mini danger" disabled={busy} onClick={() => doDelete(b.name)}>删除</button>
                  </span>
                </div>
              ))}
            </div>
            <div className="set-note">备份目录：{info.dir}</div>
          </section>

          <section className="set-section">
            <div className="set-title">导出</div>
            <div className="set-row">
              <span>Markdown ZIP</span>
              <span className="set-val">按笔记本分目录 · 含引用附件</span>
              <button
                className="btn small"
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  downloadMarkdownZip()
                    .then(() => onToast('已导出 Markdown ZIP'))
                    .catch((e) => onToast((e as Error).message))
                    .finally(() => setBusy(false))
                }}
              >
                导出 .zip
              </button>
            </div>
            <div className="set-note">导出全部活跃笔记为 Markdown 文件（JSON 全量备份在顶栏「导出」）。</div>
          </section>

          <section className="set-section">
            <div className="set-title">存储</div>
            <div className="set-row">
              <span>附件</span>
              <span className="set-val">
                {stats ? `${stats.attachments.count} 个 · ${fmtSize(stats.attachments.bytes)}` : '…'}
              </span>
              <button className="btn small" disabled={busy} onClick={cleanup} title="删除未被任何笔记引用的附件文件">
                清理孤儿附件
              </button>
            </div>
            <div className="set-note">清理只会删除没有笔记引用的文件（上传后未保存进笔记的文件也在其列）。</div>
          </section>
        </div>
      )}
    </Modal>
  )
}
