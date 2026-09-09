// =============================================================
// EAA Tools — 工具注册与 capability 映射(allEAATools / getToolsByCapability)
// 从 eaa-tools.ts 拆分(纯重构,逻辑逐字搬移)
// =============================================================

import type { AgentTool } from '@earendil-works/pi-agent-core'
import { examGradesTool, examsTool, studentGradesTool } from './academic-tools'
import { createClassTool, importStudentsTool, listClassesTool } from './class-tools'
import { addEventTool, revertEventTool } from './event-tools'
import { gradingOverviewTool, gradingStudentTool } from './grading-tools'
import { historyTool, queryScoreTool, searchEventsTool, tagTool } from './query-tools'
import {
  codesTool,
  listStudentsTool,
  rangeTool,
  rankingTool,
  statsTool,
  summaryTool,
} from './report-tools'
import { addStudentTool, deleteStudentTool, setStudentMetaTool } from './student-tools'

// =============================================================
// 导出：按能力分组的工具集
// =============================================================

/**
 * 安全工具集：不含删除操作，用于 'all'/'*' capability 和大多数 Agent。
 * deleteStudentTool 是危险操作，必须显式声明 'delete' capability 才能获得。
 */
export const allEAATools: AnyAgentTool[] = [
  queryScoreTool,
  addEventTool,
  historyTool,
  searchEventsTool,
  listStudentsTool,
  rankingTool,
  statsTool,
  codesTool,
  summaryTool,
  addStudentTool,
  rangeTool,
  setStudentMetaTool,
  revertEventTool,
  tagTool,
  listClassesTool,
  createClassTool,
  importStudentsTool,
  // 学业考试数据(academic-service 直读,不走 Rust CLI)
  examsTool,
  examGradesTool,
  studentGradesTool,
  // AI 批改数据(grading-service 直读,只读)
  gradingOverviewTool,
  gradingStudentTool,
]

/** 危险工具集：仅在 Agent 显式声明 'delete' capability 时才暴露 */
export const dangerousEAATools: AnyAgentTool[] = [deleteStudentTool]

// biome-ignore lint/suspicious/noExplicitAny: 异构工具集合，TSchema 约束不兼容 unknown
type AnyAgentTool = AgentTool<any>

/** 按 capability 名称匹配工具 */
export function getToolsByCapability(capabilities: string[]): AnyAgentTool[] {
  const capSet = new Set(capabilities.map((c) => c.toLowerCase()))

  const tools = new Set<AnyAgentTool>()

  // 'all' / '*' 授予安全工具全集(不含删除)
  if (capSet.has('all') || capSet.has('*')) {
    for (const t of allEAATools) tools.add(t)
  }

  // 'delete' 是独立危险 capability,即使配了 'all' 也必须显式声明才获得删除工具
  if (capSet.has('delete')) {
    for (const t of dangerousEAATools) tools.add(t)
  }

  const mapping: Record<string, AnyAgentTool[]> = {
    score: [queryScoreTool],
    add_event: [addEventTool],
    history: [historyTool],
    search: [searchEventsTool],
    list: [listStudentsTool, listClassesTool],
    ranking: [rankingTool],
    stats: [statsTool],
    codes: [codesTool],
    summary: [summaryTool],
    add_student: [addStudentTool, importStudentsTool],
    range: [rangeTool],
    set_student_meta: [setStudentMetaTool],
    revert: [revertEventTool],
    tag: [tagTool],
    delete: [deleteStudentTool],
    read: [
      queryScoreTool,
      historyTool,
      searchEventsTool,
      listStudentsTool,
      listClassesTool,
      rankingTool,
      statsTool,
      codesTool,
      summaryTool,
      rangeTool,
      tagTool,
      // 考试成绩与操行数据同级敏感度,read 类 agent 一并可见
      examsTool,
      examGradesTool,
      studentGradesTool,
      gradingOverviewTool,
      gradingStudentTool,
    ],
    write: [
      addEventTool,
      addStudentTool,
      setStudentMetaTool,
      revertEventTool,
      createClassTool,
      importStudentsTool,
    ],
    class: [listClassesTool, createClassTool],
    import_students: [importStudentsTool],
    // 也可单独授予学业成绩(不需要整套 read)
    academics: [
      examsTool,
      examGradesTool,
      studentGradesTool,
      gradingOverviewTool,
      gradingStudentTool,
    ],
  }

  for (const cap of capSet) {
    const matched = mapping[cap]
    if (matched) {
      for (const tool of matched) tools.add(tool)
    }
  }
  return Array.from(tools)
}
