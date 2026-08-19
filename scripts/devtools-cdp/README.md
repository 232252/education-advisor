# devtools-cdp（开发期调试工具，非构建必需）

本目录收纳从 `scripts/` 顶层移入的一次性 CDP 调试脚本。它们用于在
开发期间通过 Chrome DevTools Protocol（CDP）对运行中的 Electron
渲染进程做截图、评测、遍历、导入/飞书诊断等。

**这些脚本不参与构建、CI 或发布流程**，仅在本地调试时手工运行。

| 脚本 | 用途 |
| --- | --- |
| `cdp-eval.mjs` | 在页面上下文执行 JS 并取回结果 |
| `cdp-interact.mjs` | 模拟点击/输入等交互 |
| `cdp-shot.mjs` | 截图 |
| `cdp-tour.mjs` | 页面遍历 |
| `cdp-diag-import.mjs` | 诊断数据导入 |
| `cdp-perf-check.mjs` | 性能抽查 |
| `cdp-chat-test.mjs` | 聊天链路测试 |
| `cdp-feishu-test.mjs` | 飞书集成测试 |
| `cdp-feishu-diag.mjs` | 飞书连接诊断 |
| `find-cdp-port.ps1` | 定位 Electron 的 CDP 调试端口 |

运行前需先以 `--remote-debugging-port` 启动 Electron，并先拿到端口
（见 `find-cdp-port.ps1`）。