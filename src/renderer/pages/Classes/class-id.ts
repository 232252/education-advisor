// =============================================================
// 班级编号生成工具 — 从 ClassesPage 提取的纯函数
//
// 班级编号自动生成规则：根据年级 + 班号拼出 G7-3 这种格式。
//   - 年级映射：一/二/.../九 年级 → 1~9；若年级文本含阿拉伯数字则直接用。
//   - 班号：从班级名称里提取首个数字（如 "3班" → "3"）。
// =============================================================

/** 年级文本 → 年级数字（如 "七年级" → "7"），无法识别返回 null */
export function gradeToNumber(grade: string): string | null {
  if (!grade) return null
  const cnMap = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
  for (let i = 0; i < cnMap.length; i++) {
    if (grade.includes(cnMap[i])) return String(i + 1)
  }
  const m = grade.match(/\d+/)
  return m ? m[0] : null
}

/** 从班级名称里提取班号（如 "3班" → "3"），无数字返回 null */
export function classNoFromName(name: string): string | null {
  const m = name.match(/\d+/)
  return m ? m[0] : null
}

/**
 * 自动计算班级编号：年级数字-班号，如 七年级 + 3班 → G7-3。
 * 年级或班号任一无法识别时返回 null。
 */
export function computeAutoClassId(grade: string, name: string): string | null {
  const g = gradeToNumber(grade)
  const n = classNoFromName(name)
  if (g && n) return `G${g}-${n}`
  return null
}
