// =============================================================
// privacy-mappings — 隐私映射表纯逻辑(防御性解析 + 重复实体预检)
// 逻辑自 PrivacyPage.tsx 逐字搬移,行为不变
// =============================================================

import type { PrivacyMapping } from '@shared/types'

// 类型单一来源在 @shared/types(privacy.ts);此处转发给既有相对导入方,
// 消除曾出现字段漂移的双定义(entityType 放宽/缺 createdAt)
export type { PrivacyMapping }

// 防御性校验：确保 data 是数组（bridge 可能返回字符串）
export function parsePrivacyMappings(data: unknown): PrivacyMapping[] {
  let parsed = data
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      parsed = []
    }
  }
  return Array.isArray(parsed) ? parsed : []
}

// CONCERN 修复 + MEDIUM 修复: 前端重复实体预检,避免无意义的 IPC 调用
// MEDIUM 修复: email/person 类型大小写不敏感比较(ZHANG SAN vs zhang san 视为重复)
// 其他类型(student_id/id_card/phone/place/org)按原值比较,避免误判
const CASE_INSENSITIVE_TYPES = new Set(['person', 'email'])

export function isDuplicateEntity(
  mappings: PrivacyMapping[],
  entityType: string,
  name: string,
): boolean {
  const shouldIgnoreCase = CASE_INSENSITIVE_TYPES.has(entityType)
  const normalizedNewName = shouldIgnoreCase ? name.toLowerCase() : name
  return mappings.some((m) => {
    if (m.entityType !== entityType) return false
    const existingName = shouldIgnoreCase ? m.realName.toLowerCase() : m.realName
    return existingName === normalizedNewName
  })
}
