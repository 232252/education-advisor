// =============================================================
// File Tools — 文本写入工具(write_file)
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

const writeFileParams = Type.Object({
  path: Type.String({ description: '要写入的文件绝对路径（如 C:\\Users\\...\\output.txt）' }),
  content: Type.String({ description: '要写入的文本内容' }),
})

// =============================================================
// 4. 写入文本文件
// =============================================================
export const writeFileTool: AgentTool<typeof writeFileParams> = {
  name: 'write_file',
  label: '写入文件',
  description:
    '将文本内容写入本地文件（支持 .txt, .md, .csv, .json, .yaml 等文本格式）。文件不存在时自动创建，已存在时覆盖。你运行在用户本地桌面，拥有完整文件系统权限，不是沙箱。',
  parameters: writeFileParams,
  execute: async (_toolCallId, params, signal) => {
    // F1 修复: pi-agent-core 以 execute(id, args, signal) 传入 AbortSignal,入口协作式中止
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
