// 简知 · 路径穿越回归测试（node:test + 原生 fetch）
//
// 背景：静态污点分析会把「包含路径拼装的函数」整体标记为穿越入口，需要可复核的证据来判断
// 防护是否真的有效。本文件用攻击者视角构造请求，验证三层防护确实拦得住：
//   1) /files/* 服务：resolve 后必须仍在附件根目录内
//   2) 附件上传：入库文件名经 sanitizeFileName 清洗，且永远带服务端生成的 YYYYMM/<随机> 前缀
//   3) 备份名：BACKUP_NAME_RE 白名单校验（仅 jianzhi-YYYYMMDD-HHMMSS[-N].db）
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 必须在引入 app 之前设置独立数据目录，避免污染开发数据
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jianzhi-traversal-'))

const { buildApp } = await import('../src/app.js')
const { dataDir, filesDir, backupDir } = await import('../src/db.js')

let server
let origin

before(async () => {
  const app = buildApp()
  server = app.listen(0)
  origin = `http://127.0.0.1:${server.address().port}`
})

after(() => { server?.close() })

const get = (url) => fetch(origin + url)
const post = (url, body) => fetch(origin + url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

// 判断 abs 是否真的落在 root 之内（用真实路径，避免符号链接/大小写绕过）
function isInside(root, abs) {
  const rel = path.relative(fs.realpathSync(root), path.resolve(abs))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

// 在附件根目录之外放金丝雀，用于验证清理逻辑不会越界删除
const CANARY_NAME = 'canary-do-not-delete.txt'
const CANARY_BODY = 'this file lives OUTSIDE the attachments root'
const canaryPath = path.join(dataDir, CANARY_NAME)

test('前置：金丝雀文件位于附件根目录之外', () => {
  // realpath 需要目录真实存在；附件目录是首次上传时才建的，这里先补上
  fs.mkdirSync(filesDir, { recursive: true })
  fs.writeFileSync(canaryPath, CANARY_BODY)
  assert.ok(fs.existsSync(canaryPath), '金丝雀应已创建')
  assert.ok(!isInside(filesDir, canaryPath), '金丝雀必须不在附件根目录内，否则测试无意义')
})

// ---------- 1. /files/* 服务层防穿越 ----------

// 注意：WHATWG URL 解析器会把字面量 ".." 段规范化掉，所以攻击载荷必须用
// 编码过的分隔符送达服务端（%2f / %5c），才能真正打到 decodeURIComponent 之后的那一层。
const TRAVERSAL_PAYLOADS = [
  '/files/..%2f..%2fjianzhi.db',                 // ../../
  '/files/..%5c..%5cjianzhi.db',                 // 反斜杠（Windows 关键路径）
  '/files/%2e%2e%2f%2e%2e%2fjianzhi.db',         // 点也被编码
  '/files/..%2f..%2f..%2f..%2fetc%2fpasswd',     // 多级
  '/files/....%2f%2f....%2f%2fjianzhi.db',       // 畸形点点
  '/files/%2e%2e%2fcanary-do-not-delete.txt',    // 指向金丝雀
  '/files/..%5ccanary-do-not-delete.txt',        // 反斜杠指向金丝雀
]

for (const payload of TRAVERSAL_PAYLOADS) {
  test(`/files 拒绝穿越：${payload}`, async () => {
    const r = await get(payload)
    assert.equal(r.status, 404, `穿越载荷应返回 404，实际 ${r.status}`)
    // 进一步确认响应体里没有泄漏数据库内容
    const text = await r.text()
    assert.ok(!text.includes('SQLite format'), '响应不得包含 SQLite 文件头')
  })
}

// 正向对照：证明 /files 路由本身是通的，防护不是「一律拒绝」
test('/files 正向对照：合法附件可正常读取', async () => {
  const body = Buffer.from('hello-jianzhi-attachment')
  const r = await post('/api/attachments', {
    name: 'legit.txt',
    mime: 'text/plain',
    data: body.toString('base64'),
  })
  assert.equal(r.status, 201)
  const att = await r.json()

  const fileRes = await get('/files/' + att.file_name)
  assert.equal(fileRes.status, 200, '合法附件应可读取')
  assert.equal(Buffer.from(await fileRes.arrayBuffer()).toString(), 'hello-jianzhi-attachment')
})

// ---------- 2. 附件上传：恶意文件名必须被清洗 ----------

const MALICIOUS_NAMES = [
  '../../../../evil.txt',
  '..\\..\\..\\evil.txt',
  '../../../canary-do-not-delete.txt',
  '..\\canary-do-not-delete.txt',
  'C:\\Windows\\System32\\evil.txt',
  '....//....//evil.txt',
  '/etc/passwd',
  '..%2f..%2fevil.txt',
]

const uploaded = []

for (const name of MALICIOUS_NAMES) {
  test(`上传清洗文件名：${name}`, async () => {
    const r = await post('/api/attachments', {
      name,
      mime: 'text/plain',
      data: Buffer.from('payload').toString('base64'),
    })
    assert.equal(r.status, 201)
    const att = await r.json()
    uploaded.push(att.file_name)

    // 入库名必须是 <YYYYMM>/<随机hex>-<清洗后的 basename>
    assert.match(att.file_name, /^\d{6}\//, '入库名必须带服务端生成的 YYYYMM/ 前缀')

    // 真正的安全不变量是「路径结构」而非字符黑名单：恰好两段，且不含 . / .. 这类路径段。
    // 注意：.. 作为普通文件名的子串（例如清洗后的 "_%2f..%2fevil.txt"）是无害的 ——
    // 只有当它构成完整的路径段时才具备「上一级」语义，而 sanitizeFileName 已剥掉全部分隔符。
    const segs = att.file_name.split('/')
    assert.equal(segs.length, 2, `入库名应恰好为 YYYYMM/<name> 两段，实际 ${JSON.stringify(segs)}`)
    assert.match(segs[0], /^\d{6}$/, '第一段必须是服务端生成的 YYYYMM')
    const base = segs[1]
    assert.ok(!base.includes('/') && !base.includes('\\'), '文件名段不得含路径分隔符')
    assert.ok(base !== '.' && base !== '..' && base !== '', '文件名段不得是 . 或 ..')

    // 落盘位置必须在附件根目录内
    const abs = path.join(filesDir, att.file_name)
    assert.ok(isInside(filesDir, abs), `附件必须落在附件根目录内，实际解析到 ${abs}`)
    assert.ok(fs.existsSync(abs), '附件应已写盘')
  })
}

test('上传穿越名不得在附件根目录之外创建任何文件', () => {
  // 金丝雀内容与大小均未被改动
  assert.ok(fs.existsSync(canaryPath), '金丝雀不能被上传流程创建/覆盖/删除')
  assert.equal(fs.readFileSync(canaryPath, 'utf8'), CANARY_BODY, '金丝雀内容不得被改写')

  // 附件根目录的上一层不应出现名为 evil.txt / passwd 的残留
  for (const stray of ['evil.txt', 'passwd']) {
    assert.ok(!fs.existsSync(path.join(dataDir, stray)), `不应在数据目录产生 ${stray}`)
  }
})

// ---------- 3. 孤儿清理不得越界删除（本轮高危告警指向的真实利用链）----------

test('孤儿清理（force）不得删除附件根目录之外的文件', async () => {
  const before = fs.readFileSync(canaryPath, 'utf8')

  const r = await post('/api/attachments/cleanup?force=1', {})
  assert.equal(r.status, 200)

  // 金丝雀必须毫发无伤 —— 这是「file_name 穿越 → rmSync 越界删除」利用链的终点断言
  assert.ok(fs.existsSync(canaryPath), '孤儿清理越界删除了附件根目录之外的文件')
  assert.equal(fs.readFileSync(canaryPath, 'utf8'), before, '金丝雀内容被改写')
})

// ---------- 4. 备份名白名单 ----------

const BAD_BACKUP_NAMES = [
  '..%2f..%2fjianzhi.db',
  '..%5c..%5cjianzhi.db',
  '%2e%2e%2f%2e%2e%2fjianzhi.db',
  'jianzhi.db',
  'jianzhi-20260101-000000.db%2f..%2f..%2fjianzhi.db',
]

for (const bad of BAD_BACKUP_NAMES) {
  test(`备份名白名单拒绝：${bad}`, async () => {
    const del = await fetch(`${origin}/api/backups/${bad}`, { method: 'DELETE' })
    assert.equal(del.status, 404, `非法备份名不应命中删除，实际 ${del.status}`)

    const dl = await get(`/api/backups/${bad}/download`)
    assert.equal(dl.status, 404, `非法备份名不应可下载，实际 ${dl.status}`)

    const rs = await post(`/api/backups/${bad}/restore`, {})
    assert.equal(rs.status, 404, `非法备份名不应可恢复，实际 ${rs.status}`)

    // 主库必须完好（恢复接口一旦被穿越命中会覆盖主库）
    assert.ok(fs.existsSync(path.join(dataDir, 'jianzhi.db')), '主数据库文件必须仍然存在')
  })
}

test('备份：合法名可创建/列出/删除（正向对照）', async () => {
  const made = await post('/api/backups', {})
  assert.equal(made.status, 200)
  const info = await made.json()
  assert.match(info.name, /^jianzhi-\d{8}-\d{6}(?:-\d{1,2})?\.db$/, '备份名应符合白名单格式')

  const list = await (await get('/api/backups')).json()
  assert.ok(list.backups.some((b) => b.name === info.name), '新备份应出现在列表中')

  const del = await fetch(`${origin}/api/backups/${info.name}`, { method: 'DELETE' })
  assert.equal(del.status, 200, '合法备份应可删除')
})

// ---------- 5. 全库导出 ZIP 的附件读取同样防穿越 ----------

test('导出 ZIP：附件读取路径必须被限制在附件根目录内', async () => {
  // 造一篇引用了「附件根目录之外文件」的笔记：即使内容里写了穿越路径，
  // 导出流程也只能包含已入库附件（getAttachmentByPath 白名单 + resolve 前缀校验）
  const note = await (await post('/api/notes', {
    title: '穿越尝试',
    content: `![x](/files/..%2f..%2f${CANARY_NAME})`,
  })).json()

  // 通过 syncNoteFiles 路径登记引用后导出
  await fetch(`${origin}/api/notes/${note.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: `![x](/files/../${CANARY_NAME})` }),
  })

  const zip = await get('/api/export/md')
  assert.equal(zip.status, 200)
  const buf = Buffer.from(await zip.arrayBuffer())

  // ZIP 是 store 模式（未压缩），金丝雀正文以明文出现在归档里即视为泄漏
  assert.ok(!buf.includes(Buffer.from(CANARY_BODY)), '导出 ZIP 不得包含附件根目录之外的文件内容')
})

test('收尾：金丝雀依然完好', () => {
  assert.ok(fs.existsSync(canaryPath))
  assert.equal(fs.readFileSync(canaryPath, 'utf8'), CANARY_BODY)
  fs.rmSync(canaryPath, { force: true })
})
