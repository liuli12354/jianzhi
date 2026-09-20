import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'

interface Props {
  refreshKey?: unknown
}

// GitHub 官方 5 档色阶（浅/暗两套）
const COLORS_LIGHT = ['var(--panel-2)', '#9be9a8', '#40c463', '#30a14e', '#216e39']
const COLORS_DARK = ['#21262d', '#0e4429', '#006d32', '#26a641', '#39d353']

function levelOf(count: number): number {
  if (count <= 0) return 0
  if (count <= 3) return 1
  if (count <= 6) return 2
  if (count <= 9) return 3
  return 4
}

// v1.1 编辑活动热力图（GitHub Contributions 惯例：7 行周列、5 档色阶、悬浮提示）
export default function ActivityHeatmap({ refreshKey }: Props) {
  const [activity, setActivity] = useState<Record<string, number>>({})
  const days = 182

  useEffect(() => {
    let alive = true
    api.getActivity(days)
      .then((d) => { if (alive) setActivity(d.activity ?? {}) })
      .catch(() => {})
    return () => { alive = false }
  }, [refreshKey])

  const cells = useMemo(() => {
    const out: { date: string; count: number }[] = []
    const today = new Date()
    // 对齐到周一起始（GitHub 惯例）
    const start = new Date(today)
    start.setDate(start.getDate() - (days - 1) - ((start.getDay() + 6) % 7))
    for (let i = 0; i < days + 7; i++) {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      const p = (n: number) => String(n).padStart(2, '0')
      const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
      if (d > today) {
        out.push({ date: key, count: -1 }) // 未来日占位（透明）
      } else {
        out.push({ date: key, count: activity[key] ?? 0 })
      }
    }
    return out.slice(0, Math.ceil(out.length / 7) * 7)
  }, [activity])

  const total = Object.values(activity).reduce((s, n) => s + n, 0)

  return (
    <div className="heatmap">
      <div className="heat-title">编辑活动 · 近 {days} 天 {total} 次</div>
      <div className="heat-grid">
        {cells.map((c) => {
          if (c.count < 0) return <i key={c.date} className="heat-cell future" />
          const dark = document.documentElement.dataset.theme === 'dark'
          const colors = dark ? COLORS_DARK : COLORS_LIGHT
          const lvl = levelOf(c.count)
          const d = new Date(`${c.date}T12:00:00`)
          const label = `${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${c.count} 次活动`
          return (
            <i
              key={c.date}
              className="heat-cell"
              style={{ background: colors[lvl] }}
              title={label}
              data-label={label}
            />
          )
        })}
      </div>
    </div>
  )
}
