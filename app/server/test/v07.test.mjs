// 简知 v0.7 后端集成测试：任务勾选回写 / 提及一键转链 / 未链接提及跳过代码块
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jianzhi-v07-'))

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

const get = (url) => fetch(base + url)
const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const j = (r) => r.json()

test('任务勾选回写：翻转内容、生成版本快照、漂移校验', async () => {
  const n = await j(await post('/notes', { title: 'V07任务', content: '前言\n- [ ] 买牛奶\n- [x] 写周报' }))

  // 翻转第 1 行为已完成
  let r = await post(`/notes/${n.id}/task-toggle`, { lineIndex: 1, checked: true, line: '- [ ] 买牛奶' })
  assert.equal(r.status, 200)
  const updated = (await j(r)).note
  assert.equal(updated.content, '前言\n- [x] 买牛奶\n- [x] 写周报', '仅目标行翻转，其余原样')

  // 版本快照生成（内容变化）
  const versions = await j(await get(`/notes/${n.id}/versions`))
  assert.ok(versions.length >= 1, '回写产生版本快照')

  // 内容漂移 → 400
  r = await post(`/notes/${n.id}/task-toggle`, { lineIndex: 1, checked: false, line: '- [ ] 买牛奶' })
  assert.equal(r.status, 400, '漂移行被拒绝')

  // 非任务行 → 400
  r = await post(`/notes/${n.id}/task-toggle`, { lineIndex: 0, checked: true, line: '前言' })
  assert.equal(r.status, 400)

  // 行号越界 → 400
  r = await post(`/notes/${n.id}/task-toggle`, { lineIndex: 99, checked: true, line: 'x' })
  assert.equal(r.status, 400)

  // 404
  r = await post('/notes/99999/task-toggle', { lineIndex: 0, checked: true })
  assert.equal(r.status, 404)
})

test('提及一键转链：只转围栏外首个、转链后进入 backlinks', async () => {
  const target = await j(await post('/notes', { title: '复利', content: '概念说明' }))
  const mentioner = await j(await post('/notes', {
    title: 'V07提及者',
    content: [
      '```',
      '复利 出现在代码块里',
      '```',
      '先提一次 复利，再提一次 复利',
    ].join('\n'),
  }))

  // 转链前：unlinked 命中（围栏外有裸提及），且 context 是围栏外那行
  let d = await j(await get(`/notes/${target.id}/unlinked`))
  assert.equal(d.mentions.length, 1)
  assert.equal(d.mentions[0].id, mentioner.id)
  assert.ok(d.mentions[0].context.includes('先提一次'), 'context 取围栏外行')

  // 转链
  let r = await post(`/notes/${mentioner.id}/link-mention`, { title: '复利' })
  assert.equal(r.status, 200)
  const updated = (await j(r)).note
  assert.ok(updated.content.includes('先提一次 [[复利]]，再提一次 复利'), '首个裸提及被转换（只转一次）')

  // 转链后：unlinked 消失、backlinks 命中
  d = await j(await get(`/notes/${target.id}/unlinked`))
  assert.equal(d.mentions.length, 0, '转链后不再出现在未链接提及')
  const b = await j(await get(`/notes/${target.id}/backlinks`))
  assert.equal(b.links.length, 1)

  // 第二次转链：转换剩余的第二个裸提及
  r = await post(`/notes/${mentioner.id}/link-mention`, { title: '复利' })
  assert.equal(r.status, 200)
  const updated2 = (await j(r)).note
  assert.equal((updated2.content.match(/\[\[复利\]\]/g) ?? []).length, 2, '第二个提及也被转换')

  // 第三次转链 → 无可转换
  r = await post(`/notes/${mentioner.id}/link-mention`, { title: '复利' })
  assert.equal(r.status, 400)
})

test('未链接提及：围栏内与行内代码中的标题不计入', async () => {
  const target = await j(await post('/notes', { title: '围栏测试', content: '正文' }))
  await post('/notes', {
    title: 'V07围栏笔记',
    content: [
      '前言',
      '```',
      '围栏测试 inside code',
      '```',
      '末尾提到 `围栏测试` 行内代码',
    ].join('\n'),
  })
  const d = await j(await get(`/notes/${target.id}/unlinked`))
  assert.equal(d.mentions.length, 0, '围栏内与行内代码不计入')

  // 围栏外裸提及仍命中
  await post('/notes', { title: 'V07正常提及', content: '关于 围栏测试 的记录' })
  const d2 = await j(await get(`/notes/${target.id}/unlinked`))
  assert.equal(d2.mentions.length, 1)
  assert.equal(d2.mentions[0].title, 'V07正常提及')
})
