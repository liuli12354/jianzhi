# Docmost

> 调研日期：2026-09-13

## 基本信息

| 项目 | 内容 |
| --- | --- |
| GitHub 地址 | https://github.com/docmost/docmost |
| Stars | 约 21.7k（来源：GitHub API `stargazers_count=21655`，2026-09-13 查询） |
| 主语言 | TypeScript（NestJS 后端 + React 前端） |
| 许可证 | AGPL-3.0（核心，GitHub API 确认）；企业版（EE）功能为企业专有许可，代码位于 `apps/server/src/ee`、`apps/client/src/ee`、`packages/ee` |
| 最近更新时间 | 2026-09-12（GitHub API `pushed_at`） |
| 是否活跃维护 | 是，持续提交（2023-08 创建，约 1.1k+ commits），未归档 |

## 定位与核心功能

- 定位为开源协作 wiki 与文档软件，明确对标 Confluence 和 Notion，主打"Confluence 的替代品"这条差异线。
- 编辑体验：基于 Tiptap（ProseMirror）的富文本编辑器，支持表格、代码块、LaTeX、多栏布局、slash menu（`/` 命令）、智能提及（`@` 提及成员或链接内部页面）；内置 Draw.io、Excalidraw、Mermaid 三种图表能力。
- 组织方式：空间（Spaces）作为顶层容器（按团队/项目划分），内部页面层级组织；近期版本还加入了 Bases（类似数据库视图）与 Kanban 看板模块（官网导航展示 Pages / Bases / Kanban 三大板块）；支持跨空间页面提及，构成类双向链接。
- 搜索：常规搜索支持页面与 PDF、DOCX 附件内容检索；AI Search 提供语义搜索（"理解意图而非仅关键词"），跨所有空间即时返回结果。
- 同步与协作：实时协作编辑（live cursors 实时光标、多端即时同步）；页面级评论、页面历史（版本回溯）、群组与 RBAC 权限管理。
- 发布分享：可公开分享选定页面，快速搭建对外公开 wiki。
- 导入导出：支持从 Confluence、Notion 导入，以及 HTML、Markdown 文件导入（官网未突出导出能力）。
- AI 能力（近年重点）：可接自托管或云端 LLM（Ollama、vLLM、OpenAI、Gemini、Azure OpenAI 及任何 OpenAI 兼容接口）；AI Chat 对话式问答带来源引用（可上传 PDF/DOCX 追问）；AI 语义搜索；可将知识库作为 MCP server 暴露给 Claude、Cursor 等客户端，"开放协议、无厂商锁定"。
- 其他：10+ 语言翻译（Crowdin）、文件附件、嵌入 Airtable/Loom/Miro；企业版另有 SSO（SAML 2.0 / OIDC / LDAP、MFA）、页面验证审批（面向 ISO 9001/27001、SOC 2 合规）、隔离网络部署。

## 技术架构

- 前端：React（Vite），pnpm + Nx 管理的 monorepo（`apps/client`、`apps/server`、`packages/*`）。
- 后端：NestJS（Node.js/TypeScript）单体 API，同时承载服务端渲染的 React 前端。
- 编辑器与协作：Tiptap（ProseMirror）+ Yjs（CRDT）+ Hocuspocus（Tiptap 团队的 Yjs WebSocket 协作后端）。
- 存储：PostgreSQL（必需，官方要求较新版本）；配合 Redis（缓存/队列/会话）；文件附件与上传走服务器存储。
- 部署形态：Docker / docker-compose 自托管（单容器 + 外置 Postgres/Redis），另有官方云服务（docmost.com 订阅制）；企业版支持 air-gapped 隔离网络与私有数据中心部署。

## 设计亮点

1. **成熟开源组件的组合极简主义**：NestJS + React + Tiptap + Yjs + Hocuspocus + PostgreSQL，全部是文档验证充分的主流组件，没有自研编辑器内核或自研同步引擎——用最小自研面积做到实时协作，是"小团队做协作产品"的优秀工程范本。
2. **AI 面向开放生态设计**：LLM 可完全自托管（Ollama/vLLM）、AI 答案强制带来源引用、知识库可暴露为 MCP server 供任意 AI 客户端调用——把知识库定位成 AI 工具链的数据底座，方向与行业趋势一致。
3. **AGPL 核心 + EE 目录的清晰分层**：社区版功能完整可用（空间、协作、搜索、图表、导入），企业专有功能集中在 `ee` 目录物理隔离，商业化边界一目了然，避免了"代码混在一起分不清哪些能用"的常见混乱。
4. **Confluence 迁移作为获客与产品主线**：从导入器到页面验证/审批/合规能力都围绕"企业从 Confluence 逃离"设计，产品叙事与功能优先级高度一致。

## 不足与局限

- **AGPL-3.0 对二次开发不友好**：修改后对外提供网络服务即须开源整套修改，商业公司内部评估、二次分发、SaaS 化都受限；这是其相比 MIT/Apache 项目最大的生态约束。
- **社区版与企业版的功能边界**：SSO（SAML/OIDC/LDAP）、MFA、页面验证审批等进阶能力在 EE 专有目录中，自托管社区版在多团队接入场景下能力有限。（官方定价与仓库结构）
- **项目相对年轻**：2023 年 8 月创建、约 1.1k commits，API 稳定性与长期演进承诺不如 Outline（2016 起）或 AFFiNE，大版本升级（如新增 Bases/Kanban）仍处于快速变动期，跟随成本需考虑。
- **搜索的中文体验存疑**：常规搜索基于 PostgreSQL 全文检索（同 Outline 的路线），对中文分词支持有限，官网宣传的 AI 语义搜索可弥补但依赖配置 LLM 服务；具体中文体验以实测为准（基于技术路线的推断，未见权威社区结论）。
- **部署仍需多个外部服务**：单容器之外仍需自备 PostgreSQL 与 Redis，并常需单独规划对象存储，比单二进制类工具（如 Memos）重；轻量个人场景有"杀鸡用牛刀"之嫌。

## 对自研轻量知识库的启示

1. **实时协作可以直接站在 Hocuspocus + Yjs 肩膀上**：不必自研同步协议，Tiptap/Yjs/Hocuspocus 组合让两三人团队也能拥有多人实时编辑；若只做单人文档，可降级为纯 Markdown 存储而保留同一编辑器内核。
2. **把知识库当 AI 的数据源来设计**：提供 OpenAI 兼容的模型接口配置、答案带引用、（可选）MCP server 暴露，都是小改动大价值的方向。
3. **用目录级物理隔离做开源/商业分层**：若自研项目未来也要商业化，学习 Docmost 把 EE 功能集中在独立目录、社区版保持完整可用的做法。
