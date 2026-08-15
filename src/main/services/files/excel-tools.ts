// =============================================================
// File Tools — Excel (.xlsx/.xls) 读写工具(read_excel / write_excel)
// 从 file-tools.ts 拆分(纯重构,逻辑逐字搬移)
// =============================================================

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import * as XLSX from 'xlsx'
import { checkFileSize, MAX_EXCEL_ROWS, validateFilePath } from './security'
import { textResult } from './shared'

// =============================================================
// Schema 定义
// =============================================================

const readExcelParams = Type.Object({
  path: Type.String({ description: 'Excel 文件的绝对路径或相对路径（.xlsx 或 .xls）' }),
  sheet: Type.Optional(Type.String({ description: '工作表名称，不填则读取第一个工作表' })),
  maxRows: Type.Optional(Type.Number({ description: '最大读取行数，默认 5000' })),
})

const writeExcelParams = Type.Object({
  path: Type.String({ description: '要写入的 Excel 文件绝对路径（.xlsx）' }),
  sheets: Type.Array(
    Type.Object({
      name: Type.String({ description: '工作表名称' }),
      headers: Type.Array(Type.String(), { description: '表头列名数组' }),
      rows: Type.Array(Type.Array(Type.String()), {
        description: '数据行数组，每行是字符串数组',
      }),
    }),
    { description: '工作表列表' },
  ),
})

// =============================================================
// 2. 读取 Excel 文件
// =============================================================
export const readExcelTool: AgentTool<typeof readExcelParams> = {
  name: 'read_excel',
  label: '读取 Excel',
  description:
    '读取 Excel 文件（.xlsx/.xls）的内容。返回工作表数据，包括表头和所有行。可指定工作表名称和最大行数。',
  parameters: readExcelParams,
  execute: async (_toolCallId, params, signal) => {
    // F1 修复: pi-agent-core 以 execute(id, args, signal) 传入 AbortSignal,入口协作式中止
    if (signal?.aborted) return textResult('已取消')
    validateFilePath(params.path)
    const resolvedPath = path.resolve(params.path)

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`文件不存在: ${resolvedPath}`)
    }

    await checkFileSize(resolvedPath)

    const ext = path.extname(resolvedPath).toLowerCase()
    if (ext !== '.xlsx' && ext !== '.xls') {
      throw new Error(`不支持的文件格式: ${ext}，仅支持 .xlsx 和 .xls`)
    }

    // 注意：XLSX.readFile 是同步阻塞调用，会阻塞 Electron 主进程事件循环
    // xlsx 库未提供异步版本；此处保持同步实现，但不应在高频路径调用，且用 try/catch 防止崩溃
    let workbook: XLSX.WorkBook
    try {
      workbook = XLSX.readFile(resolvedPath)
    } catch (err) {
      throw new Error(`读取 Excel 文件失败: ${resolvedPath} - ${(err as Error).message}`)
    }
    const sheetNames = workbook.SheetNames

    if (sheetNames.length === 0) {
      throw new Error('Excel 文件中没有工作表')
    }

    const targetSheet = params.sheet || sheetNames[0]
    if (!sheetNames.includes(targetSheet)) {
      throw new Error(`工作表 "${targetSheet}" 不存在。可用工作表: ${sheetNames.join(', ')}`)
    }

    const worksheet = workbook.Sheets[targetSheet]
    const maxRows = params.maxRows || MAX_EXCEL_ROWS

    // 转为 JSON 数组（第一行作为表头）
    const data = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      blankrows: false,
    }) as unknown[][]

    // 限制行数
    const truncated = data.length > maxRows
    const rows = truncated ? data.slice(0, maxRows) : data

    // 格式化为可读文本
    const lines: string[] = []
    lines.push(`📊 Excel 文件: ${path.basename(resolvedPath)}`)
    lines.push(`工作表: ${targetSheet}`)
    lines.push(`总行数: ${data.length}${truncated ? `（已截断为 ${maxRows} 行）` : ''}`)
    lines.push(`工作表列表: ${sheetNames.join(', ')}`)
    lines.push('---')

    if (rows.length > 0) {
      // 表头
      const headers = (rows[0] as string[]).map(String)
      lines.push(`表头: ${headers.join(' | ')}`)
      lines.push('')

      // 数据行
      for (let i = 1; i < rows.length; i++) {
        // F1 修复: 逐行循环中协作式中止检查点,避免大表格式化期间无法响应 abort
        if (signal?.aborted) return textResult('已取消')
        const row = rows[i] as unknown[]
        const cells = row.map((cell) => {
          if (cell === null || cell === undefined || cell === '') return '(空)'
          return String(cell)
        })
        lines.push(`第${i}行: ${cells.join(' | ')}`)
      }
    } else {
      lines.push('(空表格)')
    }

    return textResult(lines.join('\n'))
  },
}

// =============================================================
// 5. 写入 Excel 文件
// =============================================================
export const writeExcelTool: AgentTool<typeof writeExcelParams> = {
  name: 'write_excel',
  label: '写入 Excel',
  description:
    '创建或覆盖一个 Excel 文件（.xlsx），写入指定的工作表、表头和数据行。你运行在用户本地桌面，拥有完整文件系统权限，不是沙箱环境。',
  parameters: writeExcelParams,
  execute: async (_toolCallId, params, signal) => {
    // F1 修复: 入口协作式中止(见 readExcelTool 注释)
    if (signal?.aborted) return textResult('已取消')
    validateFilePath(params.path)
    const resolvedPath = path.resolve(params.path)

    // 确保父目录存在
    const dir = path.dirname(resolvedPath)
    try {
      await fsp.mkdir(dir, { recursive: true })
    } catch (err) {
      throw new Error(`创建目录失败: ${dir} - ${(err as Error).message}`)
    }

    const workbook = XLSX.utils.book_new()

    for (const sheet of params.sheets) {
      // F1 修复: 逐 sheet 循环中协作式中止检查点
      if (signal?.aborted) return textResult('已取消')
      const data: unknown[][] = [sheet.headers, ...sheet.rows]
      const worksheet = XLSX.utils.aoa_to_sheet(data)
      XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name)
    }

    // 注意：XLSX.writeFile 是同步阻塞调用，会阻塞 Electron 主进程事件循环
    // xlsx 库未提供异步版本；此处保持同步实现，但不应在高频路径调用，且用 try/catch 防止崩溃
    try {
      XLSX.writeFile(workbook, resolvedPath)
    } catch (err) {
      throw new Error(`写入 Excel 文件失败: ${resolvedPath} - ${(err as Error).message}`)
    }

    let stat: fs.Stats
    try {
      stat = await fsp.stat(resolvedPath)
    } catch (err) {
      throw new Error(`获取写入文件信息失败: ${resolvedPath} - ${(err as Error).message}`)
    }
    return textResult(
      `✅ Excel 已写入: ${resolvedPath}\n` +
        `工作表: ${params.sheets.map((s) => s.name).join(', ')}\n` +
        `大小: ${stat.size} bytes\n` +
        `总行数: ${params.sheets.reduce((sum, s) => sum + s.rows.length, 0)}`,
    )
  },
}
