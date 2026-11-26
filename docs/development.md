# 开发与数据契约

运行环境：Node.js >= 24、ESM，零第三方运行依赖。站点为原生 HTML / CSS / JS，构建产物为纯静态文件。

协作流程见 [协作流程](workflow.md)，跨轮次待办见 [GitHub Project「也西书架」](https://github.com/users/TwinJades/projects/1)。

## 目录结构

```
site/                        页面源文件
  index.html                 首页搜索与筛选
  course.html                课程详情（course.html?code=…）
  assets/app.mjs             DOM 渲染与 URL 状态
  assets/search.mjs          纯搜索与筛选函数（浏览器与 Node 测试共用）
  assets/mode.mjs            简洁 / 详细模式与浅色 / 深色 / 跟随系统主题
  assets/announcements.mjs   公告栏（近期更新与衍生项目）
  assets/health-evidence.mjs 外链健康证据分类（构建与前端共用）
  assets/style.css           全站样式
scripts/
  collect-courses.mjs        采集四个固定学期的官方本科开课
  collect-traffic.mjs        采集 GitHub Traffic 与 GoatCounter 统计快照
  archive-traffic.mjs        每日归档已结束 UTC 日的仓库访问计数
  validate.mjs               离线数据验证（支持严格模式）
  build.mjs                  校验 → 分区 → 来源文档 / sources.html / Agent JSON → dist
  serve.mjs                  仅绑定 127.0.0.1:4173 的本地预览服务器
  monitor.mjs                外链健康检查与 GitHub 资料库文件变化监控
  lib/data.mjs               数据加载、枚举、校验、分区与采集共用 API
  lib/link-coverage.mjs      监控记录向站点引用 URL 的覆盖投影
  lib/link-health.mjs        公开 URL 安全预检与 HTTP 检查
  lib/github.mjs             GitHub 只读文件树与 Issue / Contents API 客户端
tests/                       隔离 fixture 的单元、监控与浏览器回归测试
data/                        正式索引与生成分区（见下）
skills/                      Agent 检索 Skill
docs/sources-and-search.md   构建生成：来源、检索记录与致谢
.github/workflows/           PR 校验、Pages 部署、周维护与每日流量归档
```

`data/with-resources/`、`data/without-resources/`、`data/agent/`、`data/generated-files.json`、`docs/sources-and-search.md` 与 `dist/`（含 `dist/sources.html`）由 `npm run build` 生成。构建按清单仅增删自有产物，忽略清单外文件；请勿手工修改或搬动。

## 数据文件

| 文件 | 结构与约束 |
| --- | --- |
| `data/courses.json` | `[{code, name}]`，仅此两字段，按 `code` 升序；保留前导零与 `+` |
| `data/course-metadata.json` | 以课号为键：`{kind, tags, basis_url, basis_note}`；`kind` 为 `common / general / professional`，`tags` 为非空学科 ID 数组 |
| `data/tags.json` | `[{id, label}]`，须匹配 `data.mjs` 内置学科枚举（未使用标签会触发告警），禁止 `other / 其他` |
| `data/resources.json` | 正式资料条目数组，结构与规则见下 |
| `data/sources.json` | `[{id, name, url, maintainer, kind, github, notes}]`；`kind` 为 `repository / website / index / tool / stub / mirror`，`github` 为 `{owner, repo, branch}` 或 `null` |
| `data/research-log.jsonl` | 每行一条实际检索记录，11 个字段见下 |
| `data/monitoring.json` | `monitoring-data` 分支唯一文件（本地同路径由 `.gitignore` 忽略）；`links` 存逐 URL 检查结果，`repositories` 以 `source_id` 为键存文件基线 |
| `data/generated-files.json` | 构建维护的自有产物清单 `{files: […]}`（仓库相对 POSIX 路径） |

资料条目示例：

```json
{
  "id": "稳定字符串",
  "course_codes": ["MATH1001"],
  "type": "exams",
  "title": "2020 期末（含解析）",
  "authors": ["公开署名"],
  "notes": "简要核验摘要",
  "coverage": {
    "years": [2020],
    "exam_kind": "final",
    "exam_form": "original",
    "has_solutions": true,
    "evidence_url": "https://example.org/ustc/math/2020-final#page=1",
    "note": "依据卷面页眉与来源目录核验；仅确认可见年份、卷别与解答有无"
  },
  "locations": [
    {
      "source_id": "source-id",
      "page_url": "https://example.org/ustc/math/2020-final",
      "download_page": null,
      "download_url": null,
      "access": "public",
      "license_note": "仅链接原页面；具体授权以原页面声明为准",
      "attribution": "课程组公开署名（见原页面）"
    }
  ],
  "verified_at": "2026-11-18"
}
```

- `type`：`exams / homework / study / books / projects`。`books` 仅收权利方公开提供、免登录免费获取的完整教材 PDF，须至少登记一个直接 `.pdf` 链接且所有位置均为 `public`。
- `exams` 的 `exam_kind` 为 `midterm / final / mixed / unknown`，`exam_form` 为 `original / recollection / practice / unknown`，`has_solutions` 为 `true / false / null`。小测归 `homework`，保留 `exam_kind: "quiz"`、`exam_form`（枚举值或 `null`）与 `has_solutions`；其余资料（含非小测作业）三项均置 `null`。
- `access`：`public / login / campus / paid / unknown`。可选字段 `locations[].page_kind` 为 `directory / file / page`，分别标明资料目录、文件页面与原始页面；禁止将目录填入 `download_url`。
- 需登录来源（如 `ustc-mooc`）仅导航公开课程页并标 `access: "login"`。评课社区登录附件例外（`source_id: "icourse-club"`、`access: "login"`、`page_kind: "page"`）要求 `page_url` 指向匿名可定位的具体 `#review-` 原帖，`download_url` 与 `download_page` 置 `null`，仅登记原帖地址与可选摘要（禁止保存登录后直链、凭据或文件副本）；若仅按附件名核对，须在 `coverage.note` 中写明。
- `locations[].license_note` 须为非空字符串，`locations[].attribution` 须为字符串（不可为 `null`，留空触发告警）；`coverage.note` 记录核验范围与依据。
- 文件取样摘要对象格式为 `{sha256, bytes, checked_at}`：`sha256` 须为原始文件完整字节的 64 位小写十六进制值，`bytes` 为正整数，`checked_at` 为 `YYYY-MM-DD`；链接变更时须同步删除或重采。可选字段 `locations[].file_snapshot` 用于 `access: "public"` 且有 `download_url` 的条目；`locations[].attachment_snapshots` 为按 `sha256` 升序去重的非空数组，仅用于 `icourse-club` 需登录原帖（`access: "login"`、`page_kind: "page"`、无 `download_url / download_page / file_snapshot / role`、`page_url` 匹配 `https://icourse.club/course/<id>/#review-<id>`）。两者均仅在详情页详细模式展示。
- 作业、习题与小测可选 `exercise_source`（仅写已核实出处）。明确对应、免登录的解答可用 `locations[].role: "solution"`（仅限 `type: "homework"` 且 `access: "public"`），与题面合并为一条资料，同时仍须保留不带该角色的主入口。详情页两种模式均显示配套解答，监控照常检查其 URL。
- `coverage.years` 仅写已确认公历年份；可选 `coverage.academic_years` 用 ASCII `YYYY-YYYY` 记录学年（结束年为开始年 + 1），仅知学年时保持 `years: []`。
- 去重规则：仅当完整文件 SHA-256 相同且课程、类型与覆盖信息一致时由 `mergeExactMirrors` 合并去重（不同字节的题面、答案与补页分别保留或作为配套入口）。来源优先级依次为集中目录 / 成套仓库 / 专题站、有证据的一手入口、聚合站（如 `feixu`、数理往年试卷站、`guch8017/USTC_CS_EXAM`）。
- 工具、空壳、无增量镜像与受阻项仅入检索记录；校验与构建均拒绝引用 `tool / stub` 来源的正式资料。

检索记录格式（`data/research-log.jsonl`）：

```json
{
  "id": "唯一字符串",
  "date": "2026-11-18",
  "scope": "course",
  "channel": "github",
  "course_codes": ["MATH1001"],
  "source_ids": ["source-id"],
  "query": "实际查询词",
  "url": "https://…",
  "checked_scope": "实际打开的目录、文件或分页范围",
  "outcome": "reviewed",
  "notes": "受阻原因、署名或许可边界"
}
```

- `scope`：`source / course / query`；`channel`：`github / icourse / web / catalog`；`outcome`：`reviewed / no_relevant_result / candidate / duplicate / tool / stub / blocked`。
- 每门课程在 GitHub、评课社区与公开网页三条路径各至少有一条终态记录（`reviewed / no_relevant_result / blocked`）方算完成首轮检索；`blocked` 仅记录访问受阻状态。

## 构建与校验

```sh
npm run collect:courses
npm run validate
npm run validate -- --strict-research
npm run validate -- --strict-research --require-monitoring
npm run build
npm run serve
npm test
npm run monitor -- --dry-run
npm run monitor -- --write-local
npm run monitor -- --load-published
npm run monitor -- --publish
```

- `validate`：离线检查重复代码 / ID、悬空引用、未知枚举、必需值空白、类别互斥与学科标签；默认将三路径未齐记为警告，`--strict-research` 升级为错误。
- `build`：先执行非严格校验，通过后确定性生成分区、`docs/sources-and-search.md`、`data/agent/`、`dist/data/catalog.json`、`dist/sources.html` 与全部站点文件（输出无构建时间戳，排序与清单稳定）。
- 发布工作流在构建前从 `monitoring-data` 加载快照并执行 `npm run validate -- --strict-research --require-monitoring`；本地与普通 PR 支持离线构建。
- `dist/data/catalog.json` 为脱敏后的浏览器数据，包含统计汇总（`counts / stats`）、课程、标签与枚举定义、实际引用来源、逐 URL 健康结果及 `health_evidence` 枚举（剔除检索日志、未确认候选与仓库文件基线）。

## Agent 与程序读取

仓库与发布站点均提供 `data/agent/index.json`（课号、课名、收录状态）及 `data/agent/courses/<文件名>.json`（单门课程的正式资料、出处、入口及来源名称），站点路径位于 `dist/data/agent/`。已知课号可直接读取单课文件，两者均含 `schema_version`。

文件名规则为 `encodeURIComponent(code) + '.json'`（如 `229001.json`、`PHYS1008B%2B.json`）；经 HTTP 读取时路径须再编码一次（如 `PHYS1008B%252B.json`）。`download_url` 仅在确实登记时有值，禁止由 `page_url` 推断拼接；`has_resources: false` 表示暂未收录。

交互指引见 [查找中科大课程资料 Skill](../skills/ustc-course-materials/SKILL.md)；Agent 检索请优先读取 `data/agent/`，而非拉取全量 `catalog.json`。

## 搜索与 URL 参数

`site/assets/search.mjs` 为纯函数模块（无 DOM 与网络依赖）。匹配优先级：精确代码 → 精确名称 → 前缀 → 包含，同级按代码排序；匹配时代码与名称均大小写不敏感，名称经 NFKC 与空白归一化并保留 `A / B / H` 等级后缀。`course.html?code=` 经 `URLSearchParams` 编码，`PHYS1008B+` 以 `%2B` 传输。

筛选维度间取交集（AND），学科标签组内取并集（OR）；资料类型与试题年份须由同一条资料满足。

| 参数 | 取值 |
| --- | --- |
| `q` | 课程代码或名称 |
| `kind` | `all / common / general / professional` |
| `tag` | 可重复；学科 ID |
| `type` | `all / exams / homework / study / books / projects`；旧 `lectures / notes / open_book / guides` 解析为 `study` |
| `year` | 仅 `type=exams` 时生效：四位公历年份或 `unknown` |
| `status` | `all / with / without / none`（`none` 表示两项均未勾选，返回零结果） |

未知参数或枚举值忽略，旧 `access` 参数自动从地址栏清理。表单提交写入 `pushState`，输入或勾选使用 `replaceState`。外链仅允许 `http / https`。

## 资料复核

- 旧考试清单与来源索引采用只读对账：凭卷头、正文、课程主页与文件内容确认归属与同卷关系；同卷保留既有资料 ID，本地摘录不作为公开来源。
- 「我的科大」按匿名公开目录分页遍历并按实际路径去重；入库前须核实文件内容、年份、归属与授权（HTTP 200 仅作可访问线索），且仅登记稳定文件页（不存临时签名链接）。

## 本地服务器

`scripts/serve.mjs` 仅监听 `127.0.0.1:4173` 服务 `dist/`，只允许 `GET / HEAD`，不列目录、无 SPA 回退，拒绝 `..`、反斜杠、空字节及指向 `dist/` 之外的符号链接。

## 监控

- `--dry-run`（默认）：只读运行，执行真实检查并打印报告，不写入本地或远端。
- `--write-local`：执行真实检查，仅写入本地 `data/monitoring.json`。
- `--load-published`：从 `monitoring-data` 获取并校验快照，剔除已下架来源基线后写入本地；缺失或校验失败时直接退出。
- `--publish`：写入固定 Issue 通知，基于起始文件 SHA 更新 `monitoring-data` 分支并同步本地快照（并发冲突时中止以保留远端更新，仅操作数据分支）。

外链与仓库检测规则：
- **HTTP 检查**：15 秒超时、总并发 4、按实际请求主机每域 1 并发；先 `HEAD`，不支持（`405 / 501`）时改用有限字节 `GET`；最多 5 跳，每跳重新校验公开 `http / https` 并将连接绑定到已校验 DNS 地址。`401 / 403 / 429`、登录跳转、超时、网络错误、5xx 记 `unknown`；`404 / 410` 记 `missing`；正常 2xx 且未识别登录 / 错误页记 `reachable`。
- **证据分类与投影**：`site/assets/health-evidence.mjs` 的 `classifyHealth` 将记录分为 6 类（`unchecked / preflight / no_response / auth / missing / responded`，对应「从未检查」「预检未放行」「请求无响应」「需登录或认证」「确认 404/410」「已响应」）；`scripts/lib/link-coverage.mjs` 将其投影到站点实际引用的 URL（未引用记录单列为历史条目）。若全部 URL 均停在安全预检且既有基线包含最终 HTTP 响应证据，写入模式保留原基线（`publish` 同时跳过 Issue 通知）。
- **GitHub 仓库监控**：仅读取登记的固定 `branch`；head 未变时跳过，变化时按 `path + SHA` 对比完整文件树（遇 `truncated` 逐子树拉取），写入固定 Issue「资料来源变化待核验」，通知分块全部成功后才推进对应基线。

## 测试

`npm test` 运行 `node --test`，基于隔离 fixture 与本地回环服务运行，完全独立于正式数据。`tests/data.test.mjs`、`tests/search.test.mjs`、`tests/monitor.test.mjs`、`tests/traffic-archive.test.mjs` 与 `tests/browser.test.mjs` 分别覆盖数据契约与合并、搜索与模板输出、外链监控、流量归档及双模式 / 公告栏浏览器回归。

## 部署路径

构建产物全量使用相对路径以兼容 GitHub Pages 项目子路径，并生成 `.nojekyll`；Pages 由 `actions/upload-pages-artifact@v3` 与 `actions/deploy-pages@v4` 部署。

## 访问统计

- **采集入口**：发布工作流在构建前运行 `scripts/collect-traffic.mjs`，优先使用 `TRAFFIC_TOKEN`（回退 `GITHUB_TOKEN`）拉取仓库 Traffic，配置 `GOATCOUNTER_SITE` 后网页上报浏览并同步拉取公开计数。
- **展示口径**：仓库与网站日浏览均显示同一个已结束 UTC 昨日并标注日期；接口缺失或计算无效时显示「暂无数据」（仅确认数值为 0 时显示 `0`）。GoatCounter `TOTAL` 查询至次日零点需扣除当日 `00:00 UTC` 小时桶；取数时间以北京时间展示。
- **隐私与上报边界**：本地快照写入被 `.gitignore` 忽略的 `data/traffic.local.json`。仅三类页面（`/`、`/course.html`、`/sources.html`）首次加载时上报固定路径与标题，跳过查询参数与站内交互状态。
- **历史归档**：每日 `Archive repository traffic` 工作流将已结束 UTC 日的计数与独立访客数写入独立分支 `traffic-history` 的 `traffic-history.json`（独立分支仅含该归档文件，失败时保留既有历史，重抓可刷新窗口内修订值，且不影响 Pages 部署）。

## 处理读者推荐

「推荐资料来源」与「推荐衍生项目」Issue 仅收集公开链接（勿附文件原件或登录凭据），均由维护者人工核实归属、可用性与重复情况后再录入数据文件或 `site/assets/announcements.mjs`。
