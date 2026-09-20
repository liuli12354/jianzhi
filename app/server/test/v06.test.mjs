// 简知 v0.6 后端集成测试：未链接提及 / 任务聚合 / 标签管理
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jianzhi-v06-'))

const { buildApp } = await import('../src/app.js')

let server
let base

before(async () => {
  const app = buildApp()
  server = app.listen(0)
  base = `http://127.0.0.1:${server.address().port}/api`
})

after(() => { server?.close() })

const get = (url) => fetch(base + url)
const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const patch = (url, body) => fetch(base + url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const del = (url) => fetch(base + url, { method: 'DELETE' })
const j = (r) => r.json()

test('未链接提及：裸提及命中、已链接排除、无提及不误报', async () => {
  const target = await j(await post('/notes', { title: '增值税', content: '税种说明' }))
  await post('/notes', { title: '税务笔记', content: '明年起 增值税 税率有调整' })          // 裸提及
  await post('/notes', { title: '税法汇编', content: '参见 [[增值税]] 的章节' })            // 已链接
  await post('/notes', { title: '无关笔记', content: '今天天气不错' })                       // 无提及

  const d = await j(await get(`/notes/${target.id}/unlinked`))
  const ids = d.mentions.map((m) => m.title)
  assert.ok(ids.includes('税务笔记'), '裸提及应命中')
  assert.ok(!ids.includes('税法汇编'), '已链接排除')
  assert.ok(!ids.includes('无关笔记'), '无提及不误报')
  assert.ok(d.mentions[0].context.includes('增值税'), '上下文含提及行')

  // 已链接的出现在 backlinks
  const b = await j(await get(`/notes/${target.id}/backlinks`))
  assert.equal(b.links.length, 1)
  assert.equal(b.links[0].title, '税法汇编')
})

test('任务聚合：GFM 任务解析、回收站排除', async () => {
  const a = await j(await post('/notes', { title: '任务清单A', content: '普通行\n- [ ] 买牛奶\n- [x] 写周报\n* [ ] 另一种符号' }))
  await post('/notes', { title: '任务清单B', content: '1. [ ] 编号任务' })
  const trash = await j(await post('/notes', { title: '回收站任务', content: '- [ ] 不应出现' }))
  await del(`/notes/${trash.id}`)

  const d = await j(await get('/tasks'))
  const mine = d.tasks.filter((t) => t.noteTitle.startsWith('任务清单'))
  assert.equal(mine.length, 4, '三篇活跃笔记共 4 个任务')
  assert.ok(!d.tasks.some((t) => t.noteTitle === '回收站任务'), '回收站排除')

  const aTasks = mine.filter((t) => t.noteTitle === '任务清单A')
  assert.deepEqual(aTasks.map((t) => t.checked), [false, true, false], '勾选状态正确')
  assert.ok(aTasks.every((t) => Number.isInteger(t.lineIndex)), '行号存在')
  assert.ok(aTasks.some((t) => t.text === '买牛奶'), '文本解析正确')
  void a
})

test('标签管理：重命名 / 冲突合并 / 删除', async () => {
  const n1 = await j(await post('/notes', { title: '标签宿主一', content: 'c1', tags: ['旧名'] }))
  const n2 = await j(await post('/notes', { title: '标签宿主二', content: 'c2', tags: ['旧名'] }))

  // 找到标签 id
  let tags = await j(await get('/tags'))
  const oldTag = tags.find((t) => t.name === '旧名')
  assert.equal(oldTag.note_count, 2)

  // 重命名
  let r = await patch(`/tags/${oldTag.id}`, { name: '新名' })
  assert.equal(r.status, 200)
  tags = await j(await get('/tags'))
  assert.ok(tags.find((t) => t.name === '新名'), '新名生效')
  assert.ok(!tags.find((t) => t.name === '旧名'), '旧名消失')

  // 重命名到已存在名 → 合并
  const n3 = await j(await post('/notes', { title: '标签宿主三', content: 'c3', tags: ['新名'] }))
  await post('/notes', { title: '标签宿主四', content: 'c4', tags: ['合并目标'] })
  tags = await j(await get('/tags'))
  const src = tags.find((t) => t.name === '新名')
  const dst = tags.find((t) => t.name === '合并目标')
  r = await patch(`/tags/${src.id}`, { name: '合并目标' })
  assert.equal(r.status, 200)
  const merged = (await j(r)).merged
  assert.equal(merged, true, '报告合并语义')

  // 两笔记的引用并入目标标签
  const n1After = await j(await get(`/notes/${n1.id}`))
  const n2After = await j(await get(`/notes/${n2.id}`))
  const n3After = await j(await get(`/notes/${n3.id}`))
  assert.deepEqual(n1After.tags.map((t) => t.name), ['合并目标'])
  assert.deepEqual(n2After.tags.map((t) => t.name), ['合并目标'])
  assert.deepEqual(n3After.tags.map((t) => t.name), ['合并目标'])

  tags = await j(await get('/tags'))
  assert.ok(!tags.find((t) => t.name === '新名'), '源标签已删除')

  // 删除标签
  const dst2 = tags.find((t) => t.name === '合并目标')
  r = await del(`/tags/${dst2.id}`)
  assert.equal(r.status, 200)
  const n1Final = await j(await get(`/notes/${n1.id}`))
  assert.equal(n1Final.tags.length, 0, '删除后引用解除')
})

test('标签管理：非法输入', async () => {
  const n = await j(await post('/notes', { title: '标签校验', content: 'c', tags: ['校验'] }))
  const tags = await j(await get('/tags'))
  const t = tags.find((x) => x.name === '校验')

  let r = await patch(`/tags/${t.id}`, { name: '' })
  assert.equal(r.status, 400)
  r = await patch(`/tags/${t.id}`, { name: 'x'.repeat(50) })
  assert.equal(r.status, 400)
  r = await patch('/99999', { name: '不存在' })
  assert.equal(r.status, 404)
  void n
})
