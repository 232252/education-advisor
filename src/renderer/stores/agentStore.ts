// =============================================================
// @deprecated 请直接 import './agent/store'(本文件为兼容旧路径的 re-export shim)
// Agent Store — Agent 状态管理 (Zustand) 聚合入口
// 实现按域拆分至 ./agent/ 目录,本入口保持原导入路径与导出契约不变
// =============================================================

export { useAgentStore } from './agent/store'
export type {
  AgentState,
  AgentStatusUpdate,
} from './agent/types'
