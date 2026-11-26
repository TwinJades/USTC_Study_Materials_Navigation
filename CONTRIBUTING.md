# 参与贡献

欢迎推荐课程资料、分享衍生项目、反馈问题或提交 Pull Request（PR）。

## 提交 Issue

提交前请先搜索已有 Issue 和 PR，避免重复。由于本仓库完全公开，请只分享公开链接，不要上传资料原件、账号凭据、临时签名链接或包含个人信息的截图。

- [推荐资料来源](https://github.com/TwinJades/USTC_Study_Materials_Navigation/issues/new?template=suggest-source.yml)：附上公开链接、对应课名或课号，以及大致的资料内容。
- [推荐衍生项目](https://github.com/TwinJades/USTC_Study_Materials_Navigation/issues/new?template=suggest-project.yml)：分享基于也西书架数据开发的公开项目、工具或题库。
- [报告问题](https://github.com/TwinJades/USTC_Study_Materials_Navigation/issues/new?template=report-problem.yml)：反馈页面异常、外链失效或课程归属有误，尽量附上页面链接与复现方式。
- [提出改进建议](https://github.com/TwinJades/USTC_Study_Materials_Navigation/issues/new?template=feature-request.yml)：聊聊使用场景和遇到的不便；若涉及批量收录、数据结构或较大交互改动，建议先开 Issue 沟通方案。

## 提交 PR

1. 从最新 `main` 切出工作分支（外部贡献者可先 Fork 仓库，推到自己的分支后再向本仓 `main` 提 PR）。
2. 每个 PR 聚焦一个主题，说明改动范围与验证结果；关联 Issue 时可写 `Closes #123`，界面改动请附截图（注意隐去个人信息）与简要检查步骤。
3. 修改资料索引时，注明课号、原始链接、归属依据、访问方式与作者署名；按 [开发与数据契约](docs/development.md#数据文件) 修改源文件，再用构建脚本同步生成产物。
4. 使用 Node.js 24 及以上版本运行本地检查，如有跳过项请在 PR 中说明：

   ```sh
   npm run validate -- --strict-research
   npm test
   npm run build
   ```

   `npm test` 包含 Chrome / Edge 浏览器回归测试，可用 `CHROME_PATH` 或 `EDGE_PATH` 指定浏览器路径；本地预览可运行 `npm run serve`。
5. 合并前须通过 `PR checks` 并获得至少一位非作者维护者的 `Approve`；涉及发布、权限或批量资料归属时，需另由一位维护者复核。完整协作与审核规则见 [协作流程](docs/workflow.md)。
