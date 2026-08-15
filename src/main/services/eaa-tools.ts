// =============================================================
// EAA Agent Tools — 入口(re-export)
// 将 EAA Bridge 包装为 pi-agent-core AgentTool
// Agent 可以调用这些工具来查询/操作学生操行数据
// 实现已拆分至 ./eaa/tools/(纯重构,逻辑逐字搬移,契约不变)
// =============================================================

export { addEventTool, revertEventTool } from './eaa/tools/event-tools'
export { historyTool, queryScoreTool, searchEventsTool, tagTool } from './eaa/tools/query-tools'
export {
  allEAATools,
  dangerousEAATools,
  getToolsByCapability,
} from './eaa/tools/registry'
export {
  codesTool,
  listStudentsTool,
  rangeTool,
  rankingTool,
  statsTool,
  summaryTool,
} from './eaa/tools/report-tools'
export { sanitizeArg, tokenizeQuery } from './eaa/tools/sanitize'
export {
  addStudentTool,
  deleteStudentTool,
  setStudentMetaTool,
} from './eaa/tools/student-tools'
