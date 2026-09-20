# Outline

> 调研日期：2026-09-13

## 基本信息

| 项目 | 内容 |
| --- | --- |
| GitHub 地址 | https://github.com/outline/outline |
| Stars | 约 40.5k（来源：GitHub API `stargazers_count=40524`，2026-09-13 查询） |
| 主语言 | TypeScript（React 前端 + Node.js 后端） |
| 许可证 | BSL 1.1（Business Source License，GitHub 标注 NOASSERTION/"Other"）；非传统开源——内部使用与自托管免费，禁止提供与其竞争的托管服务，条款期满后自动转为宽松开源许可 |
| 最近更新时间 | 2026-09-12（GitHub API `pushed_at`） |
| 是否活跃维护 | 是，持续提交（累计约 1 万+ commits），未归档 |

## 定位与核心功能

- 定位为"给成长型团队的最快知识库"（The fastest knowledge base for growing teams），强调毫秒级的文档加载与导航响应，是 Notion/Confluence 的轻量替代。
- 编辑体验：基于 ProseMirror 的富文本编辑器，Markdown 兼容（可 Markdown 语法输入与导出）、斜杠命令（slash commands）、代码块、交互式嵌入（Figma、Loom 等 20+ 集成）。
- 组织方式：Collections（集合）作为顶层容器，内部为可无限嵌套的文档树；支持文档间引用与 backlinks（反向链接）；标签作为补充维度。
- 搜索：全工作区即时全文搜索（基于 PostgreSQL 全文检索 + trigram 扩展实现大小写不敏感匹配）+ Cmd+K 快速切换/搜索；速度是其核心卖点。
- 同步与协作：Yjs（CRDT）+ WebSocket 实时多人协作；评论与讨论串（comments & threads）保持对话有序。
- 权限与分享：读写权限、用户组（groups）、访客（guest users）；支持公开链接分享文档，商业版/自托管均可配置自定义域名与品牌（白标）。
- 导入导出：支持 Notion 导入、Markdown 导入，文档可导出 Markdown/HTML，支持整库备份导出。
- 集成与 AI：Slack 深度集成（聊天内搜索/分享/提问、文档更新推送频道）、开放 REST API 与 Webhook；AI 问答——针对工作区文档直接提问获取答案。
- 认证：依赖外部身份提供者（Google/Slack/OIDC/Keycloak 等，自托管常需配一套 OIDC）。

## 技术架构

- 前端：React 18 + Vite 构建 + MobX 状态管理 + styled-components 样式；路由按 chunk 异步加载（suspense）。
- 后端：Node.js + Koa 框架；Sequelize 作为 ORM；鉴权授权基于 cancan 策略（policies）。
- 数据与队列：PostgreSQL（文档/用户/集合数据，全文搜索与 trigram 匹配也在库内完成）；Redis + Bull 负责队列与异步事件（邮件、通知、索引等）；文件上传强制使用 S3 兼容对象存储（无本地磁盘选项，自托管常用 MinIO）。
- 实时协作：Yjs CRDT over WebSocket，自托管部署需要开放 WebSocket 连接。
- 进程结构：`app/`（前端）、`server/`（API + worker）、`shared/`（ProseMirror 编辑器与共享组件）、`plugins/`，服务可拆分独立进程（api、worker）。
- 部署形态：Docker（`outlinewiki/outline` 镜像 + docker-compose）、Heroku 类平台一键部署（Procfile/app.json）、官方云服务 getoutline.com。最小自托管组合通常为 Outline + PostgreSQL 16 + Redis + S3(MinIO) + OIDC 提供者。

## 设计亮点

1. **把"快"做成第一产品原则**：官方主打毫秒级响应，前端做路由级代码分割、乐观更新，后端把搜索留在 Postgres 内避免额外链路——性能被当成架构约束而非事后优化。
2. **搜索不引入重型组件**：全文搜索直接用 PostgreSQL FTS + pg_trgm，一个数据库同时承担存储与检索，省掉 Elasticsearch 这类额外服务；这对轻量自研项目是很直接的省钱省运维范式。
3. **简洁的三层组织模型**：集合 → 嵌套文档树 → 标签/引用，概念少、心智负担低，同时用 backlinks 补足网状关联；比 AFFiNE 的多视图数据库更轻，比纯平铺列表更有结构。
4. **成熟的进程/队列拆分**：API 与 worker 分离、Redis+Bull 承载异步任务（通知、导出、集成回调），主请求链路保持轻快，是 Node.js 全栈项目的清晰参考架构。

## 不足与局限

- **BSL 1.1 不是 OSI 开源许可**：允许内部使用与自托管，但禁止将其作为竞争性知识库/文档服务对外提供，二次开发后做商业化需仔细核对条款；这也阻碍了部分社区贡献与发行版生态。（社区常见讨论点）
- **自托管依赖重**：必须同时维护 PostgreSQL + Redis + S3 兼容存储三个外部服务，还要求配置外部 OIDC 认证提供者，无"单二进制/单容器"开箱即用模式；社区（livemy.app 等教程与 Reddit 讨论）普遍反映其部署复杂度明显高于 Ghost、n8n 等同类自托管应用。
- **中文搜索体验一般**：搜索基于 PostgreSQL 默认全文检索 + trigram，对中文分词支持有限，社区有初始化迁移时扩展/权限报错的案例（r/selfhosted）；重中文场景需自行改造分词器。
- **个人场景偏重**：产品核心面向团队协作（权限、组、访客、SSO），单人知识库用不到大半能力，却仍要承担相应部署复杂度。
- **协作改造门槛**：实时协作基于 Yjs，数据结构被 CRDT 绑定，想替换编辑器或简化为纯 Markdown 存储，二次开发成本不小。

## 对自研轻量知识库的启示

1. **用 PostgreSQL 扛全文搜索**：轻量知识库不必引入 ES/Meilisearch，Postgres FTS + pg_trgm（或中文场景配 zhparser/jieba 分词扩展）即可覆盖"Markdown 笔记 + 全文搜索 + 双向链接反查"的检索需求。
2. **集合 + 文档树 + 标签的三层组织足够好**：结构清晰、实现简单、用户心智负担低，配合 backlinks 表即可实现双向链接，不必上来就做白板/数据库视图。
3. **API 与异步任务分进程**：从第一天就把通知、导入导出、索引重建放进 worker 队列，保证编辑与搜索主链路的响应速度。
