# 项目交接

供新对话与接手项目的 Agent 使用。本页分两部分：**常青规则**仅在边界、入口或规则变更时更新；**交接现状**每轮更新，只放指针与已知缺口，不抄数字。详细字段见 [开发与数据契约](development.md)，协作规则见 [协作流程](workflow.md)。开工前请先核查工作区现状，不依赖旧对话或临时文件。

## 常青规则

### 项目定位

「也西书架」是中国科大本科课程资料导航，不是网盘。课程范围为 **2025 秋、2026 春、2026 夏、2026 秋** 官方本科开课，按官方代码合并；36 个学科为项目自建标签，非官方分类。「暂未收录」表示目前索引中尚无对应资料，不可写成「没有资料」。

项目在 [GitHub 公开仓库](https://github.com/TwinJades/USTC_Study_Materials_Navigation) 的 `main` 分支维护，由 GitHub Actions 部署至 [正式站点](https://twinjades.github.io/USTC_Study_Materials_Navigation/)。外链指向原站，不托管第三方文件、不保存临时签名、不绕过登录。「教材与参考书」另须由权利方公开发布、免费、免登录且具完整文件直链；匹配课程内容的参考书不等同于学校指定教材。

### 源码与入口索引

| 负责模块 | 源文件 |
| --- | --- |
| 首页搜索与课程详情 | `site/index.html`、`site/course.html`、`site/assets/app.mjs`、`site/assets/style.css` |
| 公告栏与衍生项目配置 | `site/assets/announcements.mjs` |
| 搜索排序、筛选、分组与链接计划 | `site/assets/search.mjs`；对应 `tests/search.test.mjs` |
| 简洁 / 详细模式与外观主题 | `site/assets/mode.mjs`；`index.html`、`course.html`、`sources.html` 顶栏均提供 `[data-mode-toggle]` 与 `[data-theme-toggle]`；目录 / 来源页共用 `ustc-course-nav.mode.catalog`，详情页共用 `ustc-course-nav.mode.course`，首页详细模式会展开筛选区 |
| 来源页、分区、Agent JSON 与来源文档 | `scripts/build.mjs`（勿手改 `dist/`、`data/with-resources/`、`data/without-resources/`、`data/agent/`、`data/generated-files.json`、`docs/sources-and-search.md`） |
| 课程全集、类别、标签与官方采集 | `data/courses.json`、`data/course-metadata.json`、`data/tags.json`、`scripts/collect-courses.mjs` |
| 资料索引、来源、检索日志与校验 | `data/resources.json`、`data/sources.json`、`data/research-log.jsonl`、`scripts/lib/data.mjs`、`scripts/validate.mjs` |
| 外链健康检查与证据分类 | `scripts/monitor.mjs`、`scripts/lib/link-health.mjs`、`scripts/lib/link-coverage.mjs`、`site/assets/health-evidence.mjs`；快照位于 `monitoring-data:data/monitoring.json`，本地可通过 `npm run monitor -- --load-published` 获取 |

无前端框架或第三方运行依赖。浏览器仅读取 `dist/data/catalog.json`，全站使用相对路径以兼容子路径部署。Agent 从 [查找中科大课程资料 Skill](../skills/ustc-course-materials/SKILL.md)、`data/agent/index.json` 与 `data/agent/courses/` 逐课 JSON 接入（随 `dist/` 发布），保留既有路径与字段语义。

### 改版与迭代底线

- **搜索与链接兼容**：首页无论处于简洁或详细模式，展示的课程卡片信息一致（课号、课名、收录状态、类别、标签、资料计数、试题年份）；模式切换仅影响详情页 / 来源页的信息密度与首页筛选区展开。保留旧分享链接兼容（`PHYS1008B%2B`、`status=with/without/none`、旧资料类映射至 `study`、`access` 参数忽略并清理）；`status=none` 时显示恢复指引，不回退为全部。
- **详情展示与分类**：五类正式值为 `exams / homework / study / books / projects`（小测归 `homework`）；详情仅展示有内容的分类，全空时只显示一个空态。只确认到学年时仅显示学年，不补造公历年。纠正归属或标签时保留原资料 ID；判重依赖文件字节（SHA-256）、卷头或正文，不靠同名或同年份推断。
- **入口标签与交互边界**：「原始页面」指来源介绍或原帖，「文件页面」指单文件原站详情 / 预览页，「打开文件」直接访问外部文件链接（可能在浏览器内预览，不承诺强制下载），不能确认直达文件的下载网页称「前往原站」，勿用 JS 代理或伪造下载按钮。「我的科大」仅保存稳定文件页。
- **配套解答与出处**：仅在出处或配套关系明确时展示说明与链接。题面与已核实解答合并为一条资料，解答链接在两种模式下均可见，但不充当题面镜像。跨多次作业的讲义独立归「学习资料」。教师专用答案、限校内文档与来源不明的整书扫描不新增公开入口。
- **可访问性与证据边界**：保持键盘可操作、窄屏不溢出与焦点可见。详细模式在已取样的公开直链和需登录评课原帖附件下展示完整 64 位 SHA-256、字节数与取样日期（目录与仅有预览页的入口不显示）；页面仅展示证据范围，不加「AI 已审核」类徽章。

### 核验边界与重点回归项

- **三项独立证据**：评课原帖匿名可定位、附件是否需登录与自动链接健康相互独立；「从未检查」不等于「确认失效」，未收到 HTTP 响应（如预检拦截、超时）不可标记为 `missing`。旧条目仅优先复核证据缺失、结论冲突或来源变化的记录，不做全量 LLM 复审。
- **同帖合并**：同帖同类附件归为一条，不把附件行数当新增条数。
- **重点回归项**：`DMA23M`、`DMA23F`、`DMA24F` 归属 `229001`；`001548` 复变函数 B 指向具体文件页；线代 B1 2026 春期末 `2026SLAB1Final.pdf` 大小写不可更改；Oscar Levin 教材为 `229001` 补充参考。

### 验证命令

使用 Node.js 24 或以上版本：

- 数据或契约改动：`npm run validate -- --strict-research`、`npm test`、`npm run build`
- 界面改动：构建后执行 `npm run serve` 访问 `http://127.0.0.1:4173/` 实测
- 联网诊断：`npm run monitor -- --dry-run`（不写入本地或远端）
- `npm test` 包含 Chrome / Edge 浏览器回归测试（可通过 `CHROME_PATH` 或 `EDGE_PATH` 指定路径）；验收须确认浏览器用例实际通过（`skipped 0`）。

## 交接现状

每轮更新本节；统计数字与逐条结论不抄入本页。

- 当前课程、资料、来源与外链检查统计：以构建生成的 [来源、检索记录与致谢](sources-and-search.md) 为准。
- 轮次记录索引（逐条见 [`data/research-log.jsonl`](../data/research-log.jsonl) 对应 ID 前缀）：
  - `feixu-review-`：「我的科大」全站匿名目录复核。
  - `homework-review-`：作业与配套资料复核。
  - `oldindex-`：旧考试索引对账（59 份中 54 份已对应正式资料，5 份因归属证据不足仅记候选）。
  - `ustcgit-`、`ustcguide-`、`ustc-cs4005-huang-`：公开课程仓库、课程资料簿与教师页的定向复核与收录依据。
- 待办与验收事项见 [GitHub Project「也西书架」](https://github.com/users/TwinJades/projects/1)。
