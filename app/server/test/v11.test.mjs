// 简知 v1.1 后端集成测试：多档优先级 / tasks due 过滤 / 活动热力图
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jianzhi-v11-'))

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
const patch = (url, body) => fetch(base + url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const j = (r) => r.json()

test('多档优先级：🔺3 / ⏫2 / 🔼1 / 无0 / ⏬-1', async () => {
  await post('/notes', {
    title: 'V11任务',
    content: [
      '- [ ] 🔺 最高优先',
      '- [ ] ⏫ 高优先',
      '- [ ] 🔼 中优先',
      '- [ ] 普通任务',
      '- [ ] ⏬ 低优先',
      '- [x] ⏫ 已完成的高优先',
    ].join('\n'),
  })
  const d = await j(await get('/tasks'))
  const find = (kw) => d.tasks.find((t) => t.noteTitle === 'V11任务' && t.text.includes(kw))
  assert.equal(find('🔺 最高优先').priority, 3)
  assert.equal(find('⏫ 高优先').priority, 2)
  assert.equal(find('已完成的高优先').priority, 2, '已完成任务同样解析优先级')
  assert.equal(find('🔼 中优先').priority, 1)
  assert.equal(find('普通任务').priority, 0)
  assert.equal(find('⏬ 低优先').priority, -1)
})

test('tasks due 过滤：只返回当日任务', async () => {
  await post('/notes', { title: 'V11日期', content: '- [ ] 甲 📅 2026-10-05\n- [ ] 乙 📅 2026-10-06' })
  const d = await j(await get('/tasks?due=2026-10-05'))
  assert.ok(d.tasks.every((t) => t.due === '2026-10-05'), '只含当日任务')
  assert.ok(d.tasks.some((t) => t.text.includes('甲')))

  const r = await get('/tasks?due=2026/10/05')
  assert.equal(r.status, 400, '非法日期格式')
})

test('活动热力图：创建与编辑产生当日活动', async () => {
  const n = await j(await post('/notes', { title: 'V11活动', content: '初版' }))
  await patch(`/notes/${n.id}`, { content: '修改一' })
  await patch(`/notes/${n.id}`, { content: '修改二' })

  const d = await j(await get('/activity'))
  const today = new Date()
  const p = (x) => String(x).padStart(2, '0')
  const todayStr = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`
  assert.ok((d.activity[todayStr] ?? 0) >= 3, `今日活动 ≥3（实际 ${d.activity[todayStr]}）`)
  assert.ok(d.days >= 30 && d.days <= 366, 'days 范围收敛')

  // 上限收敛
  const d2 = await j(await get('/activity?days=9999'))
  assert.equal(d2.days, 366)
})
