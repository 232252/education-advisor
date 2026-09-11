// =============================================================
// 花名册 → 学生档案落盘 + 隐私引擎登记
// 操行系统(EAA)只存姓名；身份证/电话/住址写入 profiles/ 并由隐私引擎脱敏
// =============================================================

import type { RosterProfilePatch } from '@shared/roster-profile'
import {
  collectPrivacyTexts,
  fieldsToProfilePatch,
  profilePatchHasFields,
  toStudentProfileData,
} from '@shared/roster-profile'
import { invalidatePrivacyGuardCache } from './agent/privacy-guard'
import { eaaBridge } from './eaa-bridge'
import { profileService } from './profile-service'

export function isAlreadyExistsError(stderr: string, data: unknown): boolean {
  const text = `${stderr || ''} ${typeof data === 'string' ? data : ''}`
  return /already|已存在|exists/i.test(text)
}

/** 合并写入学生扩展档案（空补丁跳过） */
export async function applyStudentRosterProfile(
  name: string,
  patch: RosterProfilePatch,
): Promise<{ written: boolean }> {
  const normalized = fieldsToProfilePatch({
    studentNumber: patch.studentNumber,
    classId: patch.classId,
    idCard: patch.idCard,
    gender: patch.gender,
    birthDate: patch.birthDate,
    phone: patch.phone,
    address: patch.address,
    email: patch.email,
    fatherName: patch.fatherName,
    fatherPhone: patch.fatherPhone,
    motherName: patch.motherName,
    motherPhone: patch.motherPhone,
    enrollmentDate: patch.enrollmentDate,
    dormNumber: patch.dormNumber,
  })
  if (!profilePatchHasFields(normalized)) return { written: false }
  const result = await profileService.update(name, toStudentProfileData(normalized))
  if (!result.success) {
    throw new Error(result.error || '学生档案写入失败')
  }
  return { written: true }
}

async function addPrivacyEntity(entityType: string, text: string): Promise<boolean> {
  try {
    const result = await eaaBridge.execute({
      command: 'privacy',
      args: ['add', '--entity', entityType, '--text', text],
    })
    if (!result.success) return false
    if (typeof result.data === 'string' && result.data.startsWith('❌')) return false
    return true
  } catch {
    return false
  }
}

/**
 * 把花名册里的姓名/身份证/电话/住址登记到隐私引擎，供 LLM 出域脱敏。
 * 引擎未解锁时跳过（档案仍已落盘）；单条失败不阻断导入。
 */
export async function registerRosterPrivacy(
  items: Array<{ name: string; patch: RosterProfilePatch }>,
): Promise<{ registered: number; skippedLocked: boolean }> {
  if (!eaaBridge.hasPrivacyPassword()) {
    return { registered: 0, skippedLocked: true }
  }
  let registered = 0
  const seen = new Set<string>()
  for (const item of items) {
    for (const entry of collectPrivacyTexts(item.name, item.patch)) {
      const key = `${entry.entityType}\0${entry.text}`
      if (seen.has(key)) continue
      seen.add(key)
      if (await addPrivacyEntity(entry.entityType, entry.text)) registered += 1
    }
  }
  if (registered > 0) invalidatePrivacyGuardCache()
  return { registered, skippedLocked: false }
}
