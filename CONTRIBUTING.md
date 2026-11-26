# 参与贡献

欢迎推荐课程资料、分享衍生项目、反馈问题或提交 Pull Request（PR）。

## 提交 Issue

提交前请先搜索现有 Issue 与 PR。仓库公开，**请勿上传资料原件、登录凭据、带临时签名的链接或含个人信息的截图**。

- [推荐资料来源](https://github.com/TwinJades/USTC_Study_Materials_Navigation/issues/new?template=suggest-source.yml)：提供公开稳定的原始链接、课程名称或课号，以及可核实的资料类型。
- [推荐衍生项目](https://github.com/TwinJades/USTC_Study_Materials_Navigation/issues/new?template=suggest-project.yml)：提交基于也西书架数据或索引开发的公开项目、工具或题库。
- [报告问题](https://github.com/TwinJades/USTC_Study_Materials_Navigation/issues/new?template=report-problem.yml)：反馈页面故障、链接失效或资料归属错误，尽量附页面地址、复现步骤与预期结果。
- [提出改进建议](https://github.com/TwinJades/USTC_Study_Materials_Navigation/issues/new?template=feature-request.yml)：描述使用场景与现存痛点；涉及批量收录、数据结构或主要交互的改动，建议先开 Issue 讨论范围。

## 提交 PR

1. 从最新 `main` 切出工作分支（fork 仓库请推送至自己的 fork 后向本仓 `main` 提 PR）。
2. 每个 PR 聚焦一个主题，说明改动范围与验证结果；关联 Issue 时可写 `Closes #123`，界面改动请附验收步骤与脱敏截图。
3. 修改资料索引时，提供课号、原始链接、可核验归属依据、访问要求与公开署名；按 [开发与数据契约](docs/development.md#数据文件) 修改源文件，再用构建脚本更新生成产物。
4. 使用 Node.js 24 或以上版本运行本地检查，并在 PR 中说明未执行或跳过的项：

   ```sh
   npm run validate -- --strict-research
   npm test
   npm run build
   ```

   `npm test` 包含 Chrome / Edge 浏览器回归测试，可用 `CHROME_PATH` 或 `EDGE_PATH` 指定浏览器路径；本地预览可运行 `npm run serve`。
5. 合并前须通过 `PR checks` 并获得至少一位非作者维护者的 `Approve`；涉及发布、权限或批量资料归属时须第二位维护者复核。完整协作与审核规则见 [协作流程](docs/workflow.md)。
