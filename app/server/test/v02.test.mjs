// 简知 v0.2 后端集成测试：FTS5 搜索 / 附件 / 每日笔记 / 备份与设置 / 图谱 / 统计
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

// 必须在引入 app 之前设置独立数据目录，避免污染开发数据
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jianzhi-test-v02-'))

const { buildApp } = await import('../src/app.js')

let server
let base

before(async () => {
  const app = buildApp()
  server = app.listen(0)
  base = `http://127.0.0.1:${server.address().port}/api`
})

after(() => {
  server.close()
})

const get = async (p) => {
  const r = await fetch(base + p)
  return { status: r.status, body: await r.json() }
}
const post = async (p, body) => {
  const r = await fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return { status: r.status, body: await r.json() }
}
const patch = async (p, body) => {
  const r = await fetch(base + p, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return { status: r.status, body: await r.json() }
}
const del = async (p) => {
  const r = await fetch(base + p, { method: 'DELETE' })
  return { status: r.status, body: await r.json() }
}

test('健康检查：版本号为语义化版本', async () => {
  const { body } = await get('/health')
  assert.match(body.version, /^\d+\.\d+\.\d+$/)
})

// ---------- FTS5 搜索 ----------

test('FTS：中文多字词命中 + 相关度（标题优先）+ 片段', async () => {
  await post('/notes', { title: '俄罗斯文学选读', content: '托尔斯泰与陀思妥耶夫斯基的哲学。' })
  await post('/notes', { title: '读书清单', content: '这里收录了俄罗斯文学相关的书单。' })
  const { body } = await get('/search?q=' + encodeURIComponent('俄罗斯文学'))
  assert.equal(body.mode, 'fts')
  assert.ok(body.total >= 2, '至少命中两篇')
  assert.equal(body.results[0].title, '俄罗斯文学选读', '标题命中应排在前面')
  const withSnippet = body.results.find((r) => r.title === '读书清单')
  assert.ok(withSnippet.snippet && withSnippet.snippet.includes('\u0001'), '片段应含高亮标记')
  assert.ok(withSnippet.snippet.includes('\u0002'))
})

test('FTS：短词（<3 字符）回退 LIKE 仍可命中', async () => {
  const { body } = await get('/search?q=' + encodeURIComponent('书单'))
  assert.equal(body.mode, 'like')
  assert.ok(body.results.some((r) => r.title === '读书清单'))
})

test('FTS：笔记本 / 标签筛选生效', async () => {
  const nb = (await post('/notebooks', { name: '文学' })).body
  await post('/notes', { notebookId: nb.id, title: '俄国小说流派', content: '俄罗斯文学中的白银时代。' })
  const tag = await post('/notes', { title: '无关笔记', content: '随便写点俄罗斯文学。', tags: ['杂项'] })
  const byNb = (await get('/search?q=' + encodeURIComponent('俄罗斯文学') + `&notebookId=${nb.id}`)).body
  assert.ok(byNb.results.every((r) => r.notebook_id === nb.id))
  assert.ok(byNb.results.some((r) => r.title === '俄国小说流派'))
  const tagId = (await get('/notes/' + tag.body.id)).body.tags[0].id
  const byTag = (await get('/search?q=' + encodeURIComponent('俄罗斯文学') + `&tagId=${tagId}`)).body
  assert.ok(byTag.results.some((r) => r.title === '无关笔记'))
})

test('FTS：更新与删除同步索引', async () => {
  const note = (await post('/notes', { title: '索引同步', content: '包含关键词火烈鸟。' })).body
  let r = (await get('/search?q=' + encodeURIComponent('火烈鸟'))).body
  assert.equal(r.total, 1)
  await patch('/notes/' + note.id, { content: '改成别的词了，比如信天翁。' })
  r = (await get('/search?q=' + encodeURIComponent('火烈鸟'))).body
  assert.equal(r.total, 0, '旧词应从索引移除')
  r = (await get('/search?q=' + encodeURIComponent('信天翁'))).body
  assert.equal(r.total, 1, '新词应进入索引')
  await del('/notes/' + note.id + '?purge=1')
  r = (await get('/search?q=' + encodeURIComponent('信天翁'))).body
  assert.equal(r.total, 0, '删除后不应命中')
})

test('列表检索：q 走 FTS 且可与其他筛选组合', async () => {
  const { body } = await get('/notes?q=' + encodeURIComponent('俄罗斯文学'))
  assert.ok(body.length >= 3)
  assert.ok(body.every((n) => n.deleted_at === null))
})

// ---------- 附件 ----------

test('附件：base64 上传 → /files 取回 → 引用同步 → 删除保护', async () => {
  // 1x1 红色 PNG
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const up = await post('/attachments', { name: '红点.png', mime: 'image/png', data: pngBase64 })
  assert.equal(up.status, 201)
  assert.ok(up.body.url.startsWith('/files/'))
  assert.equal(up.body.inline, true)

  // 取回：字节一致、Content-Type 正确
  const fileRes = await fetch(`http://127.0.0.1:${server.address().port}${up.body.url}`)
  assert.equal(fileRes.status, 200)
  assert.equal(fileRes.headers.get('content-type'), 'image/png')
  const buf = Buffer.from(await fileRes.arrayBuffer())
  assert.equal(buf.toString('base64'), pngBase64)

  // 引用同步：写入笔记 → used_by=1；清除引用 → used_by=0
  const note = (await post('/notes', { title: '带图笔记', content: `看图：![红点](${up.body.url})` })).body
  let list = (await get('/attachments')).body
  let row = list.find((a) => a.id === up.body.id)
  assert.equal(row.used_by, 1, '引用后 used_by 应为 1')
  await patch('/notes/' + note.id, { content: '图片删掉了' })
  list = (await get('/attachments')).body
  row = list.find((a) => a.id === up.body.id)
  assert.equal(row.used_by, 0, '移除引用后 used_by 应为 0')

  // 未引用 → 可删除；不存在 → 404
  const d1 = await del('/attachments/' + up.body.id)
  assert.equal(d1.status, 200)
  const fileGone = await fetch(`http://127.0.0.1:${server.address().port}${up.body.url}`)
  assert.equal(fileGone.status, 404)
  const d2 = await del('/attachments/' + up.body.id)
  assert.equal(d2.status, 404)
})

test('附件：孤儿清理尊重 1 小时缓冲，force 立即清理', async () => {
  const up = await post('/attachments', { name: '孤儿.bin', mime: 'application/octet-stream', data: Buffer.from('x').toString('base64') })
  let r = (await post('/attachments/cleanup')).body
  assert.equal(r.removed, 0, '1 小时内的新上传不应被清理')
  r = (await post('/attachments/cleanup?force=1')).body
  assert.ok(r.removed >= 1, 'force 应清理孤儿')
})

test('附件：路径穿越被拒绝', async () => {
  // fetch/WHATWG URL 会把 %2e%2e 归一化，必须用原始 HTTP 请求才能真正测到穿越路径
  const rawGet = (rawPath) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: server.address().port, path: rawPath, method: 'GET' },
        (res) => {
          res.resume()
          res.on('end', () => resolve(res.statusCode))
        },
      )
      req.on('error', reject)
      req.end()
    })
  for (const p of ['/files/%2e%2e/jianzhi.db', '/files/..%2fjianzhi.db', '/files/a/../../jianzhi.db', '/files/..\\jianzhi.db']) {
    const status = await rawGet(p)
    assert.notEqual(status, 200, `${p} 不应放行`)
  }
  // 中文文件名需正确解码后仍可访问
  const up = await post('/attachments', { name: '穿越检查.png', mime: 'image/png', data: Buffer.from('ok').toString('base64') })
  const ok = await rawGet(up.body.url.split('/').map((s, i) => (i < 2 ? s : encodeURIComponent(s))).join('/'))
  assert.equal(ok, 200, 'URL 编码后的中文附件应可访问')
  await del('/attachments/' + up.body.id)
})

// ---------- 每日笔记 ----------

test('每日笔记：today 幂等创建 + 固定日期 + 月历', async () => {
  const t1 = (await get('/journal/today')).body
  assert.match(t1.date, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(t1.note.journal_date, t1.date)
  assert.ok(t1.note.title.includes(t1.date), '标题应包含日期')
  assert.ok(t1.note.content.includes('## ✅ 今日完成'), '应使用模板')
  const t2 = (await get('/journal/today')).body
  assert.equal(t2.note.id, t1.note.id, '第二次应返回同一篇')

  const fixed = (await post('/journal/2026-09-01')).body
  assert.equal(fixed.note.journal_date, '2026-09-01')
  const again = (await post('/journal/2026-09-01')).body
  assert.equal(again.note.id, fixed.note.id, '同日幂等')

  const month = (await get('/journal/2026/9')).body
  assert.ok(month.some((m) => m.journal_date === '2026-09-01'))
  const bad = await post('/journal/not-a-date')
  assert.equal(bad.status, 400)
})

// ---------- 备份与设置 ----------

test('备份：创建 → 列表 → 恢复回环 → 删除', async () => {
  const note = (await post('/notes', { title: '备份对象', content: '版本A' })).body
  const b1 = (await post('/backups')).body
  assert.match(b1.name, /^jianzhi-\d{8}-\d{6}\.db$/)
  assert.ok(b1.size > 0)

  await patch('/notes/' + note.id, { content: '版本B' })
  const restored = (await post(`/backups/${b1.name}/restore`)).body
  assert.equal(restored.ok, true)
  const after = (await get('/notes/' + note.id)).body
  assert.equal(after.content, '版本A', '恢复后应回到版本A')

  // 下载备份文件头为 SQLite 格式
  const dl = await fetch(`http://127.0.0.1:${server.address().port}/api/backups/${b1.name}/download`)
  assert.equal(dl.status, 200)
  const head = Buffer.from(await dl.arrayBuffer()).subarray(0, 15).toString()
  assert.equal(head, 'SQLite format 3')

  const list = (await get('/backups')).body.backups
  assert.ok(list.some((b) => b.name === b1.name))
  const d = await del('/backups/' + b1.name)
  assert.equal(d.body.ok, true)
  const d2 = await del('/backups/' + b1.name)
  assert.equal(d2.status, 404)
})

test('备份：非法文件名被拒绝', async () => {
  const r = await del('/backups/..%2Fjianzhi.db')
  assert.equal(r.status, 404, '路径穿越应 404')
})

test('设置：读取 / 更新 / 越界钳制', async () => {
  let s = (await get('/settings')).body
  assert.equal(typeof s.backupEnabled, 'boolean')
  s = (await patch('/settings', { backupIntervalHours: 999, backupKeep: 0 })).body
  assert.equal(s.backupIntervalHours, 168, '上限 168')
  assert.equal(s.backupKeep, 1, '下限 1')
  s = (await patch('/settings', { backupEnabled: false, backupIntervalHours: 12, backupKeep: 7 })).body
  assert.equal(s.backupEnabled, false)
  assert.equal(s.backupIntervalHours, 12)
  assert.equal(s.backupKeep, 7)
  await patch('/settings', { backupEnabled: true })
})

// ---------- 图谱与统计 ----------

test('图谱：双链生成边，无链笔记度数为 0', async () => {
  const a = (await post('/notes', { title: '图谱源', content: '指向 [[图谱目标]] 和 [[不存在的页]]' })).body
  const b = (await post('/notes', { title: '图谱目标', content: '孤立但被指向' })).body
  const c = (await post('/notes', { title: '孤岛笔记', content: '没有任何链接' })).body
  const g = (await get('/graph')).body
  const edge = g.edges.find((e) => (e.s === a.id && e.t === b.id) || (e.s === b.id && e.t === a.id))
  assert.ok(edge, '应存在 A→B 边')
  assert.ok(!g.edges.some((e) => e.s === a.id || e.t === a.id ? e.t === (g.nodes.find((n) => n.title === '不存在的页')?.id) : false), '不存在的目标不产生边')
  const cNode = g.nodes.find((n) => n.id === c.id)
  assert.equal(cNode.degree, 0)
  const bNode = g.nodes.find((n) => n.id === b.id)
  assert.ok(bNode.degree >= 1)
})

test('统计：包含字数与附件信息', async () => {
  const s = (await get('/stats')).body
  assert.ok(s.words > 0, '总字数应大于 0')
  assert.ok(s.attachments && typeof s.attachments.count === 'number')
})

test('列表检索与每日笔记共存：journal 笔记出现在月历且可被搜索', async () => {
  const r = (await get('/search?q=' + encodeURIComponent('今日完成'))).body
  assert.ok(r.total >= 1, '模板内容应可被全文搜索')
})
