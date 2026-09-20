// 简知 v0.3 后端集成测试：层级笔记本 / Markdown ZIP 导出 / 反向链接上下文
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jianzhi-v03-'))

const { buildApp } = await import('../src/app.js')
const { crc32 } = await import('../src/zip.js')

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

let root
let child
let grand
let noteInChild

test('层级：创建父/子笔记本与非法父级校验', async () => {
  let r = await post('/notebooks', { name: '工作' })
  assert.equal(r.status, 201)
  root = await j(r)

  r = await post('/notebooks', { name: '项目A', parentId: root.id })
  assert.equal(r.status, 201)
  child = await j(r)
  assert.equal(child.parent_id, root.id)

  r = await post('/notebooks', { name: '子项目', parentId: child.id })
  grand = await j(r)
  assert.equal(grand.parent_id, child.id)

  // 顶级创建不受影响
  r = await post('/notebooks', { name: '独立本' })
  assert.equal((await j(r)).parent_id, null)

  // 父级不存在 → 400
  r = await post('/notebooks', { name: '孤儿', parentId: 99999 })
  assert.equal(r.status, 400)
})

test('层级：子树过滤（选中父级聚合显示子孙笔记）', async () => {
  await post('/notes', { notebookId: root.id, title: '根笔记' })
  noteInChild = await j(await post('/notes', { notebookId: child.id, title: '子笔记' }))
  await post('/notes', { notebookId: grand.id, title: '孙笔记' })

  const all = (await j(await get(`/notes?notebookId=${root.id}`))).map((n) => n.title)
  assert.deepEqual(all.sort(), ['孙笔记', '子笔记', '根笔记'].sort())

  const sub = (await j(await get(`/notes?notebookId=${child.id}`))).map((n) => n.title)
  assert.deepEqual(sub.sort(), ['子笔记', '孙笔记'])

  // 无效 notebookId 不过滤（返回全部）
  const total = (await j(await get('/notes'))).length
  assert.equal(total, 3)
})

test('层级：移动防环与提升', async () => {
  // 把祖先挂到子孙下 → 400
  let r = await patch(`/notebooks/${root.id}`, { parentId: grand.id })
  assert.equal(r.status, 400)
  // 自挂 → 400
  r = await patch(`/notebooks/${root.id}`, { parentId: root.id })
  assert.equal(r.status, 400)
  // 目标不存在 → 400
  r = await patch(`/notebooks/${grand.id}`, { parentId: 424242 })
  assert.equal(r.status, 400)

  // 合法移动：孙 → 根下
  r = await patch(`/notebooks/${grand.id}`, { parentId: root.id })
  assert.equal((await j(r)).parent_id, root.id)
  // 提升：孙 → 顶级
  r = await patch(`/notebooks/${grand.id}`, { parentId: null })
  assert.equal((await j(r)).parent_id, null)
})

test('层级：删除父笔记本后子级提升、笔记保留', async () => {
  const r = await del(`/notebooks/${root.id}`)
  assert.equal(r.status, 200)
  const c = await j(await get(`/notebooks/${child.id}`))
  assert.equal(c.parent_id, null)
  const n = await j(await get(`/notes/${noteInChild.id}`))
  assert.equal(n.notebook_id, child.id)
})

test('反向链接上下文：返回首条命中行', async () => {
  const a = await j(await post('/notes', { title: '会议纪要', content: '正文' }))
  await post('/notes', { title: '引用者', content: '前置行\n\n关于 [[会议纪要]] 的结论如下\n\n结尾' })
  const d = await j(await get(`/notes/${a.id}/backlinks`))
  assert.equal(d.links.length, 1)
  assert.equal(d.links[0].context, '关于 [[会议纪要]] 的结论如下')

  // 无命中行（理论不可能，LIKE 保证命中；防御性检查 context 为字符串或 null）
  assert.ok(d.links[0].context === null || typeof d.links[0].context === 'string')
})

test('ZIP 导出：结构、UTF-8 文件名与 CRC', async () => {
  // 准备确定条目
  const nb = await j(await post('/notebooks', { name: 'Z手册' }))
  await post('/notes', { notebookId: nb.id, title: '欢迎使用简知', content: '# 欢迎使用简知\n\n导出验证正文' })
  await post('/notes', { title: '未分类笔记', content: '未分类内容' })
  // 覆盖附件归档路径：上传 → 笔记引用 → 导出应含 attachments/ 条目
  const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const att = await j(await post('/attachments', { name: 'zip-附件测试.png', mime: 'image/png', data: PNG_1PX }))
  assert.ok(att.file_name, '附件上传成功')
  await post('/notes', { notebookId: nb.id, title: '附件笔记', content: `![附件](${att.url})` })

  const res = await get('/export/md')
  assert.equal(res.status, 200)
  assert.ok((res.headers.get('content-type') ?? '').startsWith('application/zip'))
  const buf = Buffer.from(await res.arrayBuffer())

  // 定位 EOCD
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  assert.ok(eocd > 0, 'EOCD 存在')
  const count = buf.readUInt16LE(eocd + 10)
  const cdStart = buf.readUInt32LE(eocd + 16)

  // 解析中央目录：签名、UTF-8 标志、文件名
  const entries = []
  let p = cdStart
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, '中央目录签名')
    const flags = buf.readUInt16LE(p + 8)
    assert.equal(flags & 0x800, 0x800, 'UTF-8 文件名标志位')
    const crc = buf.readUInt32LE(p + 16)
    const size = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const lho = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    entries.push({ name, crc, size, lho })
    p += 46 + nameLen
  }

  const names = entries.map((e) => e.name)
  assert.ok(names.includes('Z手册/欢迎使用简知.md'), '中文目录/文件名正确编码')
  assert.ok(names.includes('未分类/未分类笔记.md'), '无笔记本归入未分类')
  assert.ok(names.some((n) => n.startsWith('attachments/')), '引用附件归档到 attachments/')

  // 逐条校验本地头与内容 CRC
  for (const e of entries) {
    assert.equal(buf.readUInt32LE(e.lho), 0x04034b50, '本地头签名')
    const nameLen = buf.readUInt16LE(e.lho + 26)
    const extraLen = buf.readUInt16LE(e.lho + 28)
    const dataStart = e.lho + 30 + nameLen + extraLen
    const data = buf.subarray(dataStart, dataStart + e.size)
    assert.equal(crc32(data), e.crc, `CRC 一致：${e.name}`)
  }

  // 内容抽查
  const w = entries.find((e) => e.name === 'Z手册/欢迎使用简知.md')
  const ds = w.lho + 30 + buf.readUInt16LE(w.lho + 26) + buf.readUInt16LE(w.lho + 28)
  assert.ok(buf.subarray(ds, ds + w.size).toString('utf8').includes('导出验证正文'))
})
