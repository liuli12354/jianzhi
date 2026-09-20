// 简知 v0.8 后端集成测试：出链解析 / 任务日期
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jianzhi-v08-'))

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
const j = (r) => r.json()

test('出链：解析/去重/别名/未解析', async () => {
  const b = await j(await post('/notes', { title: '目标乙', content: 'x' }))
  await post('/notes', { title: '目标丙', content: 'y' })
  const a = await j(await post('/notes', {
    title: '出链宿主',
    content: '引用 [[目标乙]]、[[目标丙|简称]]、再引 [[目标乙]] 和 [[不存在丁]]',
  }))

  const d = await j(await get(`/notes/${a.id}/outgoing`))
  assert.deepEqual(d.links, [
    { title: '目标乙', alias: null, id: b.id },
    { title: '目标丙', alias: '简称', id: d.links[1].id },
    { title: '不存在丁', alias: null, id: null },
  ], '去重保序，别名透传，未解析 id=null')

  // 404
  const r2 = await get('/notes/99999/outgoing')
  assert.equal(r2.status, 404)
})

test('任务 due：📅 日期解析', async () => {
  await post('/notes', {
    title: 'V08任务',
    content: '- [ ] 交季度报告 📅 2026-09-30\n- [ ] 无日期任务\n- [x] 已完成带日期 📅 2026-01-01',
  })
  const d = await j(await get('/tasks'))
  const mine = d.tasks.filter((t) => t.noteTitle === 'V08任务')
  assert.equal(mine.length, 3)
  assert.equal(mine[0].due, '2026-09-30')
  assert.equal(mine[1].due, null)
  assert.equal(mine[2].due, '2026-01-01')
})

test('回归：/notes/random 与 /notes/:id/outgoing 路由共存', async () => {
  const r1 = await get('/notes/random')
  assert.equal(r1.status, 200)
  const list = await j(await get('/notes'))
  const any = list[0]
  const r2 = await get(`/notes/${any.id}/outgoing`)
  assert.equal(r2.status, 200)
})
