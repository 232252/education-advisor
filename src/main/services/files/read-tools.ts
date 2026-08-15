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
import { textResult } from './shared'

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

function resolveEncoding(encoding: string | undefined): BufferEncoding {
  if (!encoding) return 'utf-8'
  const lower = encoding.toLowerCase()
  if (VALID_ENCODINGS.has(lower as BufferEncoding)) {
    return lower as BufferEncoding
  }
  // gbk/gb2312 等 Node.js 原生不支持的编码,fallback 到 utf-8
  return 'utf-8'
}

// =============================================================
// Schema 定义
// =============================================================

const readFileParams = Type.Object({
  path: Type.String({ description: '文件的绝对路径或相对路径' }),
  encoding: Type.Optional(Type.String({ description: '文件编码，默认 utf-8，可选 gbk/gb2312' })),
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

    return textResult(`📄 文件: ${fileName} (${ext})\n路径: ${resolvedPath}\n---\n${content}`)
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
