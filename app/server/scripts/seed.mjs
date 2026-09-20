// 简知 · 首次运行示例数据种子脚本（node scripts/seed.mjs，需服务已启动）
const base = process.env.API_BASE || 'http://localhost:4321/api'

const post = async (path, body) => {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}: ${await r.text()}`)
  return r.json()
}

const welcome = await post('/notebooks', { name: '开始使用' })

await post('/notes', {
  notebookId: welcome.id,
  title: '欢迎使用简知',
  tags: ['指南'],
  pinned: 1,
  content: `# 欢迎使用简知

**简知**是一个轻量级个人知识库：Markdown 笔记 + 笔记本 + 标签 + 全文搜索 + 双向链接，数据保存在本机单个 SQLite 文件里。

## 三步上手

1. 左侧点 **＋** 新建一个笔记本
2. 按 **Ctrl+N** 新建笔记，用 Markdown 随手写
3. 按 **Ctrl+K** 随时全局搜索

## 它有什么不一样

- **双向链接**：在任意笔记里输入 \`[[使用技巧]]\`，就能跳转到那篇笔记；被引用的笔记会自动列出**反向链接**。
- **全文搜索**：Ctrl+K 支持中文子串检索（FTS5 trigram），结果带相关度排序与上下文片段高亮。
- **图片粘贴**：截图后直接在编辑器里 Ctrl+V 即可插入，也可以拖拽文件进来。
- **每日笔记**：侧栏日历点任意日期即可写日记，顶栏「📅 今日」一键直达今天。
- **定时备份**：服务端自动快照数据库（设置 ⚙️ 里可调间隔/份数，支持一键恢复）。
- **关系图谱**：顶栏「🕸 图谱」可视化所有双链构成的知识网。
- **版本历史**：每次修改自动留存快照（保留最近 20 版），编辑器右上角 🕒 可随时回滚。
- **回收站**：删除先进回收站，可恢复或彻底清除。

- [ ] 把这篇笔记移到你的笔记本
- [ ] 给它加一个标签试试
- [ ] 写一篇新笔记，用 [[使用技巧]] 链接过来
- [ ] 粘贴一张截图到这篇笔记里
- [ ] 打开「🕸 图谱」看看知识网长什么样

> 提示：右侧是实时预览（分屏模式），工具栏按钮可以快速插入常用语法；预览里可以直接勾选任务。
`,
})

await post('/notes', {
  notebookId: welcome.id,
  title: '使用技巧',
  tags: ['指南', '效率'],
  content: `# 使用技巧

## 快捷键

| 快捷键 | 作用 |
|---|---|
| Ctrl + K | 全局搜索 |
| Ctrl + N | 新建笔记 |
| Ctrl + S | 立即保存（平时自动保存） |
| Tab | 编辑器中插入缩进 |

## 双向链接

写 \`[[笔记标题]]\` 即可创建双链，支持别名：\`[[使用技巧|技巧汇总]]\`。

打开一篇被引用的笔记，底部的**反向链接**面板会列出所有引用它的笔记——这是把零散笔记织成知识网的关键。

## 整理建议

- 笔记本放「领域」，标签放「属性」：例如笔记本《工作》，标签 \`#待办\`、\`#灵感\`
- 重要的笔记点 **⭐ 收藏**，当天的待办点 **📌 置顶**
- 定期用顶栏「导出」备份全量 JSON
`,
})

await post('/notes', {
  title: 'Markdown 语法速查',
  tags: ['参考'],
  starred: 1,
  content: `# Markdown 语法速查

## 文本

**加粗** 、*斜体* 、\`行内代码\` 、~~删除线~~ 、[链接](https://example.com)

## 引用与列表

> 这是一段引用

- 无序列表项
1. 有序列表项
- [ ] 待办项
- [x] 已完成

## 代码块

\`\`\`js
// 简知内置了轻量代码高亮
function greet(name) {
  return \`Hello, \${name}!\`
}
console.log(greet('简知'))
\`\`\`

## 表格与分割线

| 语法 | 效果 |
|---|---|
| \`**粗体**\` | **粗体** |
| \`> 引用\` | 引用块 |

---
双链语法：[[使用技巧]]
`,
})

console.log('SEED_OK: 已写入 3 篇示例笔记')
