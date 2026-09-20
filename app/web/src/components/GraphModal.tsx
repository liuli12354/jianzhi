import { useEffect, useRef, useState } from 'react'
import type { GraphData, Notebook } from '../types'
import { api } from '../api'
import { tagHue } from '../utils'
import Modal from './Modal'

interface Props {
  notebooks: Notebook[]
  onClose: () => void
  onOpenNote: (id: number) => void
}

interface SimNode {
  id: number
  title: string
  deg: number
  hue: number
  iso: boolean
  x: number
  y: number
  vx: number
  vy: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const truncate = (s: string, n = 16) => (s.length > n ? `${s.slice(0, n)}…` : s)

// 关系图谱：canvas 力导向布局（斥力 + 弹簧 + 向心力），支持拖拽节点、平移、缩放、点击打开
export default function GraphModal({ notebooks, onClose, onOpenNote }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [data, setData] = useState<GraphData | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api.graph().then(setData).catch((e) => setErr((e as Error).message))
  }, [])

  // ---- 模拟状态（ref，避免重渲染） ----
  const simRef = useRef<{ nodes: SimNode[]; edges: [SimNode, SimNode][] } | null>(null)
  const viewRef = useRef({ x: 0, y: 0, k: 1 })
  const dragRef = useRef<{ node: SimNode | null; panning: boolean; lx: number; ly: number; moved: boolean } | null>(null)
  const hoverRef = useRef<SimNode | null>(null)
  const frameRef = useRef(0)
  // 回调用 ref 固定，避免 effect 闭包拿到过期 props
  const openNoteRef = useRef(onOpenNote)
  openNoteRef.current = onOpenNote

  // 初始化 + 渲染 + 物理循环 + 交互（依赖 data：canvas 在数据就绪后才挂载）
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!data || !canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1

    // ---- 布局初始化（圆环 + 抖动） ----
    const W0 = wrap.clientWidth
    const H0 = wrap.clientHeight
    const R = Math.min(W0, H0) * 0.35
    const hueOf = (notebookId: number | null) => {
      const nb = notebooks.find((n) => n.id === notebookId)
      return nb ? tagHue(nb.name) : 258
    }
    const nodes: SimNode[] = data.nodes.map((n, i) => {
      const a = (i / Math.max(1, data.nodes.length)) * Math.PI * 2
      const iso = n.degree === 0
      // 确定性抖动（避免初始位置完全重叠）
      const jitterX = ((i * 37) % 23) - 11
      const jitterY = ((i * 53) % 19) - 9
      return {
        id: n.id,
        title: n.title,
        deg: n.degree,
        hue: hueOf(n.notebook_id),
        iso,
        x: W0 / 2 + R * Math.cos(a) + jitterX,
        y: H0 / 2 + R * Math.sin(a) + jitterY,
        vx: 0,
        vy: 0,
      }
    })
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const edges: [SimNode, SimNode][] = []
    for (const e of data.edges) {
      const s = byId.get(e.s)
      const t = byId.get(e.t)
      if (s && t) edges.push([s, t])
    }
    simRef.current = { nodes, edges }
    frameRef.current = 0
    viewRef.current = { x: 0, y: 0, k: 1 }

    const resize = () => {
      canvas.width = wrap.clientWidth * dpr
      canvas.height = wrap.clientHeight * dpr
      canvas.style.width = `${wrap.clientWidth}px`
      canvas.style.height = `${wrap.clientHeight}px`
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    const nodeRadius = (n: SimNode) => (n.iso ? 4 : clamp(5 + n.deg * 1.6, 5, 18))

    const draw = () => {
      const W = wrap.clientWidth
      const H = wrap.clientHeight
      const view = viewRef.current
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      const s = simRef.current
      if (!s) return
      ctx.translate(view.x, view.y)
      ctx.scale(view.k, view.k)

      const hover = hoverRef.current
      const linked = new Set<SimNode>()
      if (hover) {
        linked.add(hover)
        for (const [a, b] of s.edges) {
          if (a === hover) linked.add(b)
          if (b === hover) linked.add(a)
        }
      }

      // 边
      for (const [a, b] of s.edges) {
        const on = hover ? (a === hover || b === hover) : false
        ctx.strokeStyle = hover && !on ? 'rgba(128,128,128,0.08)' : on ? 'rgba(59,130,246,0.85)' : 'rgba(128,128,128,0.25)'
        ctx.lineWidth = on ? 1.6 / view.k : 1 / view.k
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
      // 节点
      // 标签颜色取自 CSS 主题色（canvas 对 currentColor 的解析在 Chrome 下会回退成黑色）
      const labelColor = getComputedStyle(wrap).color
      for (const n of s.nodes) {
        const r = nodeRadius(n)
        const dim = hover ? !linked.has(n) : false
        ctx.globalAlpha = dim ? 0.25 : 1
        ctx.fillStyle = n.iso ? '#9ca3af' : `hsl(${n.hue} 65% 55%)`
        ctx.beginPath()
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
        ctx.fill()
        if (n === hover) {
          ctx.strokeStyle = '#3b82f6'
          ctx.lineWidth = 2 / view.k
          ctx.stroke()
        }
        // 标签：缩放足够或悬浮/度数高时显示
        if (view.k > 0.45 && (!hover || linked.has(n))) {
          ctx.globalAlpha = dim ? 0.2 : 0.9
          ctx.fillStyle = labelColor
          ctx.font = `${11 / view.k}px system-ui, sans-serif`
          ctx.textAlign = 'center'
          ctx.fillText(truncate(n.title), n.x, n.y + r + 12 / view.k)
        }
        ctx.globalAlpha = 1
      }
    }

    let raf = 0
    let rafAlive = false
    let fallbackTimer = 0
    const step = () => {
      const s = simRef.current
      if (s && frameRef.current < 420) {
        const nodes = s.nodes
        // 斥力（>300px 忽略以控规模）
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i]
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j]
            let dx = b.x - a.x
            let dy = b.y - a.y
            let d2 = dx * dx + dy * dy
            if (d2 > 90000) continue
            if (d2 < 1) {
              dx = 0.7
              dy = 0.7
              d2 = 1
            }
            const d = Math.sqrt(d2)
            const f = 2200 / d2
            const fx = (dx / d) * f
            const fy = (dy / d) * f
            a.vx -= fx
            a.vy -= fy
            b.vx += fx
            b.vy += fy
          }
        }
        // 弹簧
        for (const [a, b] of s.edges) {
          const dx = b.x - a.x
          const dy = b.y - a.y
          const d = Math.max(1, Math.hypot(dx, dy))
          const f = (d - 110) * 0.02
          const fx = (dx / d) * f
          const fy = (dy / d) * f
          a.vx += fx
          a.vy += fy
          b.vx -= fx
          b.vy -= fy
        }
        // 向心力 + 阻尼 + 积分
        const W = wrap.clientWidth
        const H = wrap.clientHeight
        for (const n of s.nodes) {
          n.vx += (W / 2 - n.x) * 0.002
          n.vy += (H / 2 - n.y) * 0.002
          if (dragRef.current?.node === n) {
            n.vx = 0
            n.vy = 0
            continue
          }
          n.vx *= 0.85
          n.vy *= 0.85
          n.x += clamp(n.vx, -14, 14)
          n.y += clamp(n.vy, -14, 14)
        }
        frameRef.current += 1
      }
      draw()
    }
    const tickRaf = () => {
      rafAlive = true
      step()
      raf = requestAnimationFrame(tickRaf)
    }
    raf = requestAnimationFrame(tickRaf)
    // 某些内嵌环境页面可见但 rAF 被挂起：300ms 无心跳则切换定时器驱动，保证图谱在任何环境都能渲染
    const rafProbe = window.setTimeout(() => {
      if (!rafAlive) fallbackTimer = window.setInterval(step, 16)
    }, 300)
    // 首帧同步绘制：不依赖任何回调立即出图
    draw()

    // ---- 交互（原生监听，保证 wheel preventDefault 可用） ----
    const toWorld = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect()
      const view = viewRef.current
      return {
        x: (clientX - rect.left - view.x) / view.k,
        y: (clientY - rect.top - view.y) / view.k,
      }
    }
    const hitNode = (clientX: number, clientY: number): SimNode | null => {
      const s = simRef.current
      if (!s) return null
      const p = toWorld(clientX, clientY)
      for (let i = s.nodes.length - 1; i >= 0; i--) {
        const n = s.nodes[i]
        if (Math.hypot(n.x - p.x, n.y - p.y) <= nodeRadius(n) + 4 / viewRef.current.k) return n
      }
      return null
    }

    const onMouseDown = (e: PointerEvent) => {
      const node = hitNode(e.clientX, e.clientY)
      dragRef.current = node
        ? { node, panning: false, lx: e.clientX, ly: e.clientY, moved: false }
        : { node: null, panning: true, lx: e.clientX, ly: e.clientY, moved: false }
      canvas.setPointerCapture(e.pointerId)
    }
    const onMouseMove = (e: PointerEvent) => {
      const drag = dragRef.current
      if (drag) {
        const dx = e.clientX - drag.lx
        const dy = e.clientY - drag.ly
        if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true
        if (drag.panning) {
          viewRef.current.x += dx
          viewRef.current.y += dy
        } else if (drag.node) {
          const p = toWorld(e.clientX, e.clientY)
          drag.node.x = p.x
          drag.node.y = p.y
          frameRef.current = Math.min(frameRef.current, 380) // 保持运动
        }
        drag.lx = e.clientX
        drag.ly = e.clientY
        return
      }
      hoverRef.current = hitNode(e.clientX, e.clientY)
      canvas.style.cursor = hoverRef.current ? 'pointer' : 'grab'
    }
    const onMouseUp = (e: PointerEvent) => {
      const drag = dragRef.current
      if (drag?.node && !drag.moved) openNoteRef.current(drag.node.id)
      dragRef.current = null
      canvas.releasePointerCapture(e.pointerId)
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const view = viewRef.current
      const rect = canvas.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const k2 = clamp(view.k * (e.deltaY < 0 ? 1.12 : 0.9), 0.15, 4)
      view.x = sx - ((sx - view.x) * k2) / view.k
      view.y = sy - ((sy - view.y) * k2) / view.k
      view.k = k2
    }
    const onLeave = () => {
      hoverRef.current = null
    }

    canvas.addEventListener('pointerdown', onMouseDown)
    canvas.addEventListener('pointermove', onMouseMove)
    canvas.addEventListener('pointerup', onMouseUp)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(rafProbe)
      window.clearInterval(fallbackTimer)
      ro.disconnect()
      canvas.removeEventListener('pointerdown', onMouseDown)
      canvas.removeEventListener('pointermove', onMouseMove)
      canvas.removeEventListener('pointerup', onMouseUp)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [data, notebooks])

  const legend = notebooks.filter((nb) => data?.nodes.some((n) => n.notebook_id === nb.id))
  const hasIsolated = data?.nodes.some((n) => n.degree === 0) ?? false

  return (
    <Modal title="🕸 关系图谱" onClose={onClose} width={980}>
      {err && <div className="side-hint" style={{ padding: 16 }}>加载失败：{err}</div>}
      {!err && !data && <div className="side-hint" style={{ padding: 16 }}>加载中…</div>}
      {data && (
        <div className="graph-box">
          <div className="graph-toolbar">
            <span className="graph-stat">{data.nodes.length} 篇笔记 · {data.edges.length} 条链接</span>
            <span className="graph-hint">拖拽节点调整 · 滚轮缩放 · 点击节点打开笔记</span>
            <button className="btn ghost small" onClick={() => { viewRef.current = { x: 0, y: 0, k: 1 }; frameRef.current = 0 }}>
              重置视图
            </button>
          </div>
          <div className="graph-wrap" ref={wrapRef}>
            <canvas ref={canvasRef} />
          </div>
          <div className="graph-legend">
            {legend.map((nb) => (
              <span key={nb.id} className="legend-item">
                <i style={{ background: `hsl(${tagHue(nb.name)} 65% 55%)` }} />
                {nb.icon} {nb.name}
              </span>
            ))}
            {hasIsolated && (
              <span className="legend-item">
                <i style={{ background: '#9ca3af' }} />
                无链接笔记
              </span>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
