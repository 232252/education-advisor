// =============================================================
// File Tools — 让 Agent 具备读取本地文件的能力
// 支持: 文本文件、Excel (.xlsx/.xls)、CSV、目录列表
// =============================================================

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import * as XLSX from 'xlsx'

// 辅助函数
function textResult(text: string): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text' as const, text }],
    details: {},
  }
}

// =============================================================
// 安全限制
// =============================================================

/** 最大文件大小：5 MB（防止读取超大文件撑爆上下文） */
const MAX_FILE_SIZE = 5 * 1024 * 1024

/** 最大 Excel 行数：5000 行 */
const MAX_EXCEL_ROWS = 5000

/** 检查文件大小 */
async function checkFileSize(filePath: string): Promise<void> {
  let stat: fs.Stats
  try {
    stat = await fsp.stat(filePath)
  } catch (err) {
    throw new Error(`获取文件大小失败: ${filePath} - ${(err as Error).message}`)
  }
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(
      `文件过大: ${(stat.size / 1024 / 1024).toFixed(1)} MB，上限 ${MAX_FILE_SIZE / 1024 / 1024} MB`,
    )
  }
}

/**
 * 校验文件路径安全性，防止路径遍历（path traversal）攻击
 * 拒绝包含 ".." 路径段的输入；调用方应在 path.resolve 之前对原始入参调用本函数
 * @param filePath 待校验的原始路径（来自外部参数）
 */
function validateFilePath(filePath: string): void {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('路径不能为空')
  }
  // 按 / 和 \ 分割路径，检查是否包含 ".." 段
  const segments = filePath.split(/[\\/]/)
  if (segments.includes('..')) {
    throw new Error(`路径不安全，包含 ".." 段（疑似 path traversal 攻击）: ${filePath}`)
  }
}

// =============================================================
// Schema 定义
// =============================================================

const readFileParams = Type.Object({
  path: Type.String({ description: '文件的绝对路径或相对路径' }),
  encoding: Type.Optional(Type.String({ description: '文件编码，默认 utf-8，可选 gbk/gb2312' })),
})

const readExcelParams = Type.Object({
  path: Type.String({ description: 'Excel 文件的绝对路径或相对路径（.xlsx 或 .xls）' }),
  sheet: Type.Optional(Type.String({ description: '工作表名称，不填则读取第一个工作表' })),
  maxRows: Type.Optional(Type.Number({ description: '最大读取行数，默认 5000' })),
})

const listDirParams = Type.Object({
  path: Type.String({ description: '目录路径' }),
})

// =============================================================
// 1. 读取文本文件
// =============================================================
export const readFileTool: AgentTool<typeof readFileParams> = {
  name: 'read_file',
  label: '读取文件',
  description:
    '读取本地文本文件内容（支持 .txt, .md, .csv, .json, .yaml, .xml 等文本格式）。对于 Excel 文件请使用 read_excel 工具。',
  parameters: readFileParams,
  execute: async (_toolCallId, params) => {
    validateFilePath(params.path)
    const resolvedPath = path.resolve(params.path)

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`文件不存在: ${resolvedPath}`)
    }

    await checkFileSize(resolvedPath)

    const encoding = (params.encoding as BufferEncoding) || 'utf-8'
    let content: string
    try {
      content = await fsp.readFile(resolvedPath, encoding)
    } catch (err) {
      throw new Error(`读取文件失败: ${resolvedPath} - ${(err as Error).message}`)
    }

    const ext = path.extname(resolvedPath).toLowerCase()
    const fileName = path.basename(resolvedPath)

    return textResult(`📄 文件: ${fileName} (${ext})\n路径: ${resolvedPath}\n---\n${content}`)
  },
}

// =============================================================
// 2. 读取 Excel 文件
// =============================================================
export const readExcelTool: AgentTool<typeof readExcelParams> = {
  name: 'read_excel',
  label: '读取 Excel',
  description:
    '读取 Excel 文件（.xlsx/.xls）的内容。返回工作表数据，包括表头和所有行。可指定工作表名称和最大行数。',
  parameters: readExcelParams,
  execute: async (_toolCallId, params) => {
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
// 3. 列出目录内容
// =============================================================
export const listDirTool: AgentTool<typeof listDirParams> = {
  name: 'list_dir',
  label: '列出目录',
  description: '列出指定目录下的文件和子目录，显示名称、大小和类型。',
  parameters: listDirParams,
  execute: async (_toolCallId, params) => {
    validateFilePath(params.path)
    const resolvedPath = path.resolve(params.path)

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`目录不存在: ${resolvedPath}`)
    }

    let stat: fs.Stats
    try {
      stat = await fsp.stat(resolvedPath)
    } catch (err) {
      throw new Error(`获取目录信息失败: ${resolvedPath} - ${(err as Error).message}`)
    }
    if (!stat.isDirectory()) {
      throw new Error(`路径不是目录: ${resolvedPath}`)
    }

    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(resolvedPath, { withFileTypes: true })
    } catch (err) {
      throw new Error(`读取目录失败: ${resolvedPath} - ${(err as Error).message}`)
    }

    const lines: string[] = []
    lines.push(`📁 目录: ${resolvedPath}`)
    lines.push(`条目数: ${entries.length}`)
    lines.push('---')

    // 先列目录，再列文件
    const dirs = entries.filter((e) => e.isDirectory())
    const files = entries.filter((e) => !e.isDirectory())

    if (dirs.length > 0) {
      lines.push(`子目录 (${dirs.length}):`)
      for (const d of dirs) {
        lines.push(`  📂 ${d.name}/`)
      }
    }

    if (files.length > 0) {
      lines.push(`文件 (${files.length}):`)
      for (const f of files) {
        const fullPath = path.join(resolvedPath, f.name)
        try {
          const fStat = await fsp.stat(fullPath)
          const sizeStr =
            fStat.size > 1024 * 1024
              ? `${(fStat.size / 1024 / 1024).toFixed(1)} MB`
              : fStat.size > 1024
                ? `${(fStat.size / 1024).toFixed(1)} KB`
                : `${fStat.size} B`
          const ext = path.extname(f.name).toLowerCase()
          lines.push(`  📄 ${f.name} (${ext || '无扩展名'}, ${sizeStr})`)
        } catch {
          lines.push(`  📄 ${f.name}`)
        }
      }
    }

    return textResult(lines.join('\n'))
  },
}

// =============================================================
// 4. 写入文本文件
// =============================================================

const writeFileParams = Type.Object({
  path: Type.String({ description: '要写入的文件绝对路径（如 C:\\Users\\...\\output.txt）' }),
  content: Type.String({ description: '要写入的文本内容' }),
})

export const writeFileTool: AgentTool<typeof writeFileParams> = {
  name: 'write_file',
  label: '写入文件',
  description:
    '将文本内容写入本地文件（支持 .txt, .md, .csv, .json, .yaml 等文本格式）。文件不存在时自动创建，已存在时覆盖。你运行在用户本地桌面，拥有完整文件系统权限，不是沙箱。',
  parameters: writeFileParams,
  execute: async (_toolCallId, params) => {
    validateFilePath(params.path)
    const resolvedPath = path.resolve(params.path)

    // 确保父目录存在
    const dir = path.dirname(resolvedPath)
    try {
      await fsp.mkdir(dir, { recursive: true })
    } catch (err) {
      throw new Error(`创建目录失败: ${dir} - ${(err as Error).message}`)
    }

    try {
      await fsp.writeFile(resolvedPath, params.content, 'utf-8')
    } catch (err) {
      throw new Error(`写入文件失败: ${resolvedPath} - ${(err as Error).message}`)
    }

    let stat: fs.Stats
    try {
      stat = await fsp.stat(resolvedPath)
    } catch (err) {
      throw new Error(`获取写入文件信息失败: ${resolvedPath} - ${(err as Error).message}`)
    }
    return textResult(`✅ 文件已写入: ${resolvedPath}\n大小: ${stat.size} bytes`)
  },
}

// =============================================================
// 5. 写入 Excel 文件
// =============================================================

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

export const writeExcelTool: AgentTool<typeof writeExcelParams> = {
  name: 'write_excel',
  label: '写入 Excel',
  description:
    '创建或覆盖一个 Excel 文件（.xlsx），写入指定的工作表、表头和数据行。你运行在用户本地桌面，拥有完整文件系统权限，不是沙箱环境。',
  parameters: writeExcelParams,
  execute: async (_toolCallId, params) => {
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

// =============================================================
// 6. 写入 CSV 文件
// =============================================================

const writeCsvParams = Type.Object({
  path: Type.String({ description: 'CSV 文件绝对路径（.csv）' }),
  headers: Type.Array(Type.String(), { description: '表头列名数组' }),
  rows: Type.Array(Type.Array(Type.String()), {
    description: '数据行数组，每行是字符串数组',
  }),
  encoding: Type.Optional(
    Type.String({ description: '编码，默认 utf-8-sig（兼容 Excel 打开中文），可选 gbk' }),
  ),
})

export const writeCsvTool: AgentTool<typeof writeCsvParams> = {
  name: 'write_csv',
  label: '写入 CSV',
  description:
    '创建 CSV 文件并写入表头和数据行。默认使用 UTF-8-BOM 编码（Excel 可直接打开中文不乱码）。你运行在本地桌面，拥有文件系统写入权限。',
  parameters: writeCsvParams,
  execute: async (_toolCallId, params) => {
    validateFilePath(params.path)
    const resolvedPath = path.resolve(params.path)
    const dir = path.dirname(resolvedPath)
    try {
      await fsp.mkdir(dir, { recursive: true })
    } catch (err) {
      throw new Error(`创建目录失败: ${dir} - ${(err as Error).message}`)
    }

    // CSV 转义：包含逗号、引号、换行的字段用双引号包裹
    const escapeField = (field: string): string => {
      if (
        field.includes(',') ||
        field.includes('"') ||
        field.includes('\n') ||
        field.includes('\r')
      ) {
        return `"${field.replace(/"/g, '""')}"`
      }
      return field
    }

    const lines: string[] = []
    lines.push(params.headers.map(escapeField).join(','))
    for (const row of params.rows) {
      lines.push(row.map(escapeField).join(','))
    }

    // UTF-8-BOM 前缀（Excel 兼容性）
    const encoding = params.encoding || 'utf-8-sig'
    const bom =
      encoding.toLowerCase().includes('sig') || encoding.toLowerCase().includes('bom')
        ? '\uFEFF'
        : ''
    const content = bom + lines.join('\r\n')

    try {
      await fsp.writeFile(resolvedPath, content, 'utf-8')
    } catch (err) {
      throw new Error(`写入 CSV 文件失败: ${resolvedPath} - ${(err as Error).message}`)
    }

    let stat: fs.Stats
    try {
      stat = await fsp.stat(resolvedPath)
    } catch (err) {
      throw new Error(`获取写入文件信息失败: ${resolvedPath} - ${(err as Error).message}`)
    }
    return textResult(
      `✅ CSV 已写入: ${resolvedPath}\n` +
        `列: ${params.headers.join(', ')}\n` +
        `数据行: ${params.rows.length}\n` +
        `编码: ${encoding}\n` +
        `大小: ${stat.size} bytes`,
    )
  },
}

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
