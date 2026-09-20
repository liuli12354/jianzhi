import type { MouseEvent, ReactNode } from 'react'
import { renderMarkdown } from '../markdown'

// clipboard API 不可用（http/file 环境）时的降级复制
function fallbackCopy(text: string, done: () => void) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try { document.execCommand('copy'); done() } catch { /* 忽略 */ }
  ta.remove()
}

interface Props {
  source: string
  onOpenTitle?: (title: string) => void
  /** 预览中勾选/取消第 index 个任务复选框时回调（index 为渲染顺序，对应源码中的第 index 个任务项） */
  onToggleTask?: (index: number) => void
}

// Markdown 渲染容器：处理 [[双链]] 点击跳转与任务复选框勾选
export default function Markdown({ source, onOpenTitle, onToggleTask }: Props) {
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    // v0.8 代码块复制按钮（clipboard API 不可用时降级 execCommand）
    const copyBtn = target.closest('.md-copy') as HTMLElement | null
    if (copyBtn) {
      const pre = copyBtn.closest('pre')
      const code = pre?.querySelector('code')?.textContent ?? pre?.textContent?.replace(/^复制/, '') ?? ''
      const done = () => {
        copyBtn.textContent = '✓ 已复制'
        window.setTimeout(() => { copyBtn.textContent = '复制' }, 2000)
      }
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(code).then(done).catch(() => fallbackCopy(code, done))
      } else {
        fallbackCopy(code, done)
      }
      return
    }
    if (target instanceof HTMLInputElement && target.classList.contains('task-box')) {
      if (!onToggleTask) return
      e.preventDefault()
      const boxes = Array.from(e.currentTarget.querySelectorAll('input.task-box'))
      const idx = boxes.indexOf(target)
      if (idx >= 0) onToggleTask(idx)
      return
    }
    if (!onOpenTitle) return
    const el = target.closest('.wikilink') as HTMLElement | null
    if (el) onOpenTitle(el.dataset.target ?? '')
  }
  return <div className="md" onClick={onClick} dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }} />
}
