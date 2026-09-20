// Markdown 渲染：marked + DOMPurify + 内置零依赖代码高亮 + [[双链]]
// v0.2：标题注入锚点 id（大纲跳转）、GFM 任务复选框可点击（回写源码）
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const KEYWORDS = new Set(
  ('const let var function return if else for while class new extends import export from async await try catch ' +
    'finally throw typeof instanceof this super switch case break continue default void public private static ' +
    'final interface struct impl fn pub use mut match loop crate self package end do then elsif nil require ' +
    'module begin def elif lambda pass raise with as yield global nonlocal None True False and or not in is ' +
    'int str float bool list dict set tuple print len range').split(' '),
)

const PY_LIKE = ['python', 'py', 'sh', 'bash', 'shell', 'yaml', 'yml', 'ruby', 'r']

// 极简高亮：注释 / 字符串 / 数字 / 关键字，覆盖常见语言的主要阅读场景
function highlightCode(code: string, lang: string): string {
  const langLower = (lang || '').toLowerCase()
  const hashComment = PY_LIKE.includes(langLower)
  const pattern = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g
  let out = ''
  let last = 0
  for (const m of code.matchAll(pattern)) {
    const idx = m.index ?? 0
    out += escapeHtml(code.slice(last, idx))
    const [full, comment, str, num, word] = m
    if (comment) {
      if (comment.startsWith('#') && !hashComment) out += escapeHtml(full)
      else out += `<span class="tok-comment">${escapeHtml(full)}</span>`
    } else if (str) {
      out += `<span class="tok-str">${escapeHtml(full)}</span>`
    } else if (num) {
      out += `<span class="tok-num">${escapeHtml(full)}</span>`
    } else if (word && KEYWORDS.has(full)) {
      out += `<span class="tok-kw">${escapeHtml(full)}</span>`
    } else {
      out += escapeHtml(full)
    }
    last = idx + full.length
  }
  out += escapeHtml(code.slice(last))
  return out
}

// 兼容 marked 不同版本的 code 渲染器签名
const renderer = new marked.Renderer()
renderer.code = ((tokenOrCode: unknown, langMaybe?: string) => {
  const obj = tokenOrCode as { text?: string; lang?: string }
  const text = typeof tokenOrCode === 'string' ? tokenOrCode : String(obj.text ?? '')
  const lang = typeof tokenOrCode === 'string' ? (langMaybe ?? '') : String(obj.lang ?? '')
  const cls = lang ? ` class="language-${escapeHtml(lang.toLowerCase())}"` : ''
  return `<pre><code${cls}>${highlightCode(text.replace(/\n$/, ''), lang)}</code></pre>`
}) as typeof renderer.code

marked.setOptions({ renderer, gfm: true, breaks: true })

const WIKI_RE = /\[\[([^\[\]|\n]+)(?:\|([^\[\]\n]+))?\]\]/g

export function renderMarkdown(src: string): string {
  const html = marked.parse(String(src ?? '')) as string
  // 在非代码片段中把 [[标题]] / [[标题|别名]] 替换为双链锚点
  const parts = html.split(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)/g)
  const merged = parts
    .map((part, i) => {
      if (i % 2 === 1) return part
      return part.replace(WIKI_RE, (_m, target: string, label?: string) => {
        const t = target.trim()
        return `<a class="wikilink" data-target="${escapeHtml(t)}" title="跳转到「${escapeHtml(t)}」">${escapeHtml((label ?? t).trim())}</a>`
      })
    })
    .join('')
  const clean = DOMPurify.sanitize(merged, { ADD_ATTR: ['data-target'] })
  // 标题按出现顺序注入锚点 id，供大纲点击跳转
  let h = 0
  const withIds = clean.replace(/<h([1-6])(\s|>)/g, (_m, lvl: string, tail: string) => {
    h += 1
    return tail === '>' ? `<h${lvl} id="md-h-${h}">` : `<h${lvl} id="md-h-${h}" `
  })
  // 任务复选框去掉 disabled，让预览里可点击（点击后由上层回写源码）
  const clickable = withIds.replace(/<input([^>]*type="checkbox"[^>]*)>/g, (_m, attrs: string) => {
    const cleaned = attrs.replace(/\sdisabled(="[^"]*")?/g, '')
    return `<input${cleaned} class="task-box">`
  })
  // v0.8 代码块复制按钮（点击由 Markdown 容器事件委托处理）
  return clickable.replace(/<pre>/g, '<pre><button class="md-copy" type="button">复制</button>')
}

// ---------- 大纲解析（与注入的锚点 id 一一对应） ----------

export interface OutlineItem {
  level: number
  text: string
  id: string
}

// 从 Markdown 源码提取 ATX 标题（跳过代码块内的 # 行）
export function parseOutline(src: string): OutlineItem[] {
  const out: OutlineItem[] = []
  let inFence = false
  let fenceMark = ''
  let n = 0
  for (const raw of String(src ?? '').split('\n')) {
    const line = raw.trimStart()
    const fence = line.match(/^(`{3,}|~{3,})/)
    if (fence) {
      if (!inFence) { inFence = true; fenceMark = fence[1][0] }
      else if (fence[1][0] === fenceMark) inFence = false
      continue
    }
    if (inFence) continue
    const m = raw.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (m) {
      n += 1
      out.push({ level: m[1].length, text: m[2].trim(), id: `md-h-${n}` })
    }
  }
  return out
}

// 统计任务进度：- [ ] / - [x]
export function taskProgress(src: string): { total: number; done: number } {
  let total = 0
  let done = 0
  for (const m of String(src ?? '').matchAll(/^\s*[-*+]\s+\[([ xX])\]/gm)) {
    total += 1
    if (m[1] !== ' ') done += 1
  }
  return { total, done }
}
