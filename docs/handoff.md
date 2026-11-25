# 项目交接

供新对话和接手项目的 Agent 使用。本页分两部分：**常青规则**只在边界、入口或规则变化时更新；**交接现状**每轮更新，只放指针和已知缺口，不抄数字。详细字段见 [开发与数据契约](development.md)，协作流程见 [协作流程](workflow.md)。继续工作前先查工作区现状，不依赖旧对话、浏览器标签页或临时文件。

## 常青规则

### 项目做什么

这是中国科大本科课程资料导航，不是网盘。固定课程范围为 2025 秋、2026 春、2026 夏和 2026 秋官方本科开课。课程按官方代码合并；36 个学科是项目标签，不是官方分类。暂未收录资料的课程仍在目录里，不能把「暂未收录」写成「没有资料」。

项目在 [GitHub 公开仓库](https://github.com/TwinJades/USTC_Study_Materials_Navigation) 的 `main` 分支维护，由 GitHub Actions 部署到[正式站点](https://twinjades.github.io/USTC_Study_Materials_Navigation/)。索引链接指向原站，不托管第三方文件，不保存临时签名，不绕登录。只有「教材与参考书」另要求由权利方公开发布、免费、免登录并有完整文件直链；匹配课程内容的参考书不等于学校指定教材。

### 从哪里接手

| 要改的东西 | 源文件 |
| --- | --- |
| 首页搜索与课程详情 | `site/index.html`、`site/course.html`、`site/assets/app.mjs`、`site/assets/style.css`（宽屏双栏卡片、语义色标、长学年换行防溢出） |
| 搜索排序、过滤、资料分组、链接选取 | `site/assets/search.mjs`；对应 `tests/search.test.mjs` |
| 简洁／详细模式 | `site/assets/mode.mjs`；`body[data-mode]`、`.mode-detail`、`.mode-compact`；仅在 `course.html` 与 `sources.html` 页头显示分段开关 `[data-mode-toggle]`，首页同步 `localStorage` 不显示无效按钮 |
| 来源页、浏览器目录、每课分区、Agent JSON、来源文档 | `scripts/build.mjs`；不要手改 `dist/`、`data/with-resources/`、`data/without-resources/`、`data/agent/`、`data/generated-files.json` 或 `docs/sources-and-search.md` |
| 官方课程、课程分类和学科关系 | `data/courses.json`、`data/course-metadata.json`、`data/tags.json`；官方采集入口 `scripts/collect-courses.mjs` |
| 资料索引、来源、核查记录 | `data/resources.json`、`data/sources.json`、`data/research-log.jsonl`；校验在 `scripts/lib/data.mjs` 和 `scripts/validate.mjs` |
| 外链健康检查 | `scripts/monitor.mjs`、`scripts/lib/link-health.mjs`、`scripts/lib/link-coverage.mjs`、`site/assets/health-evidence.mjs`；快照在 `monitoring-data:data/monitoring.json`，本地用 `npm run monitor -- --load-published` 获取 |

没有前端框架或第三方运行依赖。浏览器读 `dist/data/catalog.json`，不直接读原始数据，也不在搜索时请求第三方站点。所有页面用相对路径，改版后仍须支持部署到子路径。GitHub Actions 配置在 `.github/workflows/`，有配置不代表已上线。

Agent 从 [查找中科大课程资料 Skill](../skills/ustc-course-materials/SKILL.md)、`data/agent/index.json` 和 `data/agent/courses/` 下的逐课 JSON 开始；索引和逐课文件随 `dist/` 发布。保留既有路径和字段含义；`exercise_source`、`locations[].role`、`locations[].attachment_snapshots` 为可选字段。页脚统计口径与刷新频率见[访问统计](development.md#访问统计)。

### 改版时保留什么

- 可重做视觉、布局和交互文案。普通搜索页始终显示原详细模式的课程信息：课号、课名、收录状态、课程类别、学科标签、资料总数和分类计数、试题年份（有相应数据时）。切换模式不改变这些信息、筛选结果或页码；它只改变课程详情页和来源页的信息量。
- 保留旧分享链接的含义，包括 `PHYS1008B%2B`、`status=with/without/none`、旧资料类映射到学习资料；旧 `access` 参数不参与筛选。学科组内任一选中即可，组间条件同时满足。两项收录状态都没选时显示恢复指引，不回退为全部。
- 详情只显示有内容的资料类别，完全没资料时只显示一个空态。五类正式值是 `exams/homework/study/books/projects`；小测归 `homework`。只确认到学年就显示学年，不补造公历年。纠正标签或归属时保留同一资料的 ID；判重靠实际来源、卷头或正文，不靠课程同名或年份相同。
- 「原始页面」是来源介绍或原帖；「文件页面」是某一文件的原站详情或预览页；「打开文件」直接访问外部文件 URL，可能在 Edge 中预览，不能承诺自动保存。不要靠 JS 代理、抓取外部文件或伪造下载按钮改变这一点。「我的科大」只保存稳定文件页，进入原站后可用原站下载按钮。
- 简洁模式保留首个登记的原始出处，并提供最直接的资料入口（直链优先，其次是文件页）；同一网址只展示一次。入口属于不同来源时分别标明。详细模式保留其他不同网址和核验依据。不能确认会直达文件的下载网页称「前往原站」。
- 仅在出处或配套关系明确时展示相应说明与链接。题目和已核实对应的解答合计一条；解答在两种模式下均可见，不作为镜像或题目入口。跨多次作业的讲义可独立归「学习资料」。同目录、同课程或同年份不能证明配套关系；教师专用答案、明确限校内发布的文件和来源不明的整书扫描不新增公开文件入口。
- 键盘可操作，保留筛选状态反馈、窄屏换行和焦点可见。详细模式可展示更多证据，但不要把目录可访问、文件可读取、课程归属和授权混成一项。没有收到 HTTP 响应不能标记失效；确认 404/410 与认证、预检、无响应和从未检查分开。
- 详细模式在已登记的公开下载直链与需登录的评课社区原帖附件取样下显示 SHA-256、实际字节数与取样日期；目录和仅有文件预览页的入口不显示。简洁模式不变。页面展示证据范围，不加「AI 已审核」徽章。
- 旧条目优先复核证据缺失、结论冲突或来源变化的记录，不做全量 LLM 复审。

### 核验边界

- 评课原帖的匿名可定位、附件是否需要登录与自动链接健康是三项独立证据；「从未检查」不等于「确认失效」。
- 同帖同类附件归一条，不把附件行数当新增条数。
- 重点回归项：`DMA23M`、`DMA23F`、`DMA24F` 归 `229001`；`001548` 复变函数 B 指向具体文件页；线代 B1 2026 春期末 `2026SLAB1Final.pdf` 大小写不能改；Oscar Levin 教材是 `229001` 的补充参考。

### 如何验证

使用 Node.js 24 或以上。资料或数据契约有改动时运行 `npm test`、`npm run validate -- --strict-research`、`npm run build`；纯界面改动也要构建实际产物，用 `npm run serve` 打开 `http://127.0.0.1:4173/` 检查改到的页面。联网诊断用 `npm run monitor -- --dry-run`，它不会写入数据或 GitHub。

`npm test` 包含文件取样数据校验及课程页浏览器回归：真实切换简洁／详细模式，检查题面和配套解答各自的摘要、日期与大小。浏览器用本地 Chrome／Edge；可通过 `CHROME_PATH` 或 `EDGE_PATH` 指定路径，无浏览器时该项会明确跳过。验收时确认浏览器用例实际通过，而不是跳过。

## 交接现状

每轮更新本节；数字与逐条结论不抄进本页。

- 当前课程数、资料数、来源数与外链检查数字：以构建生成的 [来源、检索记录与致谢](sources-and-search.md) 为准。
- 轮次记录索引，逐条结论见 [`data/research-log.jsonl`](../data/research-log.jsonl) 对应 ID 前缀：
  - `feixu-review-`：「我的科大」全站匿名目录复核。
  - `homework-review-`：作业与配套资料复核。
  - `oldindex-`：旧考试索引对账，59 份中 54 份已对应正式资料，5 份因课程归属证据不足只记候选。
  - `ustcgit-`、`ustcguide-`、`ustc-cs4005-huang-`：公开课程仓库、课程资料簿与教师页的定向复核、收录依据。
- 待办与验收中的事项（如访问统计三日验收）见 [GitHub Project「也西书架」](https://github.com/users/TwinJades/projects/1)，本页不列清单。