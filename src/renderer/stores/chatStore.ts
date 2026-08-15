// =============================================================
// Chat Store — 对话状态管理 (Zustand) 聚合入口
// 支持流式文本、思考过程、工具调用、用量统计
// 支持对话持久化（通过 IPC 到 SQLite）
// 纯 Agent 模式: 消息流经 handleAgentEvent 桥接 (direct 直连流已移除)
// 实现按域拆分至 ./chat/ 目录,本入口保持原导入路径与导出契约不变
// =============================================================

export { useChatStore } from './chat/store'
export type { AgentBridgeEvent, ChatSession, ChatState } from './chat/types'
