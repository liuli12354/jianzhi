// 简知 v0.4 后端集成测试：笔记本兄弟排序（三区拖拽的 API 语义）
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jianzhi-v04-'))

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
const j = (r) => r.json()

const orderOf = async (parentId) => {
  const list = await j(await get('/notebooks'))
  return list.filter((n) => n.parent_id === parentId).map((n) => n.name)
}

test('兄弟排序：插入到指定下标并整组重编号（步长 10）', async () => {
  const root = await j(await post('/notebooks', { name: 'V4根' }))
  const a = await j(await post('/notebooks', { name: '甲', parentId: root.id }))
  const b = await j(await post('/notebooks', { name: '乙', parentId: root.id }))
  const c = await j(await post('/notebooks', { name: '丙', parentId: root.id }))

  assert.deepEqual(await orderOf(root.id), ['甲', '乙', '丙'])

  // 丙 移到下标 0
  let r = await patch(`/notebooks/${c.id}`, { parentId: root.id, position: 0 })
  assert.equal(r.status, 200)
  assert.deepEqual(await orderOf(root.id), ['丙', '甲', '乙'])

  // 排序值应为 10/20/30
  const list = await j(await get('/notebooks'))
  const sorts = list.filter((n) => n.parent_id === root.id).map((n) => n.sort_order)
  assert.deepEqual(sorts, [10, 20, 30])

  // 乙 移到下标 1（丙、乙、甲）
  r = await patch(`/notebooks/${b.id}`, { parentId: root.id, position: 1 })
  assert.equal(r.status, 200)
  assert.deepEqual(await orderOf(root.id), ['丙', '乙', '甲'])
})

test('兄弟排序：越界收敛与末尾追加', async () => {
  const root = await j(await post('/notebooks', { name: 'V4根2' }))
  const x = await j(await post('/notebooks', { name: 'X', parentId: root.id }))
  await post('/notebooks', { name: 'Y', parentId: root.id })

  // 越界大数 → 末尾
  let r = await patch(`/notebooks/${x.id}`, { parentId: root.id, position: 999 })
  assert.equal(r.status, 200)
  assert.deepEqual(await orderOf(root.id), ['Y', 'X'])

  // 越界负数 → 开头
  r = await patch(`/notebooks/${x.id}`, { parentId: root.id, position: -5 })
  assert.equal(r.status, 200)
  assert.deepEqual(await orderOf(root.id), ['X', 'Y'])
})

test('兄弟排序：跨父级移动保持 position 语义', async () => {
  const p1 = await j(await post('/notebooks', { name: 'P1' }))
  const p2 = await j(await post('/notebooks', { name: 'P2' }))
  await post('/notebooks', { name: 'P2-子1', parentId: p2.id })
  const child = await j(await post('/notebooks', { name: 'P1-子', parentId: p1.id }))
  await post('/notebooks', { name: 'P1-子2', parentId: p1.id })

  // 把 P1-子 移动到 P2 的下标 0
  const r = await patch(`/notebooks/${child.id}`, { parentId: p2.id, position: 0 })
  assert.equal(r.status, 200)
  assert.deepEqual(await orderOf(p2.id), ['P1-子', 'P2-子1'])
  assert.deepEqual(await orderOf(p1.id), ['P1-子2'])
})

test('兄弟排序：非法 position 与防环回归', async () => {
  const root = await j(await post('/notebooks', { name: 'V4根3' }))
  const a = await j(await post('/notebooks', { name: 'A3', parentId: root.id }))
  const b = await j(await post('/notebooks', { name: 'B3', parentId: a.id }))

  // NaN → 400
  let r = await patch(`/notebooks/${b.id}`, { parentId: root.id, position: 'abc' })
  assert.equal(r.status, 400)

  // 防环：把祖先挂到子孙下
  r = await patch(`/notebooks/${root.id}`, { parentId: b.id, position: 0 })
  assert.equal(r.status, 400)

  // 正常移动仍可用（v0.3 语义回归：只传 parentId 追加到末尾）
  r = await patch(`/notebooks/${b.id}`, { parentId: root.id })
  assert.equal(r.status, 200)
  assert.deepEqual(await orderOf(root.id), ['A3', 'B3'])
})
