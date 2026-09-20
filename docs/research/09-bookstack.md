# BookStack

> 调研日期：2026-09-13

## 基本信息

| 项目 | 内容 |
| --- | --- |
| GitHub 地址 | https://github.com/BookStackApp/BookStack（已迁移，GitHub 仅保留迁移说明；正式仓库：https://codeberg.org/bookstack/bookstack，默认分支 `development`） |
| Stars | 约 19.0 k（19,038，来源：GitHub API，2026-09-13） |
| 主语言 | PHP（约 76%，另 TypeScript 约 17%） |
| 许可证 | MIT（README 原文："The BookStack source is provided under the MIT License"） |
| 最近更新时间 | 2026-09-11（GitHub API `pushed_at`；开发主阵地在 Codeberg，持续活跃） |
| 是否活跃维护 | 是（未归档；2025 年已整体从 GitHub 迁移至 Codeberg，开发与 issue 均在 Codeberg 进行） |

## 定位与核心功能

官方定位："BookStack is an opinionated documentation platform that provides a pleasant and simple out-of-the-box experience"——一个面向文档/wiki 场景的自托管平台，而非网状双链笔记。设计哲学是新手"only basic word-processing skills should be required"即可上手。

- **编辑体验**：默认简单 WYSIWYG 编辑器（TinyMCE/Lexical 系），可选带实时预览的 Markdown 编辑器（CodeMirror + markdown-it）；内置 diagrams.net 画图能力，可在页面中直接绘制图表。
- **组织方式**：内容强制三层结构——"all content is broken into three simple real world groups"，即 Books → Chapters → Pages，另支持跨书排序（cross-book sorting）；配合 Content Tags 标签体系做多维筛选；支持页面级段落锚点直链（"link directly to any paragraph"）。没有双向链接与知识图谱。
- **搜索**：全站全文搜索（"The content in BookStack is fully searchable"），可按书内或跨书/章/页检索，支持高级搜索过滤。
- **权限与协作**：完整的角色与权限系统（"A full role and permission system allow you to lock down content and actions"），支持按书/章/页粒度授权；认证集成 OIDC、SAML2、LDAP 及第三方社交登录；内置 MFA 双因素认证（TOTP + 备份码，可按角色强制开启）。多人协作基于页面修订（page revisions）而非实时协同编辑。
- **发布分享**：页面可设公开访问；支持生成导出分享（PDF/HTML/Markdown/txt/zip，PDF 默认由 dompdf 渲染）；页面永久链接稳定。
- **导入导出**：导出格式覆盖 HTML、PDF、Markdown、纯文本及含附件的 zip；REST API 提供 `GET /api/pages/{id}/export/{format}` 等导出端点，Markdown 编辑的页面原文存于 pages 表 `markdown` 列，API 可直接取用。
- **集成与扩展**：REST API（覆盖 Books/Chapters/Pages 等资源的 CRUD）、Webhooks、页面模板、内容复用；官方明确"not designed as an extensible platform"，不做插件生态而保持产品边界收敛。
- **AI 能力**：无内置 AI 功能。

## 技术架构

- **后端**：PHP 8.2+（CI 覆盖 8.2–8.5），基于 Laravel 框架，Blade 模板渲染。
- **前端**：TypeScript/JavaScript 服务端渲染为主，编辑器组件为 TinyMCE、Lexical、CodeMirror、markdown-it。
- **存储方案**：仅支持 MySQL >= 8.0 或 MariaDB >= 10.6（官方安装文档未提供 Postgres/SQLite 选项）；页面 HTML 为权威内容，Markdown 编辑模式下同时保存原文。
- **部署形态**：自托管 Web 应用（任何 PHP 兼容 Web 服务器：Apache/Nginx + Composer）；社区维护 Docker 镜像（LinuxServer.io、solidnerd）；官方称可跑在一台 "£2.50 IONOS VPS" 低配主机上；另有 Cloudron、PikaPods 等托管方案（非官方支持）。无官方桌面端，浏览器访问。

## 设计亮点

1. **清晰的产品边界哲学**：README 明言为高级功能与简洁体验划界（"advanced power features to those that desire it… they should not interfere with the core simple user experience"），并明确拒绝做可扩展平台。这种克制使它十年迭代后依然上手简单，对"轻量自研"是重要的价值观参考——功能不做加法竞赛。
2. **Books/Chapters/Pages 的树形组织 + 标签补充**：三层结构符合"书"的心智模型，标签负责横切维度，搜索与段落锚点补足检索。对不想维护双链图谱的场景（如团队文档、手册），这比强制双链更务实。
3. **企业级权限与认证开箱即用**：角色权限可细分到单本书、MFA 可按角色强制、OIDC/SAML2/LDAP 全覆盖——个人项目可以直接抄它的权限模型设计（角色 → 实体 → 动作三段式）。
4. **导出与 API 完备**：所有内容都能以 Markdown/HTML/PDF/txt 导出，REST API 覆盖读写，数据可迁移性在文档类产品中属上乘。
5. **MIT 许可 + 低资源要求**：宽松许可 + 能跑在最低配 VPS 上，部署门槛在同类中最低。

## 不足与局限

1. **与"个人双链知识库"的形态差异大**：没有双向链接、块引用、知识图谱，不支持 Markdown-first 的文件式存储（权威内容为 HTML，Markdown 原文只是附加保存）；对本次自研目标（Markdown 笔记 + 双链）的可借鉴面较窄，更多是参考其组织与权限设计。
2. **数据库选型单一**：仅支持 MySQL/MariaDB，不支持 SQLite/Postgres，轻量自托管（如小内存 VPS、NAS）场景下多一个常驻数据库服务的负担。
3. **开发主阵地迁离 GitHub**：2025 年项目整体迁移至 Codeberg（官方博客 "BookStack Has Migrated From GitHub to Codeberg"），GitHub 仓库不再更新，依赖 GitHub 生态（Actions、镜像、issue 工作流）的用户与下游打包者需要切换来源，部分社区成员对迁移有异议。
4. **无实时协作与桌面端**：多人编辑同一页面靠修订历史兜底，存在覆盖风险；纯浏览器访问，无离线编辑能力（社区长期需求）。
5. **中文体验**：虽内置多语言（EN/FR/DE/ES/IT/JA/NL/PL/RU 等）且社区提供中文翻译，但核心团队为英文单人主导，中文相关的问题修复优先级一般。

## 对自研轻量知识库的启示

1. **"树形组织 + 标签 + 全文搜索"是最低成本的可用组合**：BookStack 证明不靠双链也能做出高效的个人/小团队知识库；自研初期可以树 + 标签先行，双链作为第二阶段增强。
2. **权限模型直接参考它的三段式设计**：角色（role）→ 内容实体（book/chapter/page）→ 动作（view/create/update/delete），实现简单且能覆盖绝大多数个人与家庭多用户场景。
3. **导出能力和数据可迁移性要当成一等公民**：所有笔记始终可导出为标准 Markdown，API 可完整读写——这是 BookStack 赢得信任的关键，也应作为自研产品的硬性验收标准。
