// =============================================================
// 隐私引擎类型 — 实体类型 / 假名映射 / 预览
// =============================================================

export type EntityType =
  | 'person'
  | 'place'
  | 'org'
  | 'phone'
  | 'email'
  | 'id_card'
  | 'student_id'
  | 'custom'

export interface PrivacyMapping {
  entityType: EntityType
  pseudonym: string
  realName: string
  createdAt: number
}

export interface PrivacyPreview {
  original: string
  anonymized: string
  deanonymized: string
  filtered?: string
}
