// =============================================================
// MCP Tools — 将 MCP server 工具适配为 pi-agent-core AgentTool 入口
//
// 实现已按职责拆分至 mcp-management/tools/ 目录:
//   - schema.ts    JSON Schema → typebox 转换
//   - sanitize.ts  参数安全校验(validateFilePath / sanitizeArg)
//   - adapter.ts   MCP tool → AgentTool 适配 + AbortSignal + 结果格式化
//   - aggregate.ts 按 Agent 聚合工具(三层配置合并)
//
// 本文件保留原导出集(re-export),签名不变。
//
// 安全设计:
//   - 路径参数(名称含 path/file/dir)强制走 validateFilePath(14 个敏感路径黑名单)
//   - 所有字符串参数走 sanitizeArg(控制字符/shell 元字符/ -- 前缀过滤)
//   - 工具名前缀 mcp_<serverId>_,与 EAA 工具(eaa_*)和内置工具(read_file 等)区分
//   - 调用结果大小限制由 mcp-service.ts 的 callTool 保证(5MB)
// =============================================================

export { mcpToolToAgentTool } from './mcp-management/tools/adapter'
export { getMcpToolsForAgent } from './mcp-management/tools/aggregate'
export { sanitizeMcpArgs } from './mcp-management/tools/sanitize'
export { jsonSchemaToTypebox } from './mcp-management/tools/schema'
