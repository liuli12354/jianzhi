// 简知迁移测试：v0.1 形态的旧库 → v0.2 自动迁移（补列 / FTS 重建 / 数据保留）
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jianzhi-test-mig-'))
const dbFile = path.join(process.env.DATA_DIR, 'jianzhi.db')

before(async () => {
  // 预置一个 v0.1 形态的库（无 journal_date / 无 FTS / 无新表），并带一点旧数据
  const D = (await import('better-sqlite3')).default
  const raw = new D(dbFile)
  raw.exec(`
    CREATE TABLE notes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      notebook_id INTEGER,
      title       TEXT NOT NULL DEFAULT '无标题',
      content     TEXT NOT NULL DEFAULT '',
      pinned      INTEGER NOT NULL DEFAULT 0,
      starred     INTEGER NOT NULL DEFAULT 0,
      search_text TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      deleted_at  TEXT
    )
  `)
  raw.prepare('INSERT INTO notes (title, content, search_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('旧版笔记', '这是 v0.1 时代写入的恐龙知识。', '旧版笔记\n这是 v0.1 时代写入的恐龙知识。', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  raw.close()
})

after(async () => {
  // better-sqlite3 句柄不关闭时，Windows 会以 EBUSY 拒绝删除数据目录
  const { db } = await import('../src/db.js')
  try { db.close() } catch { /* 已关闭则忽略 */ }
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }) } catch { /* 忽略 */ }
})

test('旧库迁移：补列成功、旧数据保留、FTS 可检索', async () => {
  const store = await import('../src/db.js')

  // 旧数据保留
  const note = store.db.prepare('SELECT * FROM notes WHERE title = ?').get('旧版笔记')
  assert.ok(note, '旧笔记应保留')
  assert.equal(note.journal_date, null, '新列默认为 NULL')

  // FTS 建成且已回填旧数据
  const hit = store.db.prepare("SELECT rowid FROM notes_fts WHERE notes_fts MATCH '恐龙知识'").get()
  assert.ok(hit, '迁移后的 FTS 应能搜到旧数据')

  // 新功能可用：搜索 API / 每日笔记
  const r = store.searchNotes({ q: '恐龙知识' })
  assert.equal(r.mode, 'fts')
  assert.equal(r.total, 1)
  const j = store.getOrCreateJournalNote('2026-09-13')
  assert.ok(j.id > 0)
})
