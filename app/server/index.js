// 简知 · 服务入口
import { buildApp } from './src/app.js'
import { maybeRunBackup } from './src/db.js'

const port = Number(process.env.PORT) || 4321
const app = buildApp()

app.listen(port, () => {
  console.log(`✅ 简知已启动: http://localhost:${port}`)
})

// 定时备份：启动时先检查一次，此后每 5 分钟巡检（到点才真正执行）
maybeRunBackup().catch((e) => console.error('[简知] 定时备份失败:', e.message))
setInterval(() => {
  maybeRunBackup().catch((e) => console.error('[简知] 定时备份失败:', e.message))
}, 5 * 60 * 1000).unref()
