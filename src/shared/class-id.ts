// =============================================================
// 班级编号生成 — 渲染端表单与 Agent 建班工具共用
//
// 规则：年级数字-班号，如 七年级 + 3班 → G7-3；高一 + 4班 → G10-4。
// 高中必须先于「一/二/三」匹配，否则「高一」会被当成一年级。
// =============================================================

/** 年级文本 → 年级数字（七年级 → 7，高一 → 10），无法识别返回 null */
export function gradeToNumber(grade: string): string | null {
  if (!grade) return null
  // 高中先匹配：高一/高二/高三 含「一/二/三」，不能走下面的小学/初中表
  if (grade.includes('高三') || /高\s*3/.test(grade)) return '12'
  if (grade.includes('高二') || /高\s*2/.test(grade)) return '11'
  if (grade.includes('高一') || /高\s*1/.test(grade)) return '10'
  const cnMap = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
  for (let i = 0; i < cnMap.length; i++) {
    if (grade.includes(cnMap[i])) return String(i + 1)
  }
  // 「3班」是班号不是年级；纯数字或「7年级」/「Grade 8」才当年级
  if (/^\d+\s*班/.test(grade.trim())) return null
  const m = grade.match(/\d+/)
  return m ? m[0] : null
}

/** 从班级名称里提取班号（如 "3班" / "高一4班" → "4"），无数字返回 null */
export function classNoFromName(name: string): string | null {
  const m = name.match(/\d+/)
  return m ? m[0] : null
}

/**
 * 自动计算班级编号：年级数字-班号。
 * 年级为空时也会从 name 里推断（如 name="高一4班" → G10-4）。
 */
export function computeAutoClassId(grade: string, name: string): string | null {
  const g = gradeToNumber(grade) || gradeToNumber(name)
  const n = classNoFromName(name)
  if (g && n) return `G${g}-${n}`
  return null
}

export interface InferredClass {
  /** 显示名，如 高一4班 */
  name: string
  /** 年级，如 高一 */
  grade: string
  /** 班级编号，如 G10-4 */
  class_id: string
}

/**
 * 从花名册标题/班级名推断班级。
 * 支持「高一4班」「九年级3班」「九龙高级中学高一4班」。
 */
export function inferClassFromLabel(text: string): InferredClass | null {
  const t = String(text ?? '').trim()
  if (!t) return null

  const senior = t.match(/高([一二三])\s*[（(]?\s*(\d+)\s*[)）]?\s*班/)
  if (senior) {
    const grade = `高${senior[1]}`
    const name = `高${senior[1]}${senior[2]}班`
    const class_id = computeAutoClassId(grade, `${senior[2]}班`)
    return class_id ? { name, grade, class_id } : null
  }

  const junior = t.match(/([七八九])年级\s*[（(]?\s*(\d+)\s*[)）]?\s*班/)
  if (junior) {
    const grade = `${junior[1]}年级`
    const name = `${grade}${junior[2]}班`
    const class_id = computeAutoClassId(grade, `${junior[2]}班`)
    return class_id ? { name, grade, class_id } : null
  }

  const class_id = computeAutoClassId('', t)
  if (!class_id) return null
  return { name: t, grade: '', class_id }
}
