// 从 Markdown 原文提取一行摘要（跳过标题行与空行）
export function excerpt(content: string, max = 64): string {
  for (const raw of String(content || '').split('\n')) {
    const line = raw.trim().replace(/^#{1,6}\s*/, '').replace(/^>\s*/, '').replace(/[*`~[\]]/g, '').trim()
    if (line) return line.slice(0, max)
  }
  return ''
}

export function relativeTime(iso: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const m = 60_000
  const h = 3_600_000
  const d = 86_400_000
  if (diff < m) return '刚刚'
  if (diff < h) return `${Math.floor(diff / m)} 分钟前`
  if (diff < d) return `${Math.floor(diff / h)} 小时前`
  if (diff < 2 * d) return '昨天'
  if (diff < 7 * d) return `${Math.floor(diff / d)} 天前`
  const dt = new Date(then)
  const year = dt.getFullYear() === new Date().getFullYear() ? '' : `${dt.getFullYear()} 年 `
  return `${year}${dt.getMonth() + 1} 月 ${dt.getDate()} 日`
}

export function formatFull(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 由标签名稳定地映射一个色相，用于彩色小标签
export function tagHue(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 360
  return h
}

// v0.6 笔记拖拽的自定义 MIME：与笔记本拖拽（无自定义类型）互不干扰
export const NOTE_MIME = 'application/x-jz-note'

// v0.6 GFM 任务行统计（与后端 listAllTasks 同一形态）
const TASK_LINE_RE = /^\s*(?:[-*+]|\d+\.)\s+\[( |x|X)\]\s+(.*)$/
export function countTasks(content: string): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const line of String(content ?? '').split('\n')) {
    const m = line.match(TASK_LINE_RE)
    if (!m) continue
    total += 1
    if (m[1].toLowerCase() === 'x') done += 1
  }
  return { done, total }
}
