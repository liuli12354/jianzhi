// 简知后端 API 集成测试（node:test + 原生 fetch，无需额外依赖）
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 必须在引入 app 之前设置独立数据目录，避免污染开发数据
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jianzhi-test-'))

const { buildApp } = await import('../src/app.js')

let server
let base

before(async () => {
  const app = buildApp()
  server = app.listen(0)
  base = `http://127.0.0.1:${server.address().port}/api`
})

after(async () => {
  server?.close()
  // better-sqlite3 句柄不关闭时，Windows 会以 EBUSY 拒绝删除数据目录
  const { db } = await import('../src/db.js')
  try { db.close() } catch { /* 已关闭则忽略 */ }
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }) } catch { /* 忽略清理失败 */ }
})

const j = (r) => r.json()
const get = (url) => fetch(base + url)
const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const patch = (url, body) => fetch(base + url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const del = (url) => fetch(base + url, { method: 'DELETE' })

let nb
let note
let note2

test('health 检查', async () => {
  const r = await get('/health')
  assert.equal(r.status, 200)
  const d = await j(r)
  assert.equal(d.ok, true)
})

test('笔记本：创建/更新/校验', async () => {
  let r = await post('/notebooks', { name: '工作' })
  assert.equal(r.status, 201)
  nb = await j(r)
  assert.ok(nb.id > 0)
  assert.equal(nb.name, '工作')

  r = await patch(`/notebooks/${nb.id}`, { name: '工作台', icon: '💼' })
  const nb2 = await j(r)
  assert.equal(nb2.name, '工作台')
  assert.equal(nb2.icon, '💼')

  r = await post('/notebooks', { name: '' })
  assert.equal(r.status, 400)
})

test('笔记：创建/自动标题/更新产生版本/版本恢复', async () => {
  let r = await post('/notes', { notebookId: nb.id, title: '会议纪要', content: '# 会议纪要\n\n本周讨论了 [[项目规划]] 的推进。' })
  assert.equal(r.status, 201)
  note = await j(r)
  assert.equal(note.title, '会议纪要')
  assert.equal(note.notebook_id, nb.id)

  // 无标题时存空字符串（前端会从正文首行派生标题）
  r = await post('/notes', { content: '随手记下的想法' })
  note2 = await j(r)
  assert.equal(note2.title, '')

  // 更新内容 → 自动保存历史版本
  r = await patch(`/notes/${note.id}`, { content: '第二次修改的内容' })
  const updated = await j(r)
  assert.equal(updated.content, '第二次修改的内容')

  r = await get(`/notes/${note.id}/versions`)
  const versions = await j(r)
  assert.equal(versions.length, 1)
  assert.equal(versions[0].content, '# 会议纪要\n\n本周讨论了 [[项目规划]] 的推进。')

  // 恢复到历史版本
  r = await post(`/notes/${note.id}/versions/${versions[0].id}/restore`)
  const restored = await j(r)
  assert.equal(restored.content, '# 会议纪要\n\n本周讨论了 [[项目规划]] 的推进。')
})

test('标签：设置/去重/统计/筛选/校验', async () => {
  let r = await post(`/notes/${note.id}/tags`, { tags: ['工作', '重要', '工作'] })
  const tagged = await j(r)
  assert.equal(tagged.tags.length, 2)

  r = await get('/tags')
  const tags = await j(r)
  assert.equal(tags.length, 2)
  assert.ok(tags.every((t) => t.note_count >= 1))

  r = await get(`/notes?tagId=${tags[0].id}`)
  const list = await j(r)
  assert.equal(list.length, 1)
  assert.equal(list[0].id, note.id)

  r = await post(`/notes/${note2.id}/tags`, { tags: '不是数组' })
  assert.equal(r.status, 400)
})

test('搜索：命中标题/内容，大小写不敏感', async () => {
  let r = await get('/notes?q=' + encodeURIComponent('会议'))
  let list = await j(r)
  assert.equal(list.length, 1)

  r = await get('/notes?q=' + encodeURIComponent('不存在的关键词xyz'))
  list = await j(r)
  assert.equal(list.length, 0)

  await patch(`/notes/${note2.id}`, { content: 'English keyword SearchTest here' })
  r = await get('/notes?q=searchtest')
  list = await j(r)
  assert.equal(list.length, 1)
  assert.equal(list[0].id, note2.id)
})

test('置顶与收藏', async () => {
  await patch(`/notes/${note.id}`, { pinned: 1, starred: 1 })
  const r = await get('/notes?status=starred')
  const list = await j(r)
  assert.equal(list.length, 1)
  assert.equal(list[0].id, note.id)
})

test('反向链接：[[标题]] 引用检测', async () => {
  await patch(`/notes/${note2.id}`, { content: '参考 [[会议纪要]] 的结论' })
  const r = await get(`/notes/${note.id}/backlinks`)
  const d = await j(r)
  assert.ok(d.links.some((l) => l.id === note2.id))
})

test('按标题解析（双链跳转）', async () => {
  const r = await get('/resolve?title=' + encodeURIComponent('会议纪要'))
  const d = await j(r)
  assert.equal(d.id, note.id)

  const r2 = await get('/resolve?title=' + encodeURIComponent('绝不存在的标题'))
  assert.equal(await j(r2), null)
})

test('回收站：软删除/恢复/彻底删除', async () => {
  await del(`/notes/${note2.id}`)
  let r = await get('/notes?status=trash')
  let list = await j(r)
  assert.equal(list.length, 1)
  assert.equal(list[0].id, note2.id)

  r = await get('/notes')
  list = await j(r)
  assert.ok(!list.some((n) => n.id === note2.id))

  await post(`/notes/${note2.id}/restore`)
  r = await get('/notes')
  list = await j(r)
  assert.ok(list.some((n) => n.id === note2.id))

  await del(`/notes/${note2.id}?purge=1`)
  r = await get('/notes?status=trash')
  assert.equal((await j(r)).length, 0)
})

test('删除笔记本后其笔记保留（notebook_id 置空）', async () => {
  const r0 = await post('/notebooks', { name: '临时本' })
  const tmpNb = await j(r0)
  const r1 = await post('/notes', { notebookId: tmpNb.id, title: '临时笔记' })
  const tmpNote = await j(r1)

  await del(`/notebooks/${tmpNb.id}`)
  const r2 = await get(`/notes/${tmpNote.id}`)
  const d = await j(r2)
  assert.equal(d.notebook_id, null)
  await del(`/notes/${d.id}?purge=1`)
})

test('导入与导出', async () => {
  const r = await post('/import', {
    notes: [
      { title: '导入一', content: '内容一', tags: ['导入'] },
      { title: '导入二', content: '内容二' },
    ],
  })
  const d = await j(r)
  assert.equal(d.imported, 2)

  const r2 = await get('/export')
  const data = await j(r2)
  assert.ok(data.notes.length >= 3)
  assert.ok(data.notebooks.length >= 1)
  const imported = data.notes.find((n) => n.title === '导入一')
  assert.deepEqual(imported.tags, ['导入'])
})

test('清空回收站与统计', async () => {
  const r1 = await post('/notes', { title: '待删甲' })
  const a = await j(r1)
  const r2 = await post('/notes', { title: '待删乙' })
  const b = await j(r2)
  await del(`/notes/${a.id}`)
  await del(`/notes/${b.id}`)
  await del('/trash')

  const r3 = await get('/notes?status=trash')
  assert.equal((await j(r3)).length, 0)

  const r4 = await get('/stats')
  const s = await j(r4)
  assert.ok(s.total >= 1)
  assert.ok(s.notebooks >= 1)
  assert.ok(s.tags >= 2)
})

test('404 与错误输入', async () => {
  const r = await get('/notes/99999')
  assert.equal(r.status, 404)

  const r2 = await patch('/notes/99999', { title: 'x' })
  assert.equal(r2.status, 404)

  const r3 = await post('/notes', { notebookId: 99999, title: 'x' })
  assert.equal(r3.status, 400)

  const r4 = await get('/api-not-exist')
  assert.equal(r4.status, 404)
})
