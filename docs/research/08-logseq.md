# Logseq

> 调研日期：2026-09-13

## 基本信息

| 项目 | 内容 |
| --- | --- |
| GitHub 地址 | https://github.com/logseq/logseq |
| Stars | 约 44.9 k（44,877，来源：GitHub API，2026-09-13） |
| 主语言 | Clojure（ClojureScript） |
| 许可证 | AGPL-3.0 |
| 最近更新时间 | 2026-09-11（GitHub API `pushed_at`） |
| 是否活跃维护 | 是（未归档；但注意 open issues 约 942 个，DB 版重构是当前重心） |

## 定位与核心功能

官方定位为 "A privacy-first, open-source platform for knowledge management and collaboration"，强调 privacy、longevity、user control 三大价值。产品形态脱胎于 Roam Research（每日笔记 + 双向链接 + 块级引用），但免费开源。

- **编辑体验**：以大纲（outliner）为核心——一切内容都是层级化 block，社区评价其为 "a full featured WYSIWYG outliner"；块级编辑、缩进折叠、块拖拽。
- **组织方式**：Journal 每日笔记作为默认入口（灵感来自 Roam 的 daily notes 工作流）；块级双向链接（`[[页面]]` 与块引用）+ 图谱视图；命名空间（页面层级）与标签；TODO/DOING/DONE 任务管理与优先级标记。
- **搜索与查询**：全文搜索之外提供高级 Datalog 查询（基于 DataScript 的 query 引擎），可构建复杂动态视图；DB 版进一步引入统一 nodes、类型化属性、tags-as-classes 模型。
- **知识加工**：PDF 标注（标注内容自动带回链接到原文）、内置闪卡（`#card` / `#card2` 标签，SM-5 间隔重复算法）、白板（whiteboards，空间化思维）、任务管理。
- **同步与协作**：Logseq Sync（RTC 实时协作架构）目前为 beta，仅面向赞助者（backers）；README 明示 DB 版 "data loss is possible"，建议定期备份 SQLite。
- **发布分享**：支持将图谱发布为静态站点（publish 功能），可托管分享只读笔记。
- **导入导出**：文件版原生支持 Markdown 与 Org-mode 双格式；DB 版支持单向 Markdown 导出（双向同步仍在开发）。
- **扩展生态**：插件与主题生态（SCI Clojure 解释器驱动插件系统），移动端 App 提供桌面大部分功能。

## 技术架构

- **语言与运行时**：主语言 Clojure/ClojureScript（函数式、不可变数据结构贯穿前后端）。
- **核心组件**：DataScript（ClojureScript 端的不可变数据库 + Datalog 查询引擎，块与页面关系全部内存化存储）；mldoc（OCaml 实现的 Markdown/Org 解析器）；isomorphic-git（纯 JS Git 实现，用于文件版版本控制/同步基础）；SCI（小型 Clojure 解释器，支撑插件沙箱）。
- **存储方案**：
  - 文件版（经典版）：local-first，数据为本地纯文本 Markdown/Org 文件 + JSON 元数据，用户可用任何工具直接管理文件。
  - DB 版（Logseq 2.0）：转向 SQLite 数据库图（DB graphs），文件图需一次性导入转换，两者不直接兼容。
- **同步机制**：基于 RTC（Real Time Collaboration）的同步服务，多设备同步与多人协作共用一套机制，尚在 alpha/beta。
- **部署形态**：桌面应用（Windows/macOS/Linux，GitHub Releases 分发）、Web 版（app.logseq.com，也可 Docker 自部署）、移动端（文件版成熟；DB 版 iOS 为 alpha，Android "coming soon"）。

## 设计亮点

1. **纯文本优先（longevity 的具体化）**：数据是本地 Markdown/Org 明文，"privacy-first, longevity, user control" 不只是口号——即使项目停更，笔记依然完整可用。这是对"数据主权"最有说服力的实现方式。
2. **Journal 作为记录入口**：以每日笔记降低记录的心理门槛（先记下来，再靠双链组织），配合块级引用，形成"输入零摩擦、组织事后化"的工作流，对个人知识库的记录习惯养成非常有效。
3. **块级双链粒度**：不仅可以链接页面，还可以引用任意 block，反链面板能精确到段落——比多数"页面级双链"工具信息密度更高。
4. **DB 版的建模思路**：统一 nodes、类型化属性、tags-as-classes（标签即类），实质是把知识库往"带类型的知识图谱 + 查询引擎"方向演进，其属性/类型设计可资借鉴。
5. **查询驱动视图**：Datalog 查询让"标签/属性筛选"升级为可编程视图，是搜索之外组织知识的高阶手段。

## 不足与局限

1. **DB 版迁移长期且具破坏性**：文件版 → DB 版是断代式重构，DB 版至今仍为 beta、移动端与 RTC 为 alpha，官方自己在 README 中警告 "data loss is possible"；老用户迁移需整体导入，生态被长期割裂在两个版本之间（社区对发布时间线多有抱怨）。
2. **技术栈门槛极高**：Clojure/ClojureScript + DataScript + OCaml 解析器对普通贡献者非常不友好，社区以使用为主、贡献为辅；fork 或自研修改成本大（社区共识）。
3. **文件版性能瓶颈**：文件版将整个图加载进内存（DataScript），图谱变大后启动与搜索性能明显下降，是社区长期反馈的痛点；这也是转向 DB 版的根本原因。
4. **问题积压**：GitHub open issues 约 942 个，修复节奏受制于核心团队规模与重构优先级。
5. **核心服务闭源倾向**：Logseq Sync 仅面向付费赞助者，与"开源平台"的期待存在落差；自托管完整同步方案并不成熟。

## 对自研轻量知识库的启示

1. **Journal + 双链的组合是个人记录的最佳起点**：一个按日期组织的输入流 + 反链面板，就能覆盖大部分个人知识管理场景，实现成本低、体验增益大。
2. **存储格式从第一天就要押注正确**：Logseq 的文件版 → DB 版迁移付出了数年重构与社区割裂的代价。自研项目如果目标是轻量、单机/自托管，直接选定"Markdown 文件或 SQLite"之一并坚持到底，避免中途换引擎。
3. **查询能力可以后置，但数据模型要预留**：标签、属性、块的链接关系在数据层就应结构化存储（关系表/索引），日后无论做全文搜索、筛选视图还是图谱，都不需要迁移数据。
