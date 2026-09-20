# Memos

> 调研日期：2026-09-13

## 基本信息

| 项目 | 内容 |
|---|---|
| GitHub 地址 | https://github.com/usememos/memos |
| Stars | 约 63k（62,938，来源：GitHub API，2026-09-13 查询） |
| 主语言 | Go（后端）/ TypeScript（前端，React） |
| 许可证 | MIT |
| 最近更新 | 2026-09-12（pushed_at，持续有提交） |
| 是否活跃维护 | 是，非归档仓库，open issues 约 70，官网 https://usememos.com，当前版本线 0.31.x |

## 定位与核心功能

- **定位**：开源、自托管的"轻量速记"工具（flomo 式），口号 "Fast enough for every thought. Private enough for all of them."，以时间线流形式呈现 Markdown 短内容，刻意不做 all-in-one 工作台。
- **快速捕获**：Markdown 原生写作，可附加图片/媒体，无需标题、文件夹或模板，保存即归档；适合日常随笔、链接收集、工作日志、代码片段。
- **轻量组织**：标签（tag）、置顶（pin）、视图（Views）、归档；没有传统笔记本/文件夹树，组织成本低。
- **可见性与分享**：每条 memo 有灵活的可见性控制（私有 / 登录可见 / 公开），可选择性地将单条内容发布到公网，兼具"私人手账"与"微型博客"两种用法。
- **搜索与过滤**：内置搜索与标签过滤，后端引入 CEL 表达式引擎（google/cel-go）支撑结构化过滤语法。
- **集成能力**：提供 REST + gRPC 双协议 API、Webhooks，并已集成 MCP（Model Context Protocol）；浏览器 Web Clipper（Chrome/Firefox）可把网页、选中文本、图片存为带来源链接的 Markdown。
- **AI 能力（新方向）**：后端依赖中已包含 OpenAI Go SDK、Google GenAI SDK 与 MCP SDK（依据 go.mod），官方文档 Integrations 章节提供 MCP 接入，社区也在推动 AI 语义搜索（issue #6041）；AI 属于新近演进方向而非成熟卖点。
- **数据自主**：自托管、零遥测（zero telemetry）、MIT 开源，官方文档提供备份恢复指南与 Bullet Journal / GTD / Zettelkasten 写作方法论指引。

## 技术架构

- **后端**：Go（go 1.27）+ Echo v5 Web 框架；API 层为 gRPC + protobuf，通过 grpc-gateway / ConnectRPC 同时暴露 REST，一套 proto 定义生成双协议接口。
- **前端**：React + TypeScript 单页应用（仓库 topics 标注 react）。
- **存储**：默认 SQLite（modernc.org/sqlite 纯 Go 实现、无 CGo），依赖中同时保留 MySQL（go-sql-driver/mysql）与 PostgreSQL（lib/pq）驱动及对应 testcontainers 测试；附件/资源支持 S3 兼容对象存储（AWS SDK v2）。
- **认证**：JWT；支持公开访问配置。
- **同步与协作**：无内置多端同步协议，本质是"单实例 Web 服务"，多端通过浏览器访问同一实例实现共享；无离线客户端。
- **部署形态**：单容器自托管为主（`docker run` 一条命令，端口 5230，数据卷 `/var/opt/memos`），官方文档覆盖 Docker Compose、Kubernetes、源码构建、反向代理 TLS；无桌面/移动原生应用。

## 设计亮点

- **把"一条笔记"的建模做到最简**：内容 + 可见性 + 标签，几乎没有其他必填概念，录入摩擦极低——这是它能同时当私人笔记和轻博客的关键，对自研产品定义"最小数据模型"很有参考价值。
- **单容器 + SQLite 的极致部署体验**：一个二进制/一个容器、一个数据目录即全部状态，备份=拷目录；modernc 纯 Go SQLite 又免掉了 CGo 交叉编译负担，自托管门槛几乎为零。
- **API 优先的工程结构**：gRPC/protobuf 定义为唯一事实源，grpc-gateway 自动派生 REST，另有 Webhook 与 MCP，二次开发与自动化集成成本很低。
- **可见性粒度做在"单条内容"上**：私密/受保护/公开三档按 memo 控制，天然支持"选择性分享"，比整站公私切换灵活。

## 不足与局限

- **组织模型单一，不适合长文与结构化知识库**：没有笔记本/层级树、双向链接与知识图谱，内容多了之后时间线 + 标签的组织能力会成为瓶颈，与"个人知识库"的定位有明显差距。
- **中文搜索体验不佳（社区反馈）**：搜索基于 SQLite FTS/关键词匹配，FTS5 默认分词器（unicode61）按空格切词、不支持 CJK，中文按词检索效果差；社区 issue 中有公开内容不可搜（#3144、#4787）、希望引入语义搜索（#6041）等反馈，常见解法是换用支持中文分词的 FTS5 扩展（如 wangfenjin/simple）或 LIKE/trigram 兜底。
- **大版本重构有伤元气的历史**：v0.22 前后从 Vue 迁到 React、一度移除外部数据库支持，曾引发社区争议与迁移成本（当前代码已重新包含 MySQL/PG 驱动）；对二次开发而言，核心模型仍在快速演进期，跟进成本不低。
- **无官方移动端与离线能力**：移动体验依赖响应式 Web；一旦服务器不可达即无法读写，"随时记录"的核心场景在弱网下不成立。
- **插件/生态较薄弱**：无插件系统，扩展基本靠改代码或外挂服务（社区讨论 #1252 中用户明确希望标签管理与插件系统优先）。

## 对自研轻量知识库的启示

- **数据模型先做减法**：以"内容 + 标签 + 可见性"为最小内核起步，组织功能（笔记本/层级/双链）作为可后加的视图层，避免一开始就被复杂结构拖慢迭代。
- **部署体验即竞争力**：单二进制 + SQLite + 一个数据目录的形态值得照抄，能把自托管门槛和运维心智降到最低；备份恢复应是第一天就设计好的能力。
- **API 层用"单一 schema 派生多协议"**：定义一套接口契约同时产出 REST（页面用）与程序化 API，并预留 Webhook/MCP，为自动化与 AI 集成留好插座。

---

*数据来源：GitHub API（api.github.com/repos/usememos/memos，2026-09-13）、仓库 README 与 go.mod（raw.githubusercontent.com）、官方文档 usememos.com/docs、社区 issue #1252/#3144/#4787/#6041。*
