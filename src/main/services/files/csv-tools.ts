// =============================================================
// File Tools — CSV 写入工具(write_csv,含 CSV 转义与 UTF-8-BOM 处理)
// 从 file-tools.ts 拆分(纯重构,逻辑逐字搬移)
// =============================================================

import type fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { validateFilePath } from './security'
import { textResult } from './shared'

// =============================================================
// Schema 定义
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

// =============================================================
// 6. 写入 CSV 文件
// =============================================================
export const writeCsvTool: AgentTool<typeof writeCsvParams> = {
  name: 'write_csv',
  label: '写入 CSV',
  description:
    '创建 CSV 文件并写入表头和数据行。默认使用 UTF-8-BOM 编码（Excel 可直接打开中文不乱码）。你运行在本地桌面，拥有文件系统写入权限。',
  parameters: writeCsvParams,
  execute: async (_toolCallId, params, signal) => {
    // F1 修复: pi-agent-core 以 execute(id, args, signal) 传入 AbortSignal,入口协作式中止
    if (signal?.aborted) return textResult('已取消')
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
