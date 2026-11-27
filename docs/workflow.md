# 协作流程

适用于所有人与 Agent 的改动。对外贡献入口见 [参与贡献](../CONTRIBUTING.md)；项目范围、数据与构建契约见 [开发与数据契约](development.md)。

## 看板与认领

待办统一放在 [GitHub Project「也西书架」](https://github.com/users/TwinJades/projects/1)：`Backlog` → `Ready` → `In Progress` → `In Review` → `Done`。

- 协作者都可以把准备开工的任务、读者推荐或问题移到 `Ready`，也可以直接认领。由做事的人指定任务，Agent 不主动派单。
- 新需求没有对应 Issue 时，Agent 新建并认领。改错字、修单个坏链、紧急回滚等小修可直接提 PR。
- 有 Issue 时以 Issue 卡为准；没有 Issue 的小修才用 PR 卡跟踪。自动上板的重复 PR 卡不需要单独维护状态。
- 本地交接笔记放 `.task-work/` 或 `handoff.local.md`，不提交到仓库。

## 主循环

1. **同步 `main`**：本地 `main` 仅用于同步，不直接开发。
2. **认领并开分支**：给选定或新建的 Issue 设置 Assignee，移入 `In Progress`；从最新 `main` 开任务分支，可使用独立 worktree。
3. **同步上游变更**：push 前若 `main` 已前进，先把最新 `main` 合入当前分支并就地解决冲突。
4. **提交 PR**：完整解决 Issue 时正文写 `Closes #编号`，仅相关时普通引用。工作仍未完成时，卡片留在 `In Progress`（可开 Draft PR）；完成并提审后，把 Issue 卡移入 `In Review`，没有 Issue 的小修则移动 PR 卡。
5. **检查与审核**：确认 `PR checks` 等必需检查全部通过，审核会话均已处理，并按下文「风险与审核」核对当前版本的 `Approve`（普通 PR 至少一位非作者维护者，高风险 PR 至少两位）。
6. **逐一合并**：一次合一个 PR；下一个 PR 合并前先同步最新 `main`。fork PR 由作者同步或授权维护者代办；作者失联且冲突复杂时，维护者可整理至新分支，保留 `Co-authored-by` 署名，合并后关闭原 PR。合并后确认已关闭的 Issue 或无 Issue 的 PR 卡进入 `Done`。
7. **合后冒烟**：拉取最新 `main`，核对受影响的功能。
8. **清理分支**：只清理已合并且 `git status` 干净的分支、worktree 和对应的本地交接笔记。

## 风险与审核

每条 PR 都在描述的「风险」栏写明「普通」或「高风险」，附一句理由。以下任一项受影响，就按高风险处理：

- **发布或自动化写入**：改网站发布的触发、输入或产物，或改机器人写数据的目标及关键路径。例如迁移每周监控快照、修改会决定整站能否更新的读取逻辑。只改工作流注释不算。
- **权限或合并门槛**：改谁能写入、谁能批准、什么条件下能合并。例如调整 Actions 写权限、修改必需检查或审核规则（包括本节）。
- **批量资料归属或访问要求**：一批已有资料被改归其他课程、改标访问权限，或一个规则变化会让许多条目一起被重新判断。批量新增已逐项核实的资料不因此自动升级。

作者先判断；审核人根据实际改动可以升级。两者都可以让自己的 AI 判断并代贴 `high-risk` 标签。高风险应同时写明理由、贴 `high-risk`；漏填不默认算普通，合并前先补判、补标签。如果改判为普通，先记录原因，再移除标签。

开 PR 默认不邀请审核人、不 `@` 人；明确要求才发送审核请求。高风险仍需两位有写权限的非作者维护者独立审阅当前版本并分别提交 GitHub `Approve`；普通评论或 Agent 审核报告不计票。

执行合并的人或 Agent 核对实际改动、风险标签、批准和 CI，缺票不合并。GitHub 原生要求至少一票；`Review gate` 只对有 `high-risk` 标签的 PR 数两票，不判断风险、不邀请、不代审或自动合并。先确定风险再合并；标签或审核状态刚变动时，等检查更新。合并人可以是作者，但不能用作者账号给自己的 PR 投批准票。

## 硬规则

- `main` 仅接受 PR 合并，冲突须在任务分支内解决。
- 复核须核对当前最新提交：资料变更抽查课号归属、原始出处与访问要求；界面变更按验收步骤核对实际页面。发现阻断问题提交 `Request changes`，修复后重新复核。
- 合后如发现回归，可在原 PR 发起 `Revert` 并经回滚 PR 撤销。

## CI 闸门

- `PR checks` 在面向 `main` 的 PR 上依次执行严格数据校验、测试与站点构建，仅授予只读权限；Pages 发布与周监控仅在上游默认分支运行，每日流量归档仅在默认分支运行。
- fork PR 首次运行工作流前须经维护者检查改动后批准运行。
- 本地与 CI 均须实际运行 Chrome / Edge 浏览器回归测试并通过 `skipped 0` 闸门（路径配置见 [测试](development.md#测试)）。

## 上游分支保护

上游 `Settings → Rules → Rulesets` 中的 `Protect Main` 规则仅匹配 `main`（排除 `monitoring-data`、`traffic-history` 等数据分支），保持 `Active` 且绕过名单为空：

- 启用 `Require a pull request before merging`（要求至少 **1** 次批准），开启 `Dismiss stale pull request approvals when new commits are pushed` 与 `Require conversation resolution before merging`。
- 启用 `Require status checks to pass`，必选 `PR checks`（来源 GitHub Actions），并要求合并前分支与 `main` 同步。
- 启用 `Restrict deletions` 与 `Block force pushes`。

### 启用 `Review gate`

合并工作流后先试跑，不立即设为必需。确认仓库已有 `high-risk` 标签；对已打开的 PR，可在 Actions 的 **Recalculate review gate** 中输入 PR 编号手动刷新。用真实 fork PR 核对：普通 PR 交给原生一票；高风险当前版本一票为失败、两票为成功、撤销第二票后重新失败，推送新提交不沿用旧票。检查 `Review gate` 出现在 PR 的检查区，且状态属于对应的提交。fork 的审核事件只读，默认分支工作流重读 API 后写入状态，不执行 PR 代码。

遇到首次提交的公开 fork PR，或有人刚撤回批准时，合并前到 Actions 确认对应的 **Review gate events** 没有卡在 `Waiting for approval`，并确认检查已反映最新票数。若事件仍在等待批准或票数未刷新，可手动运行 **Recalculate review gate**，输入 PR 编号，等检查更新后再决定能否合并。

GitHub 按提交共享检查结果。同一 head SHA 有多条指向 `main` 的开放 PR 时，所有带 `high-risk` 标签的 PR 各自满足两票才会亮绿灯；验收时用一条普通 PR 与一条高风险 PR 共用 head，确认普通 PR 的刷新不会覆盖高风险的一票阻断。若两条 PR 不应一起等待，让其中一条使用不同的提交。

重算过程中，同一提交上的高风险 PR 名单如有变化，会按新名单再算一次；重算期间若名单再变，不发布本次计票结论，等待下一次刷新。

验收通过后，在 `Protect Main` 的必需检查保留 `PR checks`，加上 `Review gate`（来源选 GitHub Actions），原生批准数保持 **1**。最后在测试 PR 合并框确认高风险一票被挡、两票通过后才放行。若状态未刷新，可手动重算；不要用合并来跳过未完成的检查。

个人账号仓库的批准按写权限计数。请将写权限授予承担审核职责的维护者。配置术语见 [GitHub Rulesets 文档](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rulesets)。
