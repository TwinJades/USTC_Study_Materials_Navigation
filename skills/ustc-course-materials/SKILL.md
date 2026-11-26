---
name: ustc-course-materials
description: 查找中国科学技术大学（中科大）本科课程资料、往年试题、作业、讲义笔记、参考书或大作业时使用「也西书架」索引。
---

按以下步骤查询课程资料：

1. 读取 [课程索引](https://twinjades.github.io/USTC_Study_Materials_Navigation/data/agent/index.json) 定位课号（已知精确课号时可跳过）；若匹配到多门课程或用户需求不明确，先简短向用户确认。若目标课程 `has_resources` 为 `false`，直接告知当前暂未收录。
2. 请求单课 JSON：`https://twinjades.github.io/USTC_Study_Materials_Navigation/data/agent/courses/<文件名>`，其中文件名为 `encodeURIComponent(encodeURIComponent(课号) + '.json')`（例如 `PHYS1008B+` 对应 `PHYS1008B%252B.json`）。
3. 找到匹配资料后：若用户需要获取文件且条目含 `download_url`，直接下载到当前工作区并附上原始出处；仅有 `page_url`、需登录或下载失败时，提供原页面链接并说明访问方式。
