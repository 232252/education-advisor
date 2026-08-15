// =============================================================
// Student Profile IPC 处理器
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { StudentProfileData } from '@shared/types'
import { ipcMain } from 'electron'
import { profileService } from '../services/profile-service'

/**
 * 有意保留的本地变体,不与 utils/sanitize.ts 的统一 sanitizeName 合并:
 * 本函数面向**文件名安全**(name 会被 profileService 拼接为 profiles/<name>.json),
 * 与统一版(CLI 参数安全)语义不同 —
 *   - 本版拒绝文件系统保留字符 : * ? " < > | (统一版不拒绝,Windows 文件名不允许)
 *   - 本版仅拒绝 NUL 字节(统一版拒绝全部控制字符)
 *   - 本版不拒绝 -- 前缀(文件名场景无害;统一版用于防 CLI flag 注入)
 *   - 本版拒绝裸 "." / "..";统一版拒绝任何包含 ".." 的子串
 * 替换为统一版会放过 Windows 保留字符导致路径拼接失败,故保留并注明差异。
 */
function sanitizeName(name: string): string {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('name must be a non-empty string')
  }
  if (name.length > 64) {
    throw new Error('name too long (max 64 chars)')
  }
  // 剥离不可见 Unicode 字符，保留常见姓名符号
  const cleaned = name
    .replace(/[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/g, '')
    .trim()
  if (cleaned.length === 0) {
    throw new Error('name is empty after cleaning')
  }
  // 仅拒绝 NUL 字节和危险 shell 字符（允许 ' ( ) 等姓名常见字符）
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional NUL-byte guard against shell injection
  if (/\x00/.test(cleaned)) {
    throw new Error('name contains null bytes')
  }
  if (/[`$;|&<>{}\\]/.test(cleaned)) {
    throw new Error('name contains illegal characters')
  }
  // R87 BUG-2 修复：拒绝路径穿越字符（/ \ : * ? " < > |），
  // 与 skill-service.ts saveSkill/deleteSkill 保持一致。
  // 之前依赖 profile-service.profilePath 的 sanitize 把 / 替换为 _，
  // 但这会静默产生 ___evil.json 文件名，与 skill-service 拒绝策略不一致。
  if (/[/\\:*?"<>|]/.test(cleaned)) {
    throw new Error('name contains path separator or reserved characters')
  }
  // 拒绝 . 和 .. 作为名字（避免歧义 + 防御性编程）
  if (cleaned === '.' || cleaned === '..') {
    throw new Error('name cannot be "." or ".."')
  }
  return cleaned
}

export function registerProfileHandlers() {
  // 读取学生扩展档案
  // H-7 修复: 加 try-catch,校验/service 调用失败返回结构化错误
  ipcMain.handle(IPC.IPC_PROFILE_GET, async (_e, name: string) => {
    try {
      const safeName = sanitizeName(name)
      const data = await profileService.get(safeName)
      return { success: true, data }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] profile:get failed for "${name}":`, msg)
      return { success: false, error: msg, data: null }
    }
  })

  // 写入学生扩展档案
  // H-7 修复: 加 try-catch,校验失败返回结构化错误而非抛出
  ipcMain.handle(IPC.IPC_PROFILE_SET, async (_e, name: string, data: StudentProfileData) => {
    try {
      const safeName = sanitizeName(name)
      if (!data || typeof data !== 'object') {
        return { success: false, error: 'data must be a non-null object' }
      }
      return await profileService.update(safeName, data)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] profile:set failed for "${name}":`, msg)
      return { success: false, error: msg }
    }
  })

  console.log('[IPC] Profile handlers registered')
}
