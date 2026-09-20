// 简知 v1.0 后端集成测试：任务优先级 / 日历月聚合
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jianzhi-v10-'))

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

test('任务优先级：⭐ 解析', async () => {
  await post('/notes', { title: 'V10任务', content: '- [ ] ⭐ 优先交报告 📅 2026-09-30\n- [ ] 普通任务 📅 2026-09-01' })
  const d = await j(await get('/tasks'))
  const mine = d.tasks.filter((t) => t.noteTitle === 'V10任务')
  assert.equal(mine.length, 2)
  const star = mine.find((t) => t.text.includes('优先交报告'))
  const plain = mine.find((t) => t.text.includes('普通任务'))
  assert.equal(star.priority, 1)
  assert.equal(plain.priority, 0)
  // 其余字段不受影响
  assert.equal(star.due, '2026-09-30')
})

test('日历月聚合：日记日期与任务到期计数', async () => {
  await post('/journal/2026-10-05', {}) // 走真实每日笔记端点建日记
  await post('/notes', { title: 'V10任务', content: '- [ ] 甲 📅 2026-10-05\n- [ ] 乙 📅 2026-10-05\n- [ ] 丙 📅 2026-11-01' })

  const d = await j(await get('/calendar/2026/10'))
  assert.ok(d.journalDates.includes('2026-10-05'), '日记日期聚合')
  assert.equal(d.taskDue['2026-10-05'], 2, '同日任务计数')
  assert.equal(d.taskDue['2026-11-01'], undefined, '跨月不计入')

  // 无效月份
  const r = await get('/calendar/2026/13')
  assert.equal(r.status, 400)
})
