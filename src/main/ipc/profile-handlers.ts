// =============================================================
// Student Profile IPC 处理器
// 支持学业成绩的全链路：校验 → 隐私 → 存储
// =============================================================

import { ipcMain } from 'electron'
import * as IPC from '../../shared/ipc-channels'
import type { AcademicExamRecord, StudentProfileData } from '../../shared/types'
import { profileService } from '../services/profile-service'

function sanitizeName(name: string): string {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('name must be a non-empty string')
  }
  if (name.length > 64) {
    throw new Error('name too long (max 64 chars)')
  }
  const cleaned = name
    .replace(/[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/g, '')
    .trim()
  if (cleaned.length === 0) {
    throw new Error('name is empty after cleaning')
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: NUL-byte guard
  if (/\x00/.test(cleaned)) {
    throw new Error('name contains null bytes')
  }
  if (/[`$;|&<>{}]/.test(cleaned)) {
    throw new Error('name contains illegal characters')
  }
  return cleaned
}

export function registerProfileHandlers() {
  // 读取学生扩展档案
  ipcMain.handle(IPC.IPC_PROFILE_GET, async (_e, name: string) => {
    const safeName = sanitizeName(name)
    const data = await profileService.get(safeName)
    return { success: true, data }
  })

  // 写入学生扩展档案
  ipcMain.handle(IPC.IPC_PROFILE_SET, async (_e, name: string, data: StudentProfileData) => {
    const safeName = sanitizeName(name)
    if (!data || typeof data !== 'object') {
      throw new Error('data must be a non-null object')
    }
    return profileService.set(safeName, data)
  })

  // 添加一条学业成绩记录
  ipcMain.handle('profile:add-academic-record', async (_e, name: string, record: AcademicExamRecord) => {
    const safeName = sanitizeName(name)
    if (!record || typeof record !== 'object') {
      throw new Error('record must be a non-null object')
    }
    return profileService.addAcademicRecord(safeName, record)
  })

  // 获取学业成绩记录列表
  ipcMain.handle('profile:get-academic-records', async (_e, name: string) => {
    const safeName = sanitizeName(name)
    const records = await profileService.getAcademicRecords(safeName)
    return { success: true, data: records }
  })

  // 校验学业成绩数据（不保存，仅校验）
  ipcMain.handle('profile:validate-academic', async (_e, records: AcademicExamRecord[]) => {
    if (!Array.isArray(records)) {
      return { success: false, errors: ['records must be an array'] }
    }
    const errors = profileService.validateAcademicRecords(records)
    return { success: errors.length === 0, errors }
  })

  console.log('[IPC] Profile handlers registered')
}