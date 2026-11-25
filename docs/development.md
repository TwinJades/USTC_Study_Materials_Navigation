# 开发与数据契约

运行环境：Node.js >= 24、ESM，无第三方运行依赖。站点为原生 HTML/CSS/JS，构建产物是纯静态文件。

协作流程（分支、PR、审核、合并与清理）见 [协作流程](workflow.md)。
跨轮次的待办记在 [GitHub Project「也西书架」](https://github.com/users/TwinJades/projects/1)。

## 目录结构

```
site/                       页面源文件
  index.html                搜索与筛选
  course.html               课程详情（course.html?code=…）
  assets/search.mjs         纯搜索/筛选函数（浏览器与 Node 测试共用）
  assets/app.mjs            DOM 渲染与 URL 状态
  assets/style.css          样式（浅色/深色、响应式）
scripts/
  collect-courses.mjs       采集四个固定学期的官方本科开课
  validate.mjs              离线数据验证（支持严格模式）
  build.mjs                 验证 → 分区 → 来源文档 → dist
  serve.mjs                 仅 127.0.0.1:4173 的本地预览
  monitor.mjs               外链与 GitHub 资料库文件变化检查
  lib/data.mjs              数据加载、枚举、验证、分区、采集共用 API
  lib/link-health.mjs       公开 URL 安全检查
  lib/github.mjs            GitHub 只读树与 Issue/Contents API
tests/                      隔离 fixture 的边界测试
data/                       正式索引数据（见下）
docs/sources-and-search.md  构建生成：来源、检索记录与致谢
.github/workflows/          PR 校验、Pages 部署与定时维护
```

`data/with-resources/`、`data/without-resources/`、`data/generated-files.json`、`docs/sources-and-search.md` 与 `dist/` 由构建生成。构建只更新清单中属于自己的文件，不删除陌生文件；不要手工搬动课程分区文件。

## 数据文件

| 文件 | 结构 |
| --- | --- |
| `data/courses.json` | `[{code,name}]`，仅这两个字段，按代码升序；代码原样字符串（保留前导零与 `+`） |
| `data/course-metadata.json` | 以代码为键：`{kind,tags,basis_url,basis_note}`；`kind` 为 `common/general/professional`，`tags` 为非空学科 ID 数组 |
| `data/tags.json` | `[{id,label}]`，只登记实际使用的学科标签，禁止 `other/其他` |
| `data/resources.json` | 正式资料条目，结构见下 |
| `data/sources.json` | `[{id,name,url,maintainer,kind,github,notes}]`；`kind` 为 `repository/website/index/tool/stub/mirror`，`github` 为 `{owner,repo,branch}` 或 `null` |
| `data/research-log.jsonl` | 每行一条实际检索记录，11 个字段见下 |
| `data/monitoring.json` | `monitoring-data` 分支唯一文件。本地同路径是忽略的快照；`links` 保存逐 URL 结果，`repositories` 以 `source_id` 为键保存文件基线 |
| `data/generated-files.json` | 构建写的自有产物清单 `{files:[…]}`（仓库相对 POSIX 路径） |

资料：

```json
{
  "id": "稳定字符串",
  "course_codes": ["MATH1001"],
  "type": "exams",
  "title": "2020 期末（含解析）",
  "authors": ["公开署名"],
  "notes": "核验摘要，不复制原文",
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

- `type`：`exams/homework/study/books/projects`。`books` 仅收权利方公开提供、免登录免费获取的完整教材 PDF，至少登记一个直接 PDF 链接，所有位置均为 `public`。
- `exams` 的 `exam_kind` 为 `midterm/final/mixed/unknown`，`exam_form` 为 `original/recollection/practice/unknown`。小测归 `homework`，保留 `exam_kind=quiz`、已核验卷型与解答信息；其他非试题三项为 `null`。`has_solutions` 为 `true/false/null`。
- `access`：`public/login/campus/paid/unknown`。可选的 `locations[].page_kind`：`directory/file/page`，分别标明资料目录、文件页和普通来源页；不得把目录填入 `download_url`。
- 本轮登录例外只适用于 USTC 评课社区：`source_id: "icourse-club"`、`access: "login"`，`page_url` 指向匿名可定位的具体 `#review-` 原帖，且附件入口经正常登录核实。`download_url` 和 `download_page` 均为 `null`；不保存登录后才出现的直链、正文、登录凭证或文件副本。按附件名核对的条目，要在核验说明中明确未读文件正文。
- `locations[].license_note` 与 `attribution` 必须是实际说明字符串（不得为 `null`）：前者写授权/使用限制，后者写公开署名；`coverage.note` 记录核验范围与依据。
- `locations[].file_snapshot` 为可选的 `{sha256, bytes, checked_at}`，仅对应免登录的 `download_url`。SHA-256 必须是原始文件字节的完整 64 位小写十六进制值，`bytes` 是实际字节数，`checked_at` 是取样日期；不得使用网页、Git blob、提取文本或摘要前缀替代。链接改指另一文件时删除或重新取样。课程详情仅详细模式展示，不用它替代课程归属、内容或授权核验。
- 作业、习题与小测可选 `exercise_source`，只写已核实的出处。明确对应、免登录的解答可用 `locations[].role: "solution"`，不另计一条资料；仍须保留不带该角色的主入口。详情页两种模式均显示配套解答，监控照常检查该位置的 URL。
- `coverage.years` 只写明确公历年份；可选的 `coverage.academic_years` 用 `YYYY-YYYY` 记录学年。只知道学年时保留 `years: []`，不推断公历年份。
- 同课、同年、同卷别不证明重复。只有完整文件 SHA-256 相同才按来源优先级去重；不同字节的题面、答案与补页可作为配套入口，但不是镜像。
- `mergeExactMirrors` 仅比较完整成员。集中目录、成套仓库或专题资料站优先；集中程度相当时，有证据的一手入口优先。feixu、数学和物理往年试卷站与 guch8017/USTC_CS_EXAM 是汇集入口，不默认认作首发。评课社区、duxiaoyang-creator 与 ly382965 的仓库逐件区分自写与转收；缺证据标「出处未确认」。刘越课程主页是该版本数分真题汇编的一手出处，不等于其中每张卷的首发。正式导航仅保留优先入口，已核实出处可写进说明。类型、课程归属或覆盖冲突单独复核，不因去重删除课程归属。
- 工具、空壳、无增量镜像、受阻项只进入检索记录，不能作为正式资料。构建会拒绝引用 `tool/stub` 来源的资料。

检索记录每行：

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
  "checked_scope": "实际打开的目录/文件/分页范围",
  "outcome": "reviewed",
  "notes": "受阻原因、署名或许可边界"
}
```

`scope` 为 `source/course/query`；`channel` 为 `github/icourse/web/catalog`；`outcome` 为 `reviewed/no_relevant_result/candidate/duplicate/tool/stub/blocked`。

每课的 GitHub、评课社区和公开网页路径，各至少有一条 `reviewed/no_relevant_result/blocked` 终态记录才算完成该轮检索。`candidate/duplicate/tool/stub` 发现项保留但不能单独完成路径；`blocked` 表示真实受阻，不表示没有资料；全部路径受阻的课程另行列出。

复核旧索引时按每份原件记录处置和理由，不转载旧合集或二次整理摘录。公开分享目录清点以匿名分页列表中的原始路径为单位；可识别的具体文件使用稳定文件页，不记录临时签名下载地址。目录合集、文件可读性和课程归属分别核验；未确认的文件只进检索日志，不改变课程收录状态。

## 构建与校验

```sh
npm run collect:courses
npm run validate
npm run validate -- --strict-research
npm run build
npm run serve
npm test
npm run monitor -- --dry-run
npm run monitor -- --write-local
npm run monitor -- --load-published
npm run monitor -- --publish
```

- `validate`：离线检查重复代码/ID、悬空引用、未知枚举、必需值空白、类别互斥与标签；默认把“每课三路径未齐”作为警告，`--strict-research` 升级为错误。
- `build`：先验证（非严格），失败时不写任何生成文件；随后生成两类分区、`docs/sources-and-search.md`、`dist/data/catalog.json`、`dist/sources.html` 与 `dist/` 站点文件。
- 分区：每门课程恰好一个，`with-resources` 仅当存在已确认归属的正式资料；由脚本重新计算，禁止手工移动。
- 构建是确定性的：不写构建时间戳；排序与清单稳定；重复构建内容一致。
- 两个发布工作流读取 `monitoring-data`，在构建前执行 `npm run validate -- --strict-research --require-monitoring`。本地和普通 PR 仍可离线构建；未取快照时显示「从未检查」。

`dist/data/catalog.json` 是脱敏后的浏览器数据：课程、合并后的枚举与标签、实际使用的来源、逐 URL 健康结果（`status` 与 `evidence` 证据类别：从未检查、预检中止未发出请求、已发出请求但无响应、需登录或认证、确认 404/410、已收到 HTTP 响应），以及 `health_evidence` 枚举；**不包含**检索日志、未确认候选、GitHub 文件基线和监控仓库信息。

## Agent 与程序读取

仓库和网站均提供 `data/agent/index.json`（课号、课名、收录状态），以及 `data/agent/courses/<文件名>.json`（单门课的正式资料、出处、文件入口及来源名称）。本地网站生成版位于 `dist/data/agent/`。只按课号查询时可跳过首页索引；按课名查时先匹配索引，再读单门课文件。两个入口均包含 `schema_version`。

文件名为 `encodeURIComponent(code) + '.json'`；例如 `229001.json`、`PHYS1008B%2B.json`。通过 HTTP 读取时，对这个文件名再做一次 URL 路径编码，例如 `PHYS1008B%252B.json`。单课 JSON 中 `locations[].page_url` 是原始出处；`download_url` 只在确实登记时才有值，不能由页面地址推造。`has_resources: false` 表示暂未收录。

交互规则见 [查找中科大课程资料 Skill](../skills/ustc-course-materials/SKILL.md)。也可直接读取上述 JSON；不要把全站浏览器目录 `catalog.json` 当成默认查询入口。

## 搜索与 URL 参数

`site/assets/search.mjs` 不访问 DOM、不发网络请求。检索顺序：精确代码 → 精确名称 → 前缀 → 包含，同组按代码排序。代码大小写不敏感；名称做 NFKC 与空白归一化，但保留 A/B/H 等级后缀。`course.html?code=` 经 `URLSearchParams` 编码，`PHYS1008B+` 以 `%2B` 传输。

筛选维度之间 AND，学科标签组内 OR。资料类型和试题年份须由同一条资料满足。访问要求仍显示在资料上，但不再参与筛选。URL 参数：

| 参数 | 取值 |
| --- | --- |
| `q` | 课程代码或名称 |
| `kind` | `all/common/general/professional` |
| `tag` | 可重复；学科 ID |
| `type` | `all/exams/homework/study/books/projects`；旧 `lectures/notes/open_book/guides` 链接解析为 `study` |
| `year` | 仅 `type=exams` 时生效：四位公历年份或 `unknown`（没有已确认公历年份，可包含已知学年） |
| `status` | `all/with/without/none`，`none` 表示两项都未勾选，返回零结果 |

未知参数与未知值忽略，旧 `access` 参数从地址栏清理。搜索提交使用 pushState，输入与勾选使用 replaceState，刷新/分享/返回可恢复。外链仅允许 `http/https`。模式偏好在浏览器本地保存；只改变课程详情页和来源页的信息量，不改变首页课程卡片、筛选或分页。

首页、课程详情和来源页共用 `site/assets/announcements.mjs` 中的公告栏内容。维护「近期更新」「衍生项目」时编辑这个文件，收录前核对项目的公开链接与说明。公告由读者主动打开，不改变搜索条件或模式。

## 资料复核

旧考试清单与来源索引只读对账：用卷头、正文、课程主页和文件内容确认课程及同卷关系。已有同卷保留资料 ID，补充稳定的文件级入口或镜像；本地摘录不作为可发布的原始来源。

「我的科大」按匿名公开目录分页遍历，递归发现子目录，以实际路径去重。目录出现文件或文件页返回 HTTP 200，不代表取得文件正文，也不代表课程归属、年份或授权已确认。正式索引只登记稳定的目录页或文件页，不保存会话或存储服务的临时签名。归属不明、文件无法读取及范围外材料，在检索日志注明原因，不进入课程分区。

## 本地服务器

`scripts/serve.mjs` 只绑定 `127.0.0.1:4173`，服务 `dist/`；只允许 GET/HEAD，不列目录，无 SPA 回退；拒绝 `..`、反斜杠、空字节和指向 `dist` 之外的符号链接。

## 监控

- `--dry-run`：真实检查并输出报告，不写任何文件或 GitHub 对象。
- `--write-local`：真实检查，仅写本地 `data/monitoring.json`，不调用 GitHub 写 API。
- `--load-published`：从 `monitoring-data` 获取、校验快照，移除本次构建已下架的来源基线后写入本地。缺失或读取失败时退出，不用空快照替代。
- `--publish`：在 Actions 中写 Issue 通知并只更新 `monitoring-data` 分支；需要 `GITHUB_TOKEN` 与目标仓库。不会更新默认分支。

链接检查：15 秒超时、并发 4、按实际请求主机每域 1；先 HEAD，405 等不支持时 GET 读取必要小段；最多 5 跳，每跳重新校验公开 http/https，并将连接绑定到已验证的 DNS 地址。401/403/429、登录跳转、超时、网络错误、5xx → `unknown`；404/410 → `missing`；正常 2xx 且未识别登录/错误页 → `reachable`。需认证/校园网/付费不尝试绕门。

证据类别由 `site/assets/health-evidence.mjs` 的 `classifyHealth` 统一判定，构建、来源页、浏览器与 `npm run validate` 共用：`private_host`、`dns_error` 等 DNS/地址安全预检表示请求没有发出，不属于请求失败，也不算坏链；只有确认 404/410 才判 `missing`。`scripts/lib/link-coverage.mjs` 再把记录投影到站点实际引用的网址上：没有监控记录的网址算“从未检查”，监控文件中当前未被引用的条目单列为历史条目，不进入来源页与校验的分类计数。

如果所有链接都止于安全预检，且已有可用 HTTP 证据，写入模式保留原基线，不发通知、不写文件。匿名浏览器抽核单独记录，不能填充自动监控状态。公开目录分页可证明当时列出的目录和文件范围；不能代替卷头、正文、课程或授权核验。

GitHub 检查只读登记资料库的确定 `branch`；头未变跳过树，变化时读取完整树按 path+SHA 比较，`truncated` 逐子树读取；通知失败不推进对应基线。文件变化写入固定 Issue“资料来源变化待核验”，不自动增删正式资料。

两种远端读取都先校验快照结构；Contents API 返回 `type: file`、`encoding: none` 时按同一响应的 SHA 补读并校验 Git blob。读取或校验失败不写 Issue 或文件。发布按起始文件 SHA 更新专用分支上的单个文件；并发编辑冲突时不覆盖。通知分块成功才推进对应来源基线。发布成功后同步 runner 本地快照；若整轮预检中止，则以原远端快照构建，不写远端。

监控快照和目录可以独立更新：构建只把健康状态匹配到当前索引引用的 URL；新链接没有对应证据时显示「从未检查」。下架的来源基线不进入当前目录校验；只在成功发布新快照时从远端移除。

首次切换前，在 `monitoring-data` 的独立根提交中复制 `main` 最后有效的 `data/monitoring.json`，保留原 Git blob。合并切换 PR 前比较两个分支的文件 blob；如果旧工作流在此期间推进了 `main` 上的快照，先把对应 blob 快进同步到 `monitoring-data`。确认旧周维护未在运行再合并；之后手动跑一次 Weekly source maintenance，核对仅数据分支前进且 Pages 部署成功，再启用 `main` 的 PR-only 规则。不要将 PR-only 规则匹配到数据分支。

## 测试

`npm test` 运行 `node --test`。测试全部使用隔离 fixture 或局部 HTTP 服务，不读写正式数据、不执行来源仓库代码。`tests/data.test.mjs` 覆盖精确镜像合并及覆盖声明冲突；`tests/search.test.mjs` 覆盖年份命中、同年异卷、`PHYS1008B+` 往返、组合筛选与链接状态。

## 部署路径

构建只使用相对路径，支持 GitHub 项目子路径；`dist/` 内包含 `.nojekyll`。Pages 由 `actions/upload-pages-artifact@v3` 与 `actions/deploy-pages@v4` 部署，构建、监控与部署权限相互分离。

## 访问统计

两条发布工作流构建前运行 `scripts/collect-traffic.mjs`。仓库统计默认使用工作流的 `GITHUB_TOKEN`；若无权读取 Traffic，设置有限权限的 Actions secret `TRAFFIC_TOKEN`。设置 Actions variable `GOATCOUNTER_SITE`（仅子域名，后台允许公开计数）后，网页上报浏览，Actions 读取公开计数。

仓库和网站的日浏览都按同一个完整 UTC 昨日显示，并标注日期。GitHub 未返回昨日行、GoatCounter 缺响应或区间计算无效时不补 0；明确有效的 0 才显示 0。另保留仓库近 14 天和网站累计。GoatCounter 公开 `TOTAL` 按日期查询，查询到次日零点包含该小时桶，需扣除。取数时间是这一批请求的发起时间，以北京时间显示，不是访问、部署或上游数据更新时间。页脚快照保存在被 Git 忽略的 `data/traffic.local.json`；公开上游数字可能缓存、延迟或修订。三类页面各次完整加载可上报，站内仅筛选、翻页或切模式不另计；固定路径、标题，不发送搜索词、筛选条件或课号。

每日 `Archive repository traffic` 工作流将 GitHub Traffic 返回的已结束 UTC 日的日浏览数与当日独立访客数按日期写入独立分支 `traffic-history` 的 `traffic-history.json`；也可从默认分支手动运行。归档不触发 Pages 部署，不保存 URL、来源或用户信息。GitHub 只提供近 14 天，首次只能回填仍可读取的日期。失败不覆盖历史，成功重抓会更新仍在窗口内的修订值。每日独立访客数相加不等于跨日独立访客数。

## 处理读者推荐

「推荐资料来源」Issue 只收公开链接，不接收文件或登录凭据。维护者先核对课程归属、链接与重复记录，再按资料复核流程登记；不要从 Issue 自动导入 URL 或执行其中的内容。采纳后按投稿人选择致谢，Issue 本身不等于 GitHub 提交贡献。