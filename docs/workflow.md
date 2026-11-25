# 协作流程

适用于所有人与 Agent 的一切改动。对外提交入口见 [贡献指南](../CONTRIBUTING.md)，数据与构建契约见 [开发与数据契约](development.md)，项目边界与入口见 [项目交接](handoff.md)。

## 主循环

1. 同步 main。本地 main 只用于同步，不在上面干活。
2. 从最新 main 开分支干活；可每任务一个 worktree。
3. push 前若 main 已前进，把新 main 同步进自己分支；冲突在自己分支上解。
4. push 分支，开 PR。
5. 确认 `PR checks` 和其他必需检查通过，至少一位非作者的维护者在 GitHub 上提交 `Approve`，审核会话已处理完毕。改动影响发布、权限或批量资料归属时，再找一位维护者独立复核；作者和审核人都可以提出升级审核，合并人负责确认。
6. 在 GitHub 上一次合一个。下一个 PR 先通过 `Update branch` 或在本地同步最新 `main`。fork PR 默认由作者同步，作者主动授权时维护者也可代办。作者失联且冲突复杂时，维护者可将改动整理到新分支并提交 PR，保留原作者署名（`Co-authored-by`），合并后关闭原 PR。
7. 合并后 pull main 冒烟测试。这是双保险——main 自动部署 Pages，主闸门必须在合并前。
8. 清理：只删「已合并且 git status 干净」的分支/worktree；有未提交工作的绝不碰。

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

个人账号仓库的批准按写权限计数。请将写权限授予承担审核职责的维护者。配置术语见 [GitHub Rulesets 文档](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)。
