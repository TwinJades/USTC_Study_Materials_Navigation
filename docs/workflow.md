# 协作流程

适用于所有人与 Agent 的一切改动。对外提交入口见 [贡献指南](../CONTRIBUTING.md)，数据与构建契约见 [开发与数据契约](development.md)，项目边界与入口见 [项目交接](handoff.md)。

## 主循环

1. 同步 main。本地 main 只用于同步，不在上面干活。
2. 从最新 main 开分支干活；可每任务一个 worktree。
3. push 前若 main 已前进，把新 main 同步进自己分支；冲突在自己分支上解。
4. push 分支，开 PR。
5. 合并前确认 `PR checks` 和其他必需检查通过，审核会话已处理完毕，并按下文核对当前版本的 `Approve`：普通 PR 至少一位非作者维护者，高风险 PR 至少两位。
6. 在 GitHub 上一次合一个。下一个 PR 先通过 `Update branch` 或在本地同步最新 `main`。fork PR 默认由作者同步，作者主动授权时维护者也可代办。作者失联且冲突复杂时，维护者可将改动整理到新分支并提交 PR，保留原作者署名（`Co-authored-by`），合并后关闭原 PR。
7. 合并后 pull main 冒烟测试。这是双保险——main 自动部署 Pages，主闸门必须在合并前。
8. 清理：只删「已合并且 git status 干净」的分支/worktree；有未提交工作的绝不碰。

## 风险与审核

每条 PR 都在描述的「风险」栏写明「普通」或「高风险」，附一句理由。以下任一项受影响，就按高风险处理：

- **发布或自动化写入**：改网站发布的触发、输入或产物，或改机器人写数据的目标及关键路径。例如迁移每周监控快照、修改会决定整站能否更新的读取逻辑。只改工作流注释不算。
- **权限或合并门槛**：改谁能写入、谁能批准、什么条件下能合并。例如调整 Actions 写权限、修改必需检查或审核规则（包括本节）。
- **批量资料归属或访问要求**：一批已有资料被改归其他课程、改标访问权限，或一个规则变化会让许多条目一起被重新判断。批量新增已逐项核实的资料不因此自动升级。

作者先判断；审核人根据实际改动可以升级。两者都可以让自己的 AI 判断并代贴 `high-risk` 标签。高风险应同时写明理由、贴 `high-risk`；漏填不默认算普通，合并前先补判、补标签。如果改判为普通，先记录原因，再移除标签。

开 PR 默认不邀请审核人、不 `@` 人；明确要求才发送审核请求。高风险仍需两位有写权限的非作者维护者独立审阅当前版本并分别提交 GitHub `Approve`；普通评论或 Agent 审核报告不计票。

执行合并的人或 Agent 核对实际改动、风险标签、批准和 CI，缺票不合并。GitHub 原生要求至少一票；`Review gate` 只对有 `high-risk` 标签的 PR 数两票，不判断风险、不邀请、不代审或自动合并。先确定风险再合并；标签或审核状态刚变动时，等检查更新。合并人可以是作者，但不能用作者账号给自己的 PR 投批准票。

## 硬规则

- `main` 只接收 PR 合并。上游管理员按下文启用分支保护，启用前由合并人核对条件。
- 冲突在 PR 分支上解，不在 main 上解。
- 复核当前版本。资料变更抽查课程归属、原始出处和访问要求。界面变更按 PR 中的步骤检查实际页面。发现阻断问题时使用 `Request changes`，修复后重新查看变更。
- 合并后发现回归，可在原 PR 发起 `Revert`，通过回滚 PR 撤销变更。

## CI 闸门

- `PR checks` 在面向 `main` 的 PR 上依次执行严格数据校验、测试和站点构建。CI 使用 GitHub 托管 runner，使用只读仓库权限，构建产物仅用于验证。Pages 发布和每周外链维护仅在上游默认分支运行。
- fork PR 的工作流运行可能需要维护者先批准。批准前请检查工作流和它会执行的脚本。合并审核通过 GitHub Review 提交。
- 本地用 Chrome 或 Edge 运行浏览器测试，必要时设置 `CHROME_PATH` 或 `EDGE_PATH`。CI 要求浏览器测试实际运行。

## 上游分支保护

1. 确认 `PR checks` 在引入 CI 之后的另一条 PR 上成功运行。升级合并规则前，确认周维护不再写 `main`，并在 Actions 手动运行一次周维护，核对 Pages 部署成功。
2. 在上游 `Settings → Rules → Rulesets` 编辑 `Protect Main`，只匹配 `main`，保持 `Active` 和空绕过名单。
   - `Require a pull request before merging`，要求 **1** 次批准。启用 `Dismiss stale pull request approvals when new commits are pushed` 和 `Require conversation resolution before merging`。
   - `Require status checks to pass`，选择 `PR checks`（来源选 GitHub Actions），并要求分支在合并前与 `main` 保持同步。
   - `Restrict deletions` 和 `Block force pushes`。
3. 在上游 PR 上检查合并状态。没有有效批准、检查失败或有未解决的审核会话时，GitHub 应阻止合并。

### 启用 `Review gate`

合并工作流后先试跑，不立即设为必需。确认仓库已有 `high-risk` 标签；对已打开的 PR，可在 Actions 的 **Recalculate review gate** 中输入 PR 编号手动刷新。用真实 fork PR 核对：普通 PR 交给原生一票；高风险当前版本一票为失败、两票为成功、撤销第二票后重新失败，推送新提交不沿用旧票。检查 `Review gate` 出现在 PR 的检查区，且状态属于对应的提交。fork 的审核事件只读，默认分支工作流重读 API 后写入状态，不执行 PR 代码。

遇到首次提交的公开 fork PR，或有人刚撤回批准时，合并前到 Actions 确认对应的 **Review gate events** 没有卡在 `Waiting for approval`，并确认检查已反映最新票数。若事件仍在等待批准或票数未刷新，可手动运行 **Recalculate review gate**，输入 PR 编号，等检查更新后再决定能否合并。

GitHub 按提交共享检查结果。同一 head SHA 有多条指向 `main` 的开放 PR 时，所有带 `high-risk` 标签的 PR 各自满足两票才会亮绿灯；验收时用一条普通 PR 与一条高风险 PR 共用 head，确认普通 PR 的刷新不会覆盖高风险的一票阻断。若两条 PR 不应一起等待，让其中一条使用不同的提交。

重算过程中，同一提交上的高风险 PR 名单如有变化，会按新名单再算一次；重算期间若名单再变，不发布本次计票结论，等待下一次刷新。

验收通过后，在 `Protect Main` 的必需检查保留 `PR checks`，加上 `Review gate`（来源选 GitHub Actions），原生批准数保持 **1**。最后在测试 PR 合并框确认高风险一票被挡、两票通过后才放行。若状态未刷新，可手动重算；不要用合并来跳过未完成的检查。

个人账号仓库的批准按写权限计数。请将写权限授予承担审核职责的维护者。配置术语见 [GitHub Rulesets 文档](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)。
