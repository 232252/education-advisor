// =============================================================
// File Tools — 读取类工具(read_file / list_dir,含编码解析)
// 从 file-tools.ts 拆分(纯重构,逻辑逐字搬移)
// =============================================================

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { checkFileSize, validateFilePath } from './security'
import { MAX_TOOL_RESULT_CHARS, textResult, truncateForResult } from './shared'

/**
 * L-3 修复: 校验 encoding 参数是否为 Node.js 支持的 BufferEncoding。
 * 防止用户传入无效编码导致 fs.readFile 运行时抛错。
 */
const VALID_ENCODINGS = new Set<BufferEncoding>([
  'utf-8',
  'utf8',
  'utf-16le',
  'utf16le',
  'latin1',
  'binary',
  'ascii',
  'base64',
  'base64url',
  'hex',
  'ucs-2',
  'ucs2',
])

/**
 * M7 修复(2026-08-28 智能轮): 此前 gbk/gb2312 静默回退 utf-8 — 老编码文件
 * 读出来是替换符乱码,工具不报错,模型拿到 mojibake 还以为"编码已支持",
 * 只能基于乱码编造内容。现在明确报错并给出可执行指引(转存 UTF-8)。
 */
function resolveEncoding(encoding: string | undefined): BufferEncoding {
  if (!encoding) return 'utf-8'
  const lower = encoding.toLowerCase()
  if (VALID_ENCODINGS.has(lower as BufferEncoding)) {
    return lower as BufferEncoding
  }
  throw new Error(
    `不支持的编码: ${encoding}。Node.js 原生仅支持 utf-8/utf-16le/latin1 等,` +
      'GBK/GB2312 文件请先让用户转存为 UTF-8 后再读取;若文件实际是 UTF-8,请去掉 encoding 参数重试。',
  )
}

// =============================================================
// Schema 定义
// =============================================================

const readFileParams = Type.Object({
  path: Type.String({ description: '文件的绝对路径或相对路径' }),
  encoding: Type.Optional(
    Type.String({
      description:
        '文件编码,默认 utf-8(仅支持 utf-8/utf-16le/latin1 等 Node.js 原生编码,不支持 gbk)',
    }),
  ),
  offset: Type.Optional(
    Type.Number({
      description: `起始字符偏移(默认 0)。超过 ${MAX_TOOL_RESULT_CHARS} 字符的结果会被截断并提示下一页 offset,据此续读`,
    }),
  ),
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
  execute: async (_toolCallId, params, signal) => {
    // F1 修复: pi-agent-core 以 execute(id, args, signal) 传入 AbortSignal,入口协作式中止
    if (signal?.aborted) return textResult('已取消')
    validateFilePath(params.path)
    const resolvedPath = path.resolve(params.path)

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`文件不存在: ${resolvedPath}`)
    }

    await checkFileSize(resolvedPath)

    const encoding = resolveEncoding(params.encoding) // L-3 修复: 安全解析编码
    let content: string
    try {
      content = await fsp.readFile(resolvedPath, encoding)
    } catch (err) {
      throw new Error(`读取文件失败: ${resolvedPath} - ${(err as Error).message}`)
    }

    const ext = path.extname(resolvedPath).toLowerCase()
    const fileName = path.basename(resolvedPath)

    // H4 修复(2026-08-28 智能轮): 全文原样返回 → 分页截断。
    // 大 CSV/日志一次挤爆上下文的问题见 shared.MAX_TOOL_RESULT_CHARS 注释。
    const offset = typeof params.offset === 'number' && params.offset >= 0 ? params.offset : 0
    const body = truncateForResult(content, offset)
    const pageInfo =
      content.length > MAX_TOOL_RESULT_CHARS ? `(共 ${content.length} 字符,已分页)` : ''
    return textResult(
      `📄 文件: ${fileName} (${ext}) ${pageInfo}\n路径: ${resolvedPath}\n---\n${body}`,
    )
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
  execute: async (_toolCallId, params, signal) => {
    // F1 修复: 入口协作式中止(见 readFileTool 注释)
    if (signal?.aborted) return textResult('已取消')
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

    // H4 修复: 条目上限,超大目录(如 node_modules)不再全量列出挤爆上下文
    const MAX_LIST_ENTRIES = 500
    if (entries.length > MAX_LIST_ENTRIES) {
      entries = entries.slice(0, MAX_LIST_ENTRIES)
      lines.push(`[已截断] 仅显示前 ${MAX_LIST_ENTRIES} 个条目,如需定位具体文件请用更精确的路径`)
    }

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
