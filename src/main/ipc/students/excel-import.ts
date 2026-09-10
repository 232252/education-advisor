// =============================================================
// 学生 Excel 导入 — 纯解析/校验逻辑（无 IPC、无 electron 依赖，可单测）
// 表头识别：中英别名（姓名/name、身份证号/id_card …）
// 行级冲突：空行/缺姓名/文件内重名/班级不存在
// 已存在学生仍可导入——用于补写档案（身份证/电话等）
// =============================================================

import { ROSTER_TEMPLATE_HEADERS, resolveRosterHeaders, rowToProfilePatch } from '@shared/roster-profile'
import type { RosterHeaderIndexes, RosterProfilePatch } from '@shared/roster-profile'
import type {
  ClassEntity,
  StudentImportPreview,
  StudentImportRow,
  StudentImportRowError,
} from '@shared/types'
import { sanitizeName, validatePathSafety } from '../../utils/sanitize'
import * as XLSX from 'xlsx'

/** 模板表头（中文列名；解析端同时接受 name/student_id 等英文别名） */
export const TEMPLATE_HEADERS = ROSTER_TEMPLATE_HEADERS

/** 模板工作表名 */
export const TEMPLATE_SHEET_NAME = 'students'

/** 数据区最大行数（与 agent 侧 read_excel 的 MAX_EXCEL_ROWS 对齐） */
const MAX_IMPORT_ROWS = 5000

export type HeaderIndexes = RosterHeaderIndexes

/** 从表头行解析列索引；姓名列缺失返回 null */
export function resolveHeaderIndexes(headerRow: unknown[]): HeaderIndexes | null {
  return resolveRosterHeaders(headerRow)
}

/**
 * 校验 Excel 文件路径(防护与 eaa 域同款:NUL/遍历/扩展名白名单,统一走 sanitize)
 */
export function validateExcelFilePath(
  filePath: string,
  allowedExts: string[] = ['.xlsx', '.xls'],
): { ok: true } | { ok: false; error: string } {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return { ok: false, error: 'filePath must be a non-empty string' }
  }
  const err = validatePathSafety(filePath, { field: 'filePath', allowedExts })
  if (err) return { ok: false, error: err }
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

export interface ParseStudentImportOptions {
  /**
   * 花名册班级列对不上本地班级时，仍导入到该班（Agent 已指定 class_id）。
   * 不填则班级列无法匹配记 class_not_found。
   */
  fallbackClassId?: string | null
}

function rowProfileFields(patch: RosterProfilePatch): Pick<
  StudentImportRow,
  | 'idCard'
  | 'gender'
  | 'birthDate'
  | 'phone'
  | 'address'
  | 'email'
  | 'fatherName'
  | 'fatherPhone'
  | 'motherName'
  | 'motherPhone'
  | 'enrollmentDate'
  | 'dormNumber'
> {
  return {
    idCard: patch.idCard ?? '',
    gender: patch.gender ?? '',
    birthDate: patch.birthDate ?? '',
    phone: patch.phone ?? '',
    address: patch.address ?? '',
    email: patch.email ?? '',
    fatherName: patch.fatherName ?? '',
    fatherPhone: patch.fatherPhone ?? '',
    motherName: patch.motherName ?? '',
    motherPhone: patch.motherPhone ?? '',
    enrollmentDate: patch.enrollmentDate ?? '',
    dormNumber: patch.dormNumber ?? '',
  }
}

/**
 * 矩阵（sheet_to_json header:1 产物）→ 导入预览。
 * 冲突检测顺序：空行 → 缺姓名 → 姓名非法 → 文件内重名 → 班级不存在。
 * 已存在学生进入可导入行（alreadyExists=true），用于补写档案。
 */
export function parseStudentImportMatrix(
  matrix: unknown[][],
  existingNames: ReadonlySet<string>,
  classIndex: ReadonlyMap<string, string>,
  options: ParseStudentImportOptions = {},
): StudentImportPreview {
  const empty: StudentImportPreview = { success: false, rows: [], errors: [], totalRows: 0 }
  if (!Array.isArray(matrix) || matrix.length === 0) {
    return { ...empty, error: 'Excel 文件中没有工作表数据' }
  }
  const header = resolveHeaderIndexes(matrix[0] ?? [])
  if (!header) {
    return {
      ...empty,
      error: `缺少必填列表头「姓名」或 "name"（模板列: ${TEMPLATE_HEADERS.join(', ')}）`,
    }
  }
  const dataRows = matrix.slice(1)
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return { ...empty, error: `数据行数过多: ${dataRows.length}（上限 ${MAX_IMPORT_ROWS} 行）` }
  }

  const rows: StudentImportRow[] = []
  const errors: StudentImportRowError[] = []
  const seen = new Set<string>()
  const fallback = options.fallbackClassId?.trim() || null

  for (let i = 0; i < dataRows.length; i++) {
    const cells = dataRows[i] ?? []
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
    let classId: string | null = null
    if (className) {
      classId = classIndex.get(className) ?? null
      if (!classId) {
        if (fallback) {
          classId = fallback
        } else {
          errors.push({ row: excelRow, name, reason: 'class_not_found' })
          continue
        }
      }
    } else if (fallback) {
      classId = fallback
    }
    seen.add(name)
    const patch = rowToProfilePatch(cells, header, classId)
    rows.push({
      row: excelRow,
      name,
      studentId,
      className,
      classId,
      alreadyExists: existingNames.has(name),
      ...rowProfileFields(patch),
    })
  }
  return { success: true, rows, errors, totalRows: dataRows.length }
}

/** 读取 Excel 首个工作表为矩阵（第一行作表头；raw:false 尽量保留身份证文本） */
export function readExcelMatrix(filePath: string): unknown[][] {
  const workbook = XLSX.readFile(filePath)
  if (workbook.SheetNames.length === 0) {
    throw new Error('Excel 文件中没有工作表')
  }
  const worksheet = workbook.Sheets[workbook.SheetNames[0]]
  return XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    blankrows: true,
    raw: false,
  }) as unknown[][]
}
