// 智能体/模型运行时的类型契约出口。
// src/main 下除本文件外不得 `import type ... '@earendil-works/*'`：
// 换运行时（pi → dsh）时只需改写这里的再导出，业务侧契约保持不变。
export type {
  Agent,
  AgentEvent,
  AgentMessage,
  AgentTool,
  AgentToolResult,
  CompactionSettings,
} from '@earendil-works/pi-agent-core'
// compat 是 pi-ai 根入口的超集（官方声明「switch imports unchanged」），
// 统一走 compat 可避免 root/compat 两处来源的同名类型分叉。
export type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  ImageContent,
  Message,
  Model,
  ModelThinkingLevel,
  TextContent,
  ThinkingLevel,
} from '@earendil-works/pi-ai/compat'
