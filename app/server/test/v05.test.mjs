// 简知 v0.5 后端集成测试：随机漫游 / 反链整段上下文 / 路由顺序
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jianzhi-v05-'))

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
const del = (url) => fetch(base + url, { method: 'DELETE' })
const j = (r) => r.json()

test('随机漫游：只返回活跃笔记且路由不被 :id 吞掉', async () => {
  const ids = []
  for (let i = 1; i <= 5; i++) {
    const n = await j(await post('/notes', { title: `漫游目标${i}`, content: `内容${i}` }))
    ids.push(n.id)
  }
  // 软删其中一篇
  await del(`/notes/${ids[4]}`)

  const seen = new Set()
  for (let i = 0; i < 24; i++) {
    const r = await get('/notes/random')
    assert.equal(r.status, 200)
    const { note } = await j(r)
    assert.ok(note, '随机返回非空')
    assert.ok(ids.includes(note.id), '命中已创建的笔记')
    assert.notEqual(note.id, ids[4], '不返回回收站中的笔记')
    seen.add(note.id)
  }
  assert.ok(seen.size >= 2, `随机性存在（实际命中 ${seen.size} 种）`)

  // 回归：/notes/:id 正常工作
  const r2 = await get(`/notes/${ids[0]}`)
  assert.equal(r2.status, 200)
})

test('随机漫游：空库返回 null（子进程使用独立数据目录）', () => {
  // db.js 在模块加载时绑定 DATA_DIR，进程内无法二次隔离；改用子进程验证空库语义
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jianzhi-v05-empty-'))
  const script = `
    const { getRandomNote } = await import(${JSON.stringify(pathToFileURL(path.join(process.cwd(), 'src', 'db.js')).href)})
    console.log(JSON.stringify({ note: getRandomNote() }))
  `
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, DATA_DIR: dir },
  })
  assert.equal(r.status, 0, `子进程失败：${r.stderr}`)
  const { note } = JSON.parse(r.stdout.trim().split('\n').pop())
  assert.equal(note, null)
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 忽略清理失败 */ }
})

test('反链整段上下文：±3 行窗口且剔除首尾空行', async () => {
  const target = await j(await post('/notes', { title: 'V05目标', content: '正文' }))
  await post('/notes', {
    title: 'V05引用者',
    content: [
      '开头第一行',
      '',
      '前置说明行',
      '',
      '',
      '引用 [[V05目标]] 的这一行是命中行',
      '',
      '后续解释行',
      '',
      '',
      '结尾行',
    ].join('\n'),
  })
  const d = await j(await get(`/notes/${target.id}/backlinks`))
  assert.equal(d.links.length, 1)
  const l = d.links[0]
  assert.equal(l.context, '引用 [[V05目标]] 的这一行是命中行')
  assert.ok(l.contextFull, 'contextFull 存在')
  const lines = l.contextFull.split('\n')
  assert.ok(lines[0].includes('前置说明行'), '窗口含前文')
  assert.ok(lines[lines.length - 1].includes('后续解释行'), '窗口含后文')
  assert.ok(!l.contextFull.startsWith('\n') && !l.contextFull.endsWith('\n'), '首尾空行剔除')
  assert.ok(l.contextFull.length <= 600, '长度截断生效')
})

test('反链整段上下文：无命中行时不崩溃（防御）', async () => {
  const target = await j(await post('/notes', { title: 'V05目标2', content: '正文' }))
  await post('/notes', { title: 'V05引用者2', content: `[[V05目标2]] 出现在第一行` })
  const d = await j(await get(`/notes/${target.id}/backlinks`))
  assert.equal(d.links.length, 1)
  assert.ok(d.links[0].contextFull.includes('[[V05目标2]]') || d.links[0].context, '首行命中也有上下文')
})
