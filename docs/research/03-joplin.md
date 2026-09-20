# Joplin

> 调研日期：2026-09-13

## 基本信息

| 项目 | 内容 |
|---|---|
| GitHub 地址 | https://github.com/laurent22/joplin |
| Stars | 约 56k（56,339，来源：GitHub API，2026-09-13 查询） |
| 主语言 | TypeScript（monorepo，含桌面/移动/CLI/服务器多端代码） |
| 许可证 | AGPL-3.0-or-later（采用按目录覆盖机制，部分子包如 packages/server 有独立 LICENSE；logo 与商标不在 AGPL 范围，版权 Laurent Cozic） |
| 最近更新 | 2026-09-12（pushed_at，持续有提交） |
| 是否活跃维护 | 是，非归档仓库，open issues 约 638，官网 https://joplinapp.org，创建于 2017-01，社区成熟（Discourse 论坛/Discord 等） |

## 定位与核心功能

- **定位**：免费开源、注重隐私的**多平台笔记 + 待办应用**，核心理念是 **offline first（离线优先）**——所有数据始终保存在本地设备，离线可完整读写，网络仅用于同步。
- **编辑与组织**：笔记以 Markdown 存储（开放格式，可用任意文本编辑器直接修改）；组织方式为可嵌套的**笔记本（notebook）树 + 标签 + 待办（todo，支持闹钟提醒）**；同时内置富文本 WYSIWYG 编辑器，可与 Markdown 编辑器一键切换。
- **搜索**：全平台全文搜索；**内置 OCR**——自动提取图片/PDF 中的文字并纳入搜索（右键"View OCR text"可查看）。
- **同步与协作**：同步目标非常广——Nextcloud、Dropbox、OneDrive、WebDAV、S3、文件系统、官方付费 **Joplin Cloud**，以及可自托管的 **Joplin Server**（Docker 部署，仅作同步目标）；所有同步均支持**端到端加密（E2EE）**；笔记本共享协作依赖 Joplin Cloud 付费服务。
- **笔记历史**：内置笔记版本历史（note revisions），按间隔保留快照、多端同步、保留时长可配置，可恢复误删笔记。
- **导入导出**：Evernote ENEX 导入（含格式、附件、地理位置等元数据并自动转 Markdown）、纯 Markdown 导入；浏览器 Web Clipper（Chrome/Firefox）可剪藏网页与截图。
- **扩展生态**：插件与主题系统（开发者数据 API），社区插件生态活跃（如离线 OCR 插件等）。
- **AI 能力**：核心未内置 AI 功能，AI 相关能力主要由社区插件提供。

## 技术架构

- **总体结构**：TypeScript monorepo（packages/ 目录），核心业务逻辑沉淀在共享库中，四个应用形态复用同一内核：**app-desktop**（Electron，Windows/macOS/Linux）、**app-mobile**（React Native，Android/iOS）、**app-cli**（终端版）、**server**（自托管同步服务器）。
- **前端/客户端**：桌面 Electron + React；移动端 React Native；编辑器为自研 Markdown 编辑器与富文本（TinyMCE 系）双编辑器。
- **存储**：本地 **SQLite** 数据库存放笔记、元数据与索引，附件以文件/资源形式存放；Markdown 文本为主体的开放数据格式。
- **同步机制**：抽象出统一"同步目标（sync target）"接口，对接各类网盘与自有服务器；同步内容支持 E2EE（主密钥加密后再上传）；Joplin Server 仅承担同步中转与账户管理，不提供 Web 端笔记读写界面。
- **部署形态**：以**本地客户端矩阵**为主（桌面 + 移动 + CLI + 浏览器剪藏扩展），可选自托管 Joplin Server 作同步后端，或直接使用官方 Joplin Cloud 托管；没有可直接在浏览器里编辑笔记的 Web 应用。

## 设计亮点

- **同步目标抽象层 + E2EE 组合**：一套同步框架适配 Dropbox/OneDrive/WebDAV/S3/Nextcloud/本地目录/自建 Server，用户把已有网盘零成本变成同步后端；再叠加端到端加密，做到"数据放在不可信网盘上也不泄密"。这是多端同步问题的教科书式解法。
- **离线优先 + 开放格式的数据主权**：本地 SQLite + Markdown 文本 + 附件目录，数据不锁定在任何云上，可随时整库带走；"离线可用"而非"云优先"的产品价值观贯穿始终。
- **monorepo 共享内核的多端策略**：一套核心库（同步引擎、数据模型、搜索）支撑桌面/移动/CLI 三端，功能与同步行为天然一致，是做"多端笔记应用"工程组织的直接范本。
- **OCR 直接并入全文搜索**：图片/PDF 文字被提取后可被全局搜索命中，把"附件内的知识"纳入了统一检索，对小而全的知识库非常实用。

## 不足与局限

- **没有 Web 端（社区常见抱怨）**：自托管 Joplin Server 只是同步目标，浏览器中无法读写笔记；想随时随地查看内容必须装客户端，与 Memos/Trilium 的"浏览器即用"体验相反。
- **中文搜索体验长期不佳（社区反馈）**：搜索实现面向英文设计、缺乏中文分词，中文词经常搜不到；社区通行绕法是给关键词加 `*` 通配符，或借助第三方工具（如 rxliuli/joplin-utils）做分词增强检索；根源与 SQLite FTS 不支持 CJK 类似（知乎专栏、小众软件论坛均有讨论）。
- **资源占用与代码体量大**：Electron 桌面端内存/包体积偏高；monorepo 含桌面/移动/CLI/服务器四套形态，代码库庞大，对二次开发者而言上手成本明显高于小型项目。
- **双编辑器切换有数据风险（官方论坛警告）**：Markdown 与 WYSIWYG 编辑器互切可能导致部分格式丢失；富文本下不少插件不生效，复杂排版（表格等）能力一般。
- **同步与协作的边界**：WebDAV/网盘同步在大量附件时易出问题（如 WebDAV 429 限流、资源同步失败，GitHub issue #8185）；笔记本共享协作仅限官方付费 Joplin Cloud，自托管无协作编辑能力。

## 对自研轻量知识库的启示

- **把同步做成"目标适配器"而非自有协议优先**：先抽象一个同步目标接口，让 WebDAV/S3/对象存储等现成网盘即插即用并叠加 E2EE，能以最小代价解决个人用户多端同步，避免一开始就维护自有同步服务器。
- **本地优先 + 纯文本数据格式是长期正确的底座**：笔记正文保持 Markdown、索引与元数据放 SQLite，既保证离线可用，又让数据随时可迁移——这与 Trilium 的 HTML 存储形成正反对照。
- **警惕"多端"的范围膨胀**：Joplin 四端并存带来了巨大维护面；自研轻量知识库更现实的路径是"Web 应用（响应式覆盖移动）+ 数据格式开放"，先把一端做扎实。

---

*数据来源：GitHub API（api.github.com/repos/laurent22/joplin，2026-09-13）、仓库 README 与 LICENSE（raw.githubusercontent.com/laurent22/joplin）、官方文档 joplinapp.org/help（OCR、Note History 等页面）、社区讨论（discourse.joplinapp.org、meta.appinn.net、zhuanlan.zhihu.com/p/675959503、github.com/laurent22/joplin/issues/8185）。*
