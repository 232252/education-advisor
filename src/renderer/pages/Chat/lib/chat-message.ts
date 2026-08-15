// =============================================================
// Chat 消息纯逻辑 — 上传文件拼接 / stable key 生成
// =============================================================

import type { ChatMessage } from '@shared/types'

/** 上传文件元信息 */
export interface UploadedFile {
  name: string
  path: string
  size: number
  content: string
  mimeType: string
}

/** 单文件内容截断上限 (32KB)，避免上下文爆炸 */
export const MAX_FILE_CONTENT_LENGTH = 32 * 1024

/**
 * 拼接上传文件内容到消息文本。
 * 文件内容以结构化方式注入,让 Agent 能识别文件边界和元信息。
 */
export function buildFinalText(text: string, uploadedFiles: UploadedFile[]): string {
  if (uploadedFiles.length === 0) return text
  const fileBlocks = uploadedFiles.map((f) => {
    const sizeKb = (f.size / 1024).toFixed(1)
    const truncated = f.content.length > MAX_FILE_CONTENT_LENGTH
    const content = truncated ? f.content.slice(0, MAX_FILE_CONTENT_LENGTH) : f.content
    const truncationNote = truncated ? `\n[... 已截断,原始大小 ${sizeKb}KB ...]` : ''
    return `--- 文件: ${f.name} (${sizeKb}KB, ${f.mimeType}) ---\n${content}${truncationNote}\n--- 文件结束 ---`
  })
  return `${text}\n\n${fileBlocks.join('\n\n')}`
}

/**
 * P2-7: 组合 stable key (role + 索引 + content 前 16 字符哈希)
 * 优先用 msg.id,缺失时降级到组合 key
 */
export function getMessageKey(msg: ChatMessage, index: number): string {
  const id = (msg as { id?: string }).id
  return id ? `${id}` : `${msg.role}-${index}-${msg.content.slice(0, 16)}`
}
