// =============================================================
// MCP 连接池 — 兼容入口(re-export)
// McpClientPool 类已整体迁移至 ./mcp/pool.ts(纯重构,行为零变化),
// 其余实现按职责拆分到 ./mcp/ 目录:
//   - mcp/pool.ts       McpClientPool 类骨架(clients/connecting 管理 + 连接编排)
//   - mcp/connection.ts 单连接生命周期(stdio/sse/ws 传输 + handshake + 断开清理)
//   - mcp/protocol.ts   JSON-RPC 协议(请求/通知/响应分发 + 工具列表/调用)
//   - mcp/spawn-env.ts  spawn env 构建(PATH 合并) + Windows 命令解析
// 消费方(mcp-service.ts 等)导入路径保持不变。
// =============================================================

export { McpClientPool } from './mcp/pool'
