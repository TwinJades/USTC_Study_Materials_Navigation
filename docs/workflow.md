# 协作流程

适用于所有人与 Agent 的改动。对外贡献入口见 [贡献指南](../CONTRIBUTING.md)，数据与构建契约见 [开发与数据契约](development.md)，项目边界与源码索引见 [项目交接](handoff.md)。

## 主循环

1. **同步 `main`**：本地 `main` 仅用于同步，不直接开发。
2. **开分支作业**：从最新 `main` 切出任务分支（可按任务使用独立 worktree）。
3. **同步上游变更**：push 前若 `main` 已前进，先把最新 `main` 合入当前分支并就地解决冲突。
4. **提交 PR**：推送分支并发起 Pull Request。
5. **检查与审核**：确认 `PR checks` 等必需检查全部通过，获至少一位非作者维护者的 `Approve`，且审核会话均已处理；改动涉及发布、权限或批量资料归属时须另找一位维护者独立复核（作者与审核人均可发起升级，合并人最终确认）。
6. **逐一合并**：在 GitHub 上一次合并一个 PR；下一个 PR 合并前先同步最新 `main`（fork PR 由作者同步或授权维护者代办；作者失联且冲突复杂时，维护者可整理至新分支并保留 `Co-authored-by` 署名）。
7. **合后冒烟**：合并后拉取最新 `main` 冒烟核对。
8. **清理分支**：仅删除已合并且 `git status` 干净的分支或 worktree。

## 硬规则

- `main` 仅接受 PR 合并，不在 `main` 上解冲突。
- 复核须核对当前最新提交：资料变更抽查课号归属、原始出处与访问要求；界面变更按验收步骤核对实际页面。发现阻断问题提交 `Request changes`，修复后重新复核。
- 合后如发现回归，可在原 PR 发起 `Revert` 并经回滚 PR 撤销。

## CI 闸门

- `PR checks` 在面向 `main` 的 PR 上依次执行严格数据校验、测试与站点构建，仅授予只读权限；Pages 发布、周监控与每日流量归档仅在上游默认分支运行。
- fork PR 首次运行工作流前须经维护者检查改动后批准运行。
- 本地与 CI 均须实际运行 Chrome / Edge 浏览器回归测试（可通过 `CHROME_PATH` 或 `EDGE_PATH` 指定路径）。

## 上游分支保护

上游 `Settings → Rules → Rulesets` 中的 `Protect Main` 规则仅匹配 `main`，保持 `Active` 且绕过名单为空（仅保护默认分支，不匹配 `monitoring-data` 或 `traffic-history` 等数据分支）：

- 启用 `Require a pull request before merging`（要求至少 **1** 次批准），开启 `Dismiss stale pull request approvals when new commits are pushed` 与 `Require conversation resolution before merging`。
- 启用 `Require status checks to pass`，必选 `PR checks`（来源 GitHub Actions），并要求合并前分支与 `main` 同步。
- 启用 `Restrict deletions` 与 `Block force pushes`。
- 个人账号仓库的批准按写权限计数，须为承担审核职责的维护者授予仓库写权限。
