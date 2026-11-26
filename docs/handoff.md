# 项目交接

供新对话与接手项目的 Agent 使用。**常青规则**仅在边界、入口或规则变更时更新；**交接现状**每轮更新，只放指针与已知缺口。详细字段见 [开发与数据契约](development.md)，协作规则见 [协作流程](workflow.md)。开工前请以当前工作区文件与代码为准。

## 常青规则

### 项目定位

「也西书架」是中国科大本科课程资料导航，覆盖 **2025 秋、2026 春、2026 夏、2026 秋** 官方本科开课，按官方课程代码合并；36 个学科标签由项目维护（独立于官方分类）。「暂未收录」仅指当前索引尚未入库，文案勿写作「没有资料」。

项目在 [GitHub 公开仓库](https://github.com/TwinJades/USTC_Study_Materials_Navigation) 的 `main` 分支维护，由 GitHub Actions 部署至 [正式站点](https://twinjades.github.io/USTC_Study_Materials_Navigation/)。外链均指向稳定原站入口，需登录资料遵循原站认证。「教材与参考书」限于权利方公开、免费、免登录的完整 PDF 直链，作为课程补充参考收录（与学校指定教材区分）。

### 源码与入口索引

| 负责模块 | 源文件 |
| --- | --- |
| 首页搜索与课程详情 | `site/index.html`、`site/course.html`、`site/assets/app.mjs`、`site/assets/style.css` |
| 公告栏与衍生项目配置 | `site/assets/announcements.mjs` |
| 搜索排序、筛选、分组与链接计划 | `site/assets/search.mjs`；对应 `tests/search.test.mjs` |
| 简洁 / 详细模式与外观主题 | `site/assets/mode.mjs`；三页顶栏均提供 `[data-mode-toggle]` 与 `[data-theme-toggle]`（键名：`ustc-course-nav.mode.catalog`、`ustc-course-nav.mode.course`、`ustc-course-nav.theme`） |
| 构建、分区、来源页与 Agent JSON | `scripts/build.mjs`（构建生成物清单见 `development.md`，勿手改） |
| 课程全集、类别、标签与官方采集 | `data/courses.json`、`data/course-metadata.json`、`data/tags.json`、`scripts/collect-courses.mjs` |
| 资料索引、来源、检索日志与校验 | `data/resources.json`、`data/sources.json`、`data/research-log.jsonl`、`scripts/lib/data.mjs`、`scripts/validate.mjs` |
| 外链巡检、GitHub 监控与证据分类 | `scripts/monitor.mjs`、`scripts/lib/github.mjs`、`scripts/lib/link-health.mjs`、`scripts/lib/link-coverage.mjs`、`site/assets/health-evidence.mjs`；快照位于 `monitoring-data:data/monitoring.json`，本地可用 `npm run monitor -- --load-published` 获取 |
| 访问统计与历史归档 | `scripts/collect-traffic.mjs`、`scripts/archive-traffic.mjs` |

前端原生零依赖，全站采用相对路径以兼容子路径部署；首页与详情页运行时数据仅来自 `dist/data/catalog.json`（相对路径 `data/catalog.json`）。Agent 接入契约（[Skill](../skills/ustc-course-materials/SKILL.md) 与 `data/agent/`）须保持既有路径与字段语义稳定。

### 改版与迭代底线

- **搜索与链接兼容**：首页课程卡片在简洁 / 详细模式下字段完全一致（课号、课名、收录状态、类别、标签、资料计数、试题年份）；模式切换在首页仅控制筛选区、副标题与初始展开态，在详情页 / 来源页控制信息密度。保留旧分享链接兼容（`PHYS1008B%2B`、`status`、旧分类映射至 `study`、清理旧 `access` 参数，详见 `development.md`）；`status=none` 时返回空结果并显示恢复指引。
- **详情展示与归属**：正式分类固定为五类（小测归 `homework`），详情页仅展示非空分类，全空时显示单一空态；仅确认到学年时按学年展示。纠正归属或标签时保留原资料 ID；判重以文件字节（SHA-256）、卷头或正文为依据。
- **入口标签与交互**：外链由浏览器直开原站（不用 JS 代理或伪装强制下载）。按钮标签严格对应入口性质：「资料目录」指目录列表，「原始页面」指来源介绍或原帖，「文件页面」指单文件详情 / 预览页，「打开文件」指直达外部文件，「前往原站」指其他下载网页。「我的科大」仅登记稳定文件页。
- **配套解答与出处**：仅在出处或配套关系明确时展示说明与链接。作业 / 习题与公开配套解答合并为一条资料（保留题面主入口，解答链接在两种模式下均可见）。跨多次作业的讲义独立归入「学习资料」。公开索引排除教师专用答案、限校内文档与来源不明的整书扫描。
- **可访问性与证据展示**：保持键盘可操作、窄屏适配与焦点可见。详细模式仅为已取样的公开直链（`file_snapshot`）和需登录评课原帖附件（`attachment_snapshots`）展示完整 64 位 SHA-256、字节数与取样日期。页面仅呈现客观证据范围，勿添加「AI 已审核」类背书徽章。

### 核验边界与重点回归项

- **证据独立与复核范围**：评课原帖匿名可定位、附件登录要求与自动链接健康三项独立记录；仅确认收到 HTTP 404 / 410 时标为 `missing`。存量条目按需复核（优先处理证据缺失、结论冲突或来源变更项），避免全量重复复审。
- **同帖合并**：同帖同类附件合并为单条资料，按资料条数而非附件个数计数。
- **重点回归项**：`DMA23M`、`DMA23F`、`DMA24F` 归属 `229001`；`001548` 复变函数 B 的「我的科大」条目指向具体文件页；线代 B1 2026 春期末 `2026SLAB1Final.pdf` 大小写不可更改；Oscar Levin 教材为 `229001` 补充参考。

### 验证命令

使用 Node.js 24 及以上版本：

- 数据或契约改动：`npm run validate -- --strict-research`、`npm test`、`npm run build`
- 界面改动：构建后执行 `npm run serve` 访问 `http://127.0.0.1:4173/` 实测
- 联网诊断：`npm run monitor -- --dry-run`（只读诊断）
- `npm test` 包含 Chrome / Edge 浏览器回归测试（可通过 `CHROME_PATH` 或 `EDGE_PATH` 指定路径）；验收须确认浏览器用例实际通过（`skipped 0`）。

## 交接现状

每轮更新本节，仅保留指针与已知缺口。

- 当前课程、资料、来源与外链巡检统计：以构建生成的 [来源、检索记录与致谢](sources-and-search.md) 为准。
- 轮次记录索引（逐条见 [`data/research-log.jsonl`](../data/research-log.jsonl) 对应 ID 前缀）：
  - `feixu-review-`：「我的科大」全站匿名目录复核。
  - `homework-review-`：作业与配套资料复核。
  - `oldindex-`：旧考试索引对账（已并入正式资料或记为归属证据不足的候选）。
  - `ustcgit-`、`ustcguide-`、`ustc-cs4005-huang-`：公开课程仓库、课程资料簿与教师页的定向复核与收录依据。
- 待办与验收事项见 [GitHub Project「也西书架」](https://github.com/users/TwinJades/projects/1)。
