// v0.8 HTML → Markdown（网页粘贴收集场景）
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

const td = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
})
td.use(gfm)

// 相对链接保留原样；空白产物压缩
export function htmlToMarkdown(html: string): string {
  const md = td.turndown(html)
  return md.replace(/\n{3,}/g, '\n\n').trim()
}
