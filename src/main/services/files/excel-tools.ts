// =============================================================
// File Tools — Excel (.xlsx/.xls) 读写工具(read_excel / write_excel)
// 从 file-tools.ts 拆分(纯重构,逻辑逐字搬移)
// =============================================================

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { findGradeSheetHeaderRow } from '@shared/grade-sheet'
import { findRosterHeaderRow, isPiiRosterHeader } from '@shared/roster-profile'
import { Type } from 'typebox'
import * as XLSX from 'xlsx'
import { checkFileSize, MAX_EXCEL_ROWS, validateFilePath } from './security'
import { textResult, truncateForResult } from './shared'

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
    '读取 Excel（.xlsx/.xls）。自动跳过标题行、列出全部工作表及行数。' +
    '身份证/电话/住址等敏感列显示为「(已隐藏)」。' +
    '花名册导入用 eaa_import_students 的 excel_path；成绩表（姓名+语文/数学或考号+分数）用 eaa_import_grades 的 excel_path。' +
    '禁止把姓名/分数抄进对话，禁止编学生。考号经常不等于学号，按姓名对号，对不上的行报告给教师。',
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

    const data = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      blankrows: false,
    }) as unknown[][]

    const truncated = data.length > maxRows
    const rows = truncated ? data.slice(0, maxRows) : data

    const sheetOverview = sheetNames.map((name) => {
      const ws = workbook.Sheets[name]
      const count = (
        XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false }) as unknown[][]
      ).length
      return `${name}(${count}行)`
    })

    const lines: string[] = []
    lines.push(`📊 Excel 文件: ${path.basename(resolvedPath)}`)
    lines.push(`绝对路径: ${resolvedPath}`)
    lines.push(`工作表: ${targetSheet}`)
    lines.push(`总行数: ${data.length}${truncated ? `（已截断为 ${maxRows} 行）` : ''}`)
    lines.push(`工作表列表: ${sheetOverview.join(', ')}`)
    lines.push('---')

    if (rows.length > 0) {
      const gradeLocated = findGradeSheetHeaderRow(rows)
      const located = findRosterHeaderRow(rows)
      const headerRowIndex = gradeLocated?.rowIndex ?? located?.rowIndex ?? 0
      if (headerRowIndex > 0) {
        const title = String((rows[0] as unknown[])[0] ?? '').trim()
        lines.push(`已跳过前 ${headerRowIndex} 行标题${title ? `（${title.slice(0, 40)}）` : ''}`)
      }
      const headers = ((rows[headerRowIndex] as string[]) ?? []).map(String)
      const piiCols = headers.map((h, i) => (isPiiRosterHeader(h) ? i : -1)).filter((i) => i >= 0)
      lines.push(`表头: ${headers.join(' | ')}`)
      if (gradeLocated) {
        lines.push(
          '【成绩表】已识别姓名列和科目/分数列。导入请调用 eaa_import_grades({ excel_path: 上面的绝对路径, class_id, exam_name })。' +
            '考号经常不等于学号：按姓名匹配；对不上的行进 unmatched，禁止新建学生，禁止把分数抄进对话。不确定时先 dry_run:true。',
        )
      } else if (located) {
        lines.push(
          '【花名册】已识别姓名列。导入请调用 eaa_import_students({ excel_path: 上面的绝对路径, class_id })。' +
            '禁止把本表姓名抄进 students[]，禁止使用其他班级或上一份文件的名单。解析失败时把错误告诉教师，不要编名单。',
        )
      }
      if (piiCols.length > 0) {
        lines.push(
          '（身份证/电话/住址/邮箱等敏感列已对模型隐藏。禁止把「(已隐藏)」写进 write_excel。导入花名册请把本文件绝对路径传给 eaa_import_students 的 excel_path；整理无敏感列的表格可照常写回新文件。）',
        )
      }
      lines.push('')

      for (let i = headerRowIndex + 1; i < rows.length; i++) {
        if (signal?.aborted) return textResult('已取消')
        const row = rows[i] as unknown[]
        const cells = row.map((cell, col) => {
          if (piiCols.includes(col)) return '(已隐藏)'
          if (cell === null || cell === undefined || cell === '') return '(空)'
          return String(cell)
        })
        lines.push(`第${i - headerRowIndex}行: ${cells.join(' | ')}`)
      }
    } else {
      lines.push('(空表格)')
    }

    // H4 修复(2026-08-28 智能轮): 默认 5000 行全量格式化可达数十万字符,
    // 套统一截断 — 本工具无 offset 分页,指引模型收窄 maxRows 分段读取
    return textResult(
      truncateForResult(
        lines.join('\n'),
        0,
        '本工具无分页参数,请用更小的 maxRows(如 100)分段读取所需区间。',
      ),
    )
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
