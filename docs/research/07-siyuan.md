# SiYuan（思源笔记）

> 调研日期：2026-09-13

## 基本信息

| 项目 | 内容 |
| --- | --- |
| GitHub 地址 | https://github.com/siyuan-note/siyuan |
| Stars | 约 46.3 k（46,317，来源：GitHub API，2026-09-13） |
| 主语言 | TypeScript（GitHub 语言统计，前端为主；后端 kernel 为 Go） |
| 许可证 | AGPL-3.0 |
| 最近更新时间 | 2026-09-12（GitHub API `pushed_at`） |
| 是否活跃维护 | 是（未归档，push 频率以小时/天计） |

## 定位与核心功能

官方定位为"privacy-first personal knowledge management system"，主打"细粒度块级引用 + Markdown 所见即所得"，口号是 "From thought to insight, with agents"。

- **编辑体验**：Markdown 所见即所得（WYSIWYG）编辑器，支持百万字大文档、数学公式、图表/流程图/甘特图、五线谱；多标签页 + 拖拽分屏；网页剪藏、PDF 批注并可链接到批注位置。
- **组织方式**：笔记本 → 文档树两级结构；块级双向链接与块引用（`((block ref))`）、文档反向链接面板；标签与书签；自定义属性；支持 `siyuan://` 协议跨文档跳转。
- **查询与搜索**：全文搜索、语义搜索、资源内容搜索，并支持嵌入 SQL 查询块（"Query search, sql — full-text, semantic, asset-content"），查询结果可作为动态集合嵌入文档。
- **同步**：云存储同步为付费会员权益；官方明确拒绝第三方同步盘（"Data synchronization through third-party synchronization disks is not supported, otherwise data may be corrupted"）；无实时多人协作。
- **发布分享**：Docker 自托管后可通过浏览器访问分享；支持发布为站点（配合 OIDC 认证控制访问）。
- **导入导出**：导出标准 Markdown（含资源）、PDF、Word、HTML；支持一键复制适配微信公众号、知乎、语雀格式。
- **AI 能力**：内置 "AI writing and Q/A chat via OpenAI API"，支持自定义 API 接入；官方愿景是人机协作（agents）。
- **其他**：数据库表格视图（类似 Notion database）、闪卡间隔重复（flashcard spaced repetition）、Tesseract OCR 图片文字识别、模板片段、JS/CSS 代码片段、社区插件市场、开放 API。

## 技术架构

- **前端**：TypeScript + Vue 系技术栈，打包为 Electron 桌面应用（Docker 镜像目录结构与 Electron 安装包 `resources` 目录一致）。
- **后端**：Go 编写的 kernel（`kernel/go.mod`），以 HTTP 服务形式运行，默认端口 6806，WebSocket 走 `/ws`；桌面端、Docker 端、移动端共用同一套内核。
- **存储方案**：工作区 `data` 目录下笔记本以文件夹组织，文档保存为 `.sy` 后缀的 JSON 明文文件（数据格式可读但属自有格式）；同时用嵌入式 SQLite（`siyuan.db`）建立块级索引。
- **搜索机制**：全文搜索基于 SQLite 的 SQL 查询（如 `/api/search/fullTextSearchBlock` 端点），语义搜索走向量化方案。
- **生态组件**：lute（Markdown 解析/渲染引擎）、dejavu（数据仓库/同步）、petal（插件 API）、riff（间隔重复），均为独立 Go 仓库。
- **部署形态**：桌面应用（Windows/macOS/Linux 全平台 + 应用商店）、移动端（iOS/Android/鸿蒙）、Docker 自托管（仅支持浏览器访问，且不支持 PDF/HTML/Word 导出与 Markdown 导入）、官方付费云同步。

## 设计亮点

1. **块级数据模型贯穿始终**：所有内容的最小单元是"块"，引用、反向链接、搜索、闪卡、数据库视图都建立在块 ID 之上。这保证了双链粒度足够细（可引用到段落甚至列表项），是"轻量双链笔记"最值得参考的抽象。
2. **明文可读存储 + 独立索引层**：原始数据是磁盘上的 JSON 明文文件（可备份、可 grep、可脱离应用阅读），SQLite 索引可随时重建。这种"真相源与索引分离"的设计对自研项目非常有参考价值——索引坏了不丢数据。
3. **编辑器内核独立成库（lute）**：Markdown 解析渲染引擎独立开源，便于复用与测试，也使 WYSIWYG 与 Markdown 源码模式可互转。
4. **中文原生体验**：国人开发，对中文搜索分词、中文排版、国内平台（公众号/知乎）复制适配做得明显优于国外同类产品。
5. **插件与片段体系**：插件市场 + JS/CSS 片段 + 模板 + SQL 查询块，扩展梯度平滑，用户可以从零配置渐进到深度定制。

## 不足与局限

1. **核心增值功能收费**：云同步、部分 AI 能力等绑定会员订阅；对纯自托管用户，官方明确不支持第三方同步盘，多设备同步要么付费要么自行解决（社区有借助 Syncthing 等的变通方案，但官方警告有数据损坏风险）。
2. **自有 `.sy` JSON 格式**：虽然明文可读，但不是标准 `.md` 文件，迁移到其他工具需要专门导出；对习惯纯 Markdown 文件管理（如用 Obsidian、Git 管理）的用户是摩擦点。
3. **资源占用偏重**：Electron + Go 内核 + SQLite 索引的架构决定了内存占用较高（社区普遍反馈内存占用在数百 MB 量级），低端设备体验一般。
4. **自托管安全历史**：kernel 的搜索 API 曾出现 SQL 注入漏洞（CVE-2026-32767），另有未鉴权 SQL 读取等访问控制问题（公开漏洞库记录），将 Docker 端直接暴露公网需谨慎，务必配合访问码/OIDC 与反向代理。
5. **Docker/Web 版功能受限**：不支持导出与 Markdown 导入等桌面端能力，自托管体验不等同桌面端。

## 对自研轻量知识库的启示

1. **采用"明文 Markdown 为真相源 + SQLite FTS 做索引"的存储架构**：笔记文件保持标准 `.md` 落盘，全文搜索与双链关系全部进 SQLite 索引（可重建），兼顾数据可迁移性与搜索性能，这是 SiYuan 架构中最值得复制的部分。
2. **尽早确定块的粒度与稳定 ID**：双向链接、反链面板、段落引用都依赖"块级稳定 ID"。轻量应用可以只做到"文档级 + 标题级（heading）锚点"，但 ID 必须在编辑中保持稳定，否则双链会大量失效。
3. **同步策略要克制**：SiYuan 拒绝第三方同步盘说明并发写冲突是真实痛点。轻量自研应用应明确"单用户/单写入端"边界，或一开始就设计基于操作日志的同步，而不是留到后期补。
