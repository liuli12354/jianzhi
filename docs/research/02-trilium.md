# Trilium Notes

> 调研日期：2026-09-13

> **仓库归属说明（重要）**：原仓库 zadam/trilium 已由原作者停止维护并转交社区；社区接手项目曾使用仓库名 **TriliumNext/Notes**（该仓库已于 2025-06-24 归档，archived=true），随后更名为 **TriliumNext/Trilium** 作为现行仓库。目前 GitHub 访问 zadam/trilium 会直接重定向到 TriliumNext/Trilium。本文以现行仓库 **TriliumNext/Trilium** 的信息为准。

## 基本信息

| 项目 | 内容 |
|---|---|
| GitHub 地址 | https://github.com/TriliumNext/Trilium（原 https://github.com/zadam/trilium 已重定向至此） |
| Stars | 约 37.8k（37,804，来源：GitHub API，2026-09-13 查询，含原 zadam/trilium 继承 star） |
| 主语言 | TypeScript（全栈 JavaScript/TypeScript） |
| 许可证 | AGPL-3.0（版权：Copyright 2017-2025 zadam, Elian Doran, and other contributors） |
| 最近更新 | 2026-09-12（pushed_at，持续有提交） |
| 是否活跃维护 | 是，非归档仓库，open issues 约 679，官网 https://triliumnotes.org，文档 https://docs.triliumnotes.org |

## 定位与核心功能

- **定位**：免费开源、跨平台的**层级式（树状）笔记应用**，明确面向"构建大型个人知识库"（hierarchical note taking application with focus on building large personal knowledge bases），官方声称在 10 万条以上笔记规模下仍保持良好可用性与性能。
- **组织方式**：笔记组成任意深度的树；单条笔记可通过**克隆（clone）**同时挂在树的多个位置；另有属性系统（labels/relations，支持继承）用于组织、查询与自动化。
- **编辑体验**：CKEditor 5 所见即所得富文本编辑器（表格、图片、数学公式，支持 Markdown 自动格式化）；代码类笔记用 CodeMirror 提供语法高亮；还提供 Excalidraw 画布、关系图/链接图、思维导图（Mind Elixir）、地理地图（Leaflet，含 GPX 轨迹）等多种笔记类型。
- **导航与搜索**：快速跳转、全文搜索、笔记提升（hoisting，把某棵子树临时作为根视图）；支持笔记版本历史（note revisions）。
- **同步**：与**自托管同步服务器**同步（官方也列出第三方托管同步服务）；移动端提供触屏优化的移动 Web 界面，另有第三方原生客户端 TriliumDroid（Android）、Trinote（iOS）等。
- **发布分享**：可将任意笔记发布到公网（内置 share 功能）。
- **安全**：单条笔记粒度的强加密（protected notes）；登录集成 OpenID 与 TOTP 双因素。
- **导入导出与剪藏**：支持 Evernote 与 Markdown 导入导出；提供 Web Clipper；脚本系统 + ETAPI REST API 支持深度自动化；UI 多语言（含简体/繁体中文，经 Weblate 协作翻译）。

## 技术架构

- **总体架构**：**客户端-服务器同构（client-server）**——即使桌面模式也是 Electron 在同一进程内同时运行后端服务器与前端客户端；服务器模式则将同一套后端以独立 Node.js Web 服务运行，浏览器访问的 Web UI 与桌面 UI 几乎完全一致。桌面与服务器共享同一代码库，双端维护成本低。
- **前端**：TypeScript + CKEditor 5（富文本）、CodeMirror（代码）、FancyTree（树）、jsPlumb（关系图连线）、Tabulator（表格）、Excalidraw/Mind Elixir/Leaflet（各类特殊笔记）；包管理 pnpm，桌面打包 Electron（electron-forge）。
- **后端**：Node.js（TypeScript）。
- **存储**：**单文件 SQLite**——所有笔记内容、树结构、元数据与绝大多数配置都存在一个 SQLite 数据库文件中（笔记正文以 HTML 形式存储）。
- **同步机制**：服务器中转式（server-mediated）同步，客户端之间不直接 P2P；由服务器作为中央权威处理变更合并。依赖自有的同步协议，同步协议版本随大版本递增。
- **部署形态**：三种形态并存——桌面应用（Windows/macOS/Linux，Electron）、自托管服务器（含 Docker 镜像 triliumnext/trilium，浏览器访问）、移动端（移动 Web + 第三方原生客户端）。

## 设计亮点

- **"属性系统"作为可编程元数据层**：labels（标签）与 relations（关系）是一等公民，支持继承，可被查询引擎和脚本消费——相当于把标签、双向链接、自动化配置统一到一套元数据机制上，扩展性极强，非常值得借鉴。
- **树 + 克隆 + 关系图的混合组织模型**：既有确定性的层级树（符合人脑分类直觉），又允许克隆/链接打破单一归属，比"纯文件夹"或"纯标签"都更接近真实知识管理需求。
- **同构 client-server 架构**：桌面版 = 内嵌服务器，自托管版 = 同一套服务器独立跑，一份代码覆盖桌面/自托管/浏览器三形态，大幅降低双端功能漂移和同步兼容成本。
- **大库性能工程**：SQLite 单文件 + 惰性加载树节点，官方明确以 10 万级笔记为设计目标，对"知识库要能用十年"的定位给出了可信支撑。

## 不足与局限

- **上手成本高（社区普遍反馈）**：概念密度大（笔记类型、属性、继承、模板、脚本、hoisting 等），默认界面信息量大，新用户需要投入明显学习成本才能用出价值；它更像"可编程知识库"而非开箱即用笔记。
- **非 Markdown-first 的存储格式**：正文以 HTML 存于 SQLite，Markdown 支持是"导入导出 + 编辑器自动格式化"级别，与外部 Markdown 工具链（Git、Obsidian、静态站点生成器）互通有损；数据可移植性和"纯文本信仰"用户是痛点。
- **维护主体两次更迭、协议曾断裂**：原作者 zadam 停止维护 → TriliumNext 接手（TriliumNext/Notes 又一度归档、更名现仓库）；TriliumNext v0.90.4 及更早版本兼容 zadam 最后版本 v0.63.7，之后的同步协议版本号递增、无法直接迁移，老用户升级与长期维护连续性存在不确定性。
- **资源占用偏高**：Electron 桌面端 + 常驻 Node 进程（服务器模式同样需要），内存占用在同类自托管笔记中不占优；对"轻量"需求是明显负担。
- **官方移动端缺位**：移动方案依赖移动 Web 或第三方客户端，且第三方客户端对服务器版本要求苛刻（如 TriliumDroid 要求关闭服务器自动更新、同步版本严格匹配），移动体验不是一等公民。

## 对自研轻量知识库的启示

- **给笔记一个统一的"属性/关系"元数据层**：标签、双向链接、自定义字段都建模为属性，查询与自动化消费同一份数据，比分别实现标签表 + 链接表 + 配置字段更简洁、更可扩展。
- **层级树与双向链接并非二选一**：树负责确定性归类，克隆/链接负责交叉引用；自研时可用"树 + 链接表"低成本拿到 Trilium 混合模型八成的组织能力。
- **SQLite 单文件 + 服务端渲染/同构单体的路线已被验证可支撑 10 万级笔记**：不必为了"知识库"直接上重型分布式存储；同时要吸取其教训——存储格式尽量贴近 Markdown 纯文本，保住数据可移植性与二次开发友好度。

---

*数据来源：GitHub API（api.github.com/repos/TriliumNext/Trilium 及 TriliumNext/Notes，2026-09-13）、仓库 README（raw.githubusercontent.com/TriliumNext/Trilium）、官方文档 docs.triliumnotes.org（Architecture / Database / Synchronization 页面）、原作者访谈（console.substack.com/p/console-169）。*
