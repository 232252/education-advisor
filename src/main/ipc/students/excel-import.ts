// =============================================================
// 学生 Excel 导入 — 纯解析/校验逻辑（无 IPC、无 electron 依赖，可单测）
// M30: 表头识别(name 必填, student_id/class_name 可选) + 行级冲突检测
// (空行/缺姓名/文件内重名/已存在学生/班级不存在)
// =============================================================

import path from 'node:path'
import type {
  ClassEntity,
  StudentImportPreview,
  StudentImportRow,
  StudentImportRowError,
} from '@shared/types'
import { sanitizeName } from '../../utils/sanitize'

/** 模板表头（name 必填；student_id/class_name 可选） */
export const TEMPLATE_HEADERS = ['name', 'student_id', 'class_name'] as const

/** 模板工作表名 */
export const TEMPLATE_SHEET_NAME = 'students'

/** 数据区最大行数（与 agent 侧 read_excel 的 MAX_EXCEL_ROWS 对齐） */
export const MAX_IMPORT_ROWS = 5000

/** 表头列索引（-1 表示该可选列不存在） */
export interface HeaderIndexes {
  name: number
  studentId: number
  className: number
}

/** 从表头行解析列索引；name 列缺失返回 null（整表不可导入） */
export function resolveHeaderIndexes(headerRow: unknown[]): HeaderIndexes | null {
  const headers = headerRow.map((h) =>
    String(h ?? '')
      .trim()
      .toLowerCase(),
  )
  const name = headers.indexOf(TEMPLATE_HEADERS[0])
  if (name === -1) return null
  return {
    name,
    studentId: headers.indexOf(TEMPLATE_HEADERS[1]),
    className: headers.indexOf(TEMPLATE_HEADERS[2]),
  }
}

/**
 * 校验 Excel 文件路径（与 eaa/params.ts buildImportArgs 同款防护：
 * NUL 字节 / 路径遍历 / 扩展名白名单）
 */
export function validateExcelFilePath(
  filePath: string,
  allowedExts: string[] = ['.xlsx', '.xls'],
): { ok: true } | { ok: false; error: string } {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return { ok: false, error: 'filePath must be a non-empty string' }
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional NUL-byte guard
  if (/\x00/.test(filePath)) {
    return { ok: false, error: 'filePath contains null bytes' }
  }
  if (filePath.includes('..')) {
    return { ok: false, error: 'filePath cannot contain path traversal (..)' }
  }
  const ext = path.extname(filePath).toLowerCase()
  if (!allowedExts.includes(ext)) {
    return {
      ok: false,
      error: `file extension not supported: ${ext}, allowed: ${allowedExts.join(', ')}`,
    }
  }
  return { ok: true }
}

/** 班级列表 → classKey(name/class_id 均可匹配) → class_id 索引 */
export function buildClassIndex(classes: ClassEntity[]): Map<string, string> {
  const index = new Map<string, string>()
  for (const c of classes) {
    if (c.name) index.set(c.name, c.class_id)
    if (c.class_id) index.set(c.class_id, c.class_id)
  }
  return index
}

function cellText(cells: unknown[], col: number): string {
  if (col < 0) return ''
  const v = cells[col]
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

/**
 * 矩阵（sheet_to_json header:1 产物）→ 导入预览。
 * 冲突检测顺序：空行 → 缺姓名 → 姓名非法 → 文件内重名 → 已存在学生 → 班级不存在。
 * existingNames: 现有非 Deleted 学生名集合；classIndex: buildClassIndex 产物。
 */
export function parseStudentImportMatrix(
  matrix: unknown[][],
  existingNames: ReadonlySet<string>,
  classIndex: ReadonlyMap<string, string>,
): StudentImportPreview {
  const empty: StudentImportPreview = { success: false, rows: [], errors: [], totalRows: 0 }
  if (!Array.isArray(matrix) || matrix.length === 0) {
    return { ...empty, error: 'Excel 文件中没有工作表数据' }
  }
  const header = resolveHeaderIndexes(matrix[0] ?? [])
  if (!header) {
    return { ...empty, error: `缺少必填列表头 "name"（模板列: ${TEMPLATE_HEADERS.join(', ')}）` }
  }
  const dataRows = matrix.slice(1)
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return { ...empty, error: `数据行数过多: ${dataRows.length}（上限 ${MAX_IMPORT_ROWS} 行）` }
  }

  const rows: StudentImportRow[] = []
  const errors: StudentImportRowError[] = []
  const seen = new Set<string>()

  for (let i = 0; i < dataRows.length; i++) {
    const cells = dataRows[i] ?? []
    // matrix 下标 i 对应数据区第 i+1 行，即 Excel 第 i+2 行（表头占第 1 行）
    const excelRow = i + 2
    const nameRaw = cellText(cells, header.name)
    const studentId = cellText(cells, header.studentId)
    const className = cellText(cells, header.className)
    const allEmpty = cells.every((c) => c === null || c === undefined || String(c).trim() === '')
    if (allEmpty) {
      errors.push({ row: excelRow, name: '', reason: 'empty_row' })
      continue
    }
    if (!nameRaw) {
      errors.push({ row: excelRow, name: '', reason: 'missing_name' })
      continue
    }
    let name: string
    try {
      name = sanitizeName(nameRaw, 'name')
    } catch {
      errors.push({ row: excelRow, name: nameRaw, reason: 'invalid_name' })
      continue
    }
    if (seen.has(name)) {
      errors.push({ row: excelRow, name, reason: 'duplicate_in_file' })
      continue
    }
    if (existingNames.has(name)) {
      errors.push({ row: excelRow, name, reason: 'already_exists' })
      continue
    }
    let classId: string | null = null
    if (className) {
      classId = classIndex.get(className) ?? null
      if (!classId) {
        errors.push({ row: excelRow, name, reason: 'class_not_found' })
        continue
      }
    }
    seen.add(name)
    rows.push({ row: excelRow, name, studentId, className, classId })
  }
  return { success: true, rows, errors, totalRows: dataRows.length }
}
