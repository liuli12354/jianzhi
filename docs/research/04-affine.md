# AFFiNE

> 调研日期：2026-09-13

## 基本信息

| 项目 | 内容 |
| --- | --- |
| GitHub 地址 | https://github.com/toeverything/AFFiNE |
| Stars | 约 72.5k（来源：GitHub API `stargazers_count=72490`，2026-09-13 查询） |
| 主语言 | TypeScript（客户端/服务端）+ Rust（OctoBase 同步引擎、y-octo CRDT） |
| 许可证 | GitHub 标注 NOASSERTION（"Other"）：仓库为多许可组合，README 称社区版（CE）为 MIT，但社区对其"MIT"宣传存在争议（参见 r/foss 讨论帖），部分企业功能另有专有条款 |
| 最近更新时间 | 2026-09-10（GitHub API `pushed_at`） |
| 是否活跃维护 | 是，持续高频率提交，未归档，open issues 约 735 |

## 定位与核心功能

- 定位为"Notion + Miro"的开源替代：文档（Docs）与白板（Whiteboard）合一，二者共用同一个无边框画布数据模型，富文本、便签、嵌入网页、形状、幻灯片都可平铺在画布上。
- 编辑体验：自研 BlockSuite 块编辑器内核，"一切皆 block"；支持多视图数据库（表格/看板等）、页面双向链接、模板库（Cornell 笔记、愿景板等官方模板）。
- 组织方式：以工作区（Workspace）为顶层单位，内部混合"页面树 + 画布 + 数据库（集合/标签，参考 Capacities 的对象标签理念）"多维组织。
- 搜索：本地优先索引（桌面端内置本地索引器），支持全库搜索；中文搜索体验在社区反馈中一般。
- 同步与协作：local-first——数据默认存本地磁盘，通过 CRDT（y-octo / yjs）实现 Web 与跨平台客户端的实时同步与多人协作；自托管服务器可充当同步后端。
- 发布分享：支持将文档/画布以链接形式对外发布（Publish），云版提供更完整的分享能力。
- 导入导出：支持 Markdown 导入导出、HTML 导出、Notion 导入等（README 未详细展开，以官方文档为准）。
- AI 能力：AFFiNE AI 多模态助手——报告撰写、大纲转幻灯片、文章转思维导图、任务规划，甚至用 prompt 生成应用/网页原型；Canvas AI 支持头脑风暴生成思维导图。

## 技术架构

- 前端：React + Jotai（状态管理）+ Vite 构建，全 TypeScript。
- 编辑器内核：BlockSuite（toeverything 自研的开源协作编辑器框架，block 级数据模型与 MVVM 渲染）。
- 后端：Node.js（TypeScript）；通过 napi-rs 集成 Rust 原生模块。
- 同步/存储核心：y-octo（Rust 实现的高性能线程安全 Yjs CRDT 引擎）+ OctoBase（Rust 编写的轻量本地优先数据引擎）；Web 端状态同步使用 yjs。
- 部署形态：
  - 桌面应用：Electron 跨平台客户端（macOS/Windows/Linux）；
  - 自托管：推荐 Docker，另有 Render（render.yaml）、Sealos 一键部署；
  - 云服务：官方 app.affine.pro（订阅制，AI 与云同步为付费点）。

## 设计亮点

1. **文档与白板统一在一个块模型里**：不区分"笔记页面"和"白板文件"，同一个数据结构既可线性阅读也可自由排布，避免了笔记工具与白板工具之间的数据孤岛。这来自 Quip/Notion 的"everything is a block"理念并更进一步。
2. **真正的 local-first 架构**：数据先落本地、CRDT 负责多端合并，离线可用、服务器只做同步中枢；对自研项目而言，"本地为源、同步为附加"的分层很值得参考。
3. **BlockSuite 块编辑器内核的可扩展设计**：编辑器被抽成独立可复用的开源项目，块类型可插拔、支持协作，是"自研编辑器内核"路线的参考样本（也可直接评估复用）。
4. **多视图数据库 + 对象标签**：同一条数据可切换表格/看板/画布视图，标签作用于"对象"而非仅页面，信息组织维度比"文件夹树"更丰富。

## 不足与局限

- **资源占用偏高**：桌面端社区反馈明显——GitHub Issue #14006 报告内存可涨到 32GB+（疑似泄漏），#12132 报告 Windows 空白页打字也有极高 CPU 占用；官方自托管文档也承认单文档 1 万次修改合并时内存峰值可达约 1GB。（来源：GitHub Issues / 官方文档）
- **自托管同步链路问题较多**：Reddit r/Affine 与官方社区有大量"Syncing 卡住 / connect to remote timeout / 移动端不同步（Issue #13014，反向代理场景）"反馈；自托管体验中还存在持续引导"切换到 AFFiNE Cloud"的干扰弹窗。（来源：Reddit、AFFiNE 社区论坛）
- **许可证与商业化策略有争议**：README 宣称 CE 为 MIT，但仓库 license 为 NOASSERTION 的多许可组合，r/foss 曾有高热度帖子批评其"并非真正的 MIT"；二次开发前需逐目录核对许可条款。（来源：Reddit r/foss）
- **技术栈复杂、二次开发门槛高**：TypeScript + Rust 双语言、BlockSuite + OctoBase + Electron + CRDT 全家桶，个人或小团队想深度定制成本很高；整体面向"对标 Notion"的全功能定位，对轻量需求而言架构包袱重。
- **移动端与细节完成度**：移动端体验明显弱于桌面端；社区反馈存在复制粘贴、图片加载等毛边问题。（来源：Reddit、Tooliverse 评测）

## 对自研轻量知识库的启示

1. **数据模型先行**：借鉴 BlockSuite 的"一切皆 block"统一数据模型，把笔记段落、待办、图片都设计成可被引用、可被标签/搜索作用的一等公民，为双向链接和后续白板/数据库视图留扩展空间。
2. **本地优先 + 增量同步的分层设计**：即使不做 CRDT，也应采用"本地数据为源、服务端只做同步与备份"的结构，天然获得离线能力，且避免把 UI 绑死在服务器接口上。
3. **克制功能范围**：AFFiNE 的复杂度证明"文档+白板+数据库+AI"全都要会带来资源与维护成本失控；轻量知识库应聚焦 Markdown 笔记 + 标签 + 全文搜索 + 双向链接这条主线。
