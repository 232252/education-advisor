// =============================================================
// Agent Store — Agent 状态管理 (Zustand) 聚合入口
// 实现按域拆分至 ./agent/ 目录,本入口保持原导入路径与导出契约不变
// =============================================================

export { useAgentStore } from './agent/store'
export type {
  AgentState,
  AgentStatusUpdate,
} from './agent/types'
