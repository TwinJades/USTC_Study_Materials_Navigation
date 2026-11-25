# 参与贡献

欢迎推荐课程资料、报告问题、提出改进建议或直接提交 Pull Request（PR）。

## 提交 Issue

- 推荐资料时填写[资料来源表单](https://github.com/TwinJades/USTC_Study_Materials_Navigation/issues/new?template=suggest-source.yml)，提供稳定的原始链接、课程名称或课号，以及能核实的资料类型。
- 遇到页面故障、链接失效或资料归错课程时填写[问题表单](https://github.com/TwinJades/USTC_Study_Materials_Navigation/issues/new?template=report-problem.yml)。尽量提供页面地址、复现步骤或出错的条目，以及预期结果。
- 建议新功能时填写[功能建议表单](https://github.com/TwinJades/USTC_Study_Materials_Navigation/issues/new?template=feature-request.yml)，描述使用场景和目前遇到的困难。涉及批量收录、数据结构或主要交互的改动，建议先开 Issue 讨论范围。可以直接为小修复提交 PR。

提交前请搜索现有 Issue 和 PR。仓库公开，请勿上传资料原件、登录凭据、带临时签名的链接或涉及个人信息的截图。

## 提交 PR

1. 从上游最新的 `main` 建立工作分支。使用 fork 时，推送到自己的 fork，再向 `TwinJades/USTC_Study_Materials_Navigation` 的 `main` 提交 PR。
2. 每个 PR 聚焦一个主题，填写改动目的和验证结果。有相关 Issue 时在 PR 中链接，完全解决时可写 `Closes #123`。界面改动请提供复现或验收步骤，有必要时附上脱敏截图。
3. 修改资料索引时，提供课号、原始链接、可复核的归属依据、访问要求及公开署名。记录实际核验到的信息，保留不确定项。按[数据契约](docs/development.md#数据文件)修改源数据，并用构建脚本更新生成文件。
4. 用 Node.js 24 或以上运行以下检查。`npm test` 包含 Chrome 或 Edge 浏览器测试，可用 `CHROME_PATH` 或 `EDGE_PATH` 指定浏览器。请在 PR 中说明未执行或跳过的检查。

   ```sh
   npm run validate -- --strict-research
   npm test
   npm run build
   ```

5. 可以先开 Draft PR 征求意见。准备合并前，`PR checks` 必须通过，且需要至少一位非作者的项目维护者在 GitHub 上提交 `Approve`。影响发布、权限或批量资料归属的改动需要第二位维护者复核。维护者会在 PR 中记录需要修改的事项，变更后请重新请求审核。详见[协作流程](docs/workflow.md)。

本地预览可运行 `npm run serve`。数据字段、生成文件和发布说明见[开发与数据契约](docs/development.md)。
