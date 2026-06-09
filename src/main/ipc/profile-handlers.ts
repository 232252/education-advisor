// =============================================================
// Student Profile IPC 处理器
// =============================================================

import { ipcMain } from 'electron'
import * as IPC from '../../shared/ipc-channels'
import type { StudentProfileData } from '../../shared/types'
import { profileService } from '../services/profile-service'

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
  return cleaned
}

export function registerProfileHandlers() {
  // 读取学生扩展档案
  ipcMain.handle(IPC.IPC_PROFILE_GET, async (_e, name: string) => {
    const safeName = sanitizeName(name)
    const data = profileService.get(safeName)
    return { success: true, data }
  })

  // 写入学生扩展档案
  ipcMain.handle(IPC.IPC_PROFILE_SET, async (_e, name: string, data: StudentProfileData) => {
    const safeName = sanitizeName(name)
    if (!data || typeof data !== 'object') {
      throw new Error('data must be a non-null object')
    }
    return profileService.update(safeName, data)
  })

  console.log('[IPC] Profile handlers registered')
}
