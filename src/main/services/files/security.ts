// =============================================================
// File Tools — 路径安全校验与大小限制
// 从 file-tools.ts 拆分(纯重构,逻辑逐字搬移)
// =============================================================

import type fs from 'node:fs'
import fsp from 'node:fs/promises'

// =============================================================
// 安全限制
// =============================================================

/** 最大文件大小：5 MB（防止读取超大文件撑爆上下文） */
export const MAX_FILE_SIZE = 5 * 1024 * 1024

/** 最大 Excel 行数：5000 行 */
export const MAX_EXCEL_ROWS = 5000

/** 检查文件大小 */
export async function checkFileSize(filePath: string): Promise<void> {
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
export function validateFilePath(filePath: string): void {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('路径不能为空')
  }
  // 按 / 和 \ 分割路径，检查是否包含 ".." 段
  const segments = filePath.split(/[\\/]/)
  if (segments.includes('..')) {
    throw new Error(`路径不安全，包含 ".." 段（疑似 path traversal 攻击）: ${filePath}`)
  }
}
