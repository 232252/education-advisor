# scripts/archive/ — 已归档的一次性脚本

本目录存放历史上使用过、目前无任何调用方（package.json / CI / 代码）的一次性脚本。
仅作历史参考，不参与构建与 CI。归档日期：2026-08-19。

| 脚本 | 历史用途 |
| --- | --- |
| `repro-pollution.mjs` | 复现历史 bug：多轮（部分 reset + 加学生 + 加事件）后 ranking 过滤为空 |
| `repro-ranking.mjs` | 复现历史 bug：business-scenario 场景 3 按 class_id 过滤 ranking 失败 |
| `write-path-test.mjs` | CDP 探针：写入链路 + Agent 运行 + 飞书异常测试（见 OPTIMIZATION_REPORT ROUND2/3） |
| `soak-test.mjs` | CDP 浸泡测试：6 轮随机页面 + 随机 IPC 调用，监控错误与内存 |
| `memory-stability.mjs` | CDP 内存稳定性：连续 12 轮路由切换，观察 JS 堆与 DOM 节点是否泄漏 |
| `concurrent-test.mjs` | CDP 并发写压力：10 学生各 5 条事件共 50 写并发提交，验证写队列串行化（见 ROUND4） |
| `tour-check.mjs` | CDP 页面全巡检：导航所有路由，捕获 console 错误/异常，断言关键 UI 元素 |
| `check-pages.mjs` | CDP page checker：逐路由导航、检查错误并报告状态 |
| `verify-clean.mjs` | CDP 校验测试后数据无残留（学生数应为 18、ranking 正常） |
| `copy-sidecar-deps.mjs` | 复制 sidecar 运行时依赖（含传递依赖）到 dist/node_modules，服务于已废弃的 Tauri 打包方案 |
| `cron-cleanup.mjs` | CDP 清理测试脚本残留在 cron 中的 e2e/UI 任务 |
| `diag.mjs` | CDP 诊断脚本：捕获页面状态与 console 错误 |
| `doctor-detail.mjs` | CDP 调用 `api.eaa.doctor()` 输出详细诊断 JSON |
| `gen-nsis-assets.mjs` | 一次性生成 NSIS 安装器侧边栏图片资源（产物已入库，无需重跑） |
| `run-linux.sh` | Linux 开发环境运行脚本（electron + X11 + 可选 CDP），无 package.json/CI 调用方 |
