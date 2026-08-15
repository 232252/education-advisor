// =============================================================
// Agents 模块共享类型
// =============================================================

/** Agent 属性更新补丁（agent:update 支持的字段） */
export type AgentUpdatePatch = Partial<{
  name: string
  description: string
  modelTier: 'high_quality' | 'low_cost'
  capabilities: string[]
  mcpServers: string[]
}>

/** 详情面板 Tab 键 */
export type TabKey = 'config' | 'run' | 'soul' | 'rules' | 'history'
