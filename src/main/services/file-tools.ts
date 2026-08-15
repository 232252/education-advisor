// =============================================================
// File Tools — 入口(re-export + 工具全集组装)
// 让 Agent 具备读取本地文件的能力
// 支持: 文本文件、Excel (.xlsx/.xls)、CSV、目录列表
// 实现已拆分至 ./files/(纯重构,逻辑逐字搬移,契约不变)
// =============================================================

import type { AgentTool } from '@earendil-works/pi-agent-core'
import { writeCsvTool } from './files/csv-tools'
import { readExcelTool, writeExcelTool } from './files/excel-tools'
import { listDirTool, readFileTool } from './files/read-tools'
import { writeFileTool } from './files/write-text'

export { writeCsvTool } from './files/csv-tools'
export { readExcelTool, writeExcelTool } from './files/excel-tools'
export { listDirTool, readFileTool } from './files/read-tools'
export { validateFilePath } from './files/security'
export { writeFileTool } from './files/write-text'

// =============================================================
// 导出：所有文件工具
// =============================================================

// biome-ignore lint/suspicious/noExplicitAny: TSchema constraint requires any
export const allFileTools: AgentTool<any>[] = [
  readFileTool,
  readExcelTool,
  listDirTool,
  writeFileTool,
  writeExcelTool,
  writeCsvTool,
]
