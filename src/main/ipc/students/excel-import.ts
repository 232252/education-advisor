// =============================================================
// 学生 Excel 导入 — 纯解析/校验逻辑（无 IPC、无 electron 依赖，可单测）
// 表头识别：中英别名（姓名/name、身份证号/id_card …）
// 行级冲突：空行/缺姓名/文件内重名/班级不存在
// 已存在学生仍可导入——用于补写档案（身份证/电话等）
// =============================================================

import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { RosterHeaderIndexes, RosterProfilePatch } from '@shared/roster-profile'
import {
  findRosterHeaderRow,
  formatMissingRosterHeaderError,
  isNonStudentRosterName,
  ROSTER_TEMPLATE_HEADERS,
  resolveRosterHeaders,
  rowToProfilePatch,
} from '@shared/roster-profile'
import type {
  ClassEntity,
  StudentImportPreview,
  StudentImportRow,
  StudentImportRowError,
} from '@shared/types'
import * as XLSX from 'xlsx'
import { decodeTextBuffer } from '../../services/grading/sample-ingest'
import { sanitizeName, validatePathSafety } from '../../utils/sanitize'

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

/** 主进程路白名单: 收 .csv(SheetJS readFile 对 csv 透明解析,GBK 中文 csv 见 roster-file) */
export const ALLOWED_EXCEL_EXTS = ['.xlsx', '.xls', '.csv']

/**
 * 校验 Excel/CSV 文件路径(防护与 eaa 域同款:NUL/遍历/扩展名白名单,统一走 sanitize)
 */
export function validateExcelFilePath(
  filePath: string,
  allowedExts: string[] = ALLOWED_EXCEL_EXTS,
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
  /** 错误信息里标注工作表名 */
  sheetLabel?: string
  /** 跨工作表去重：已见过的姓名 */
  alreadySeenNames?: ReadonlySet<string>
}

function rowProfileFields(
  patch: RosterProfilePatch,
): Pick<
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
  | 'examNumber'
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
    examNumber: patch.examNumber ?? '',
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
  const located = findRosterHeaderRow(matrix)
  if (!located) {
    return {
      ...empty,
      error: formatMissingRosterHeaderError(matrix, options.sheetLabel),
    }
  }
  const header = located.indexes
  const dataRows = matrix.slice(located.rowIndex + 1)
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return { ...empty, error: `数据行数过多: ${dataRows.length}（上限 ${MAX_IMPORT_ROWS} 行）` }
  }

  const rows: StudentImportRow[] = []
  const errors: StudentImportRowError[] = []
  const seen = new Set<string>(options.alreadySeenNames ?? [])
  const fallback = options.fallbackClassId?.trim() || null

  for (let i = 0; i < dataRows.length; i++) {
    const cells = dataRows[i] ?? []
    const excelRow = located.rowIndex + i + 2
    const nameRaw = cellText(cells, header.name)
    const studentId = cellText(cells, header.studentId)
    const examNumber = cellText(cells, header.examNumber)
    const className = cellText(cells, header.className)
    const allEmpty = cells.every((c) => c === null || c === undefined || String(c).trim() === '')
    if (allEmpty) {
      errors.push({ row: excelRow, name: '', reason: 'empty_row' })
      continue
    }
    if (!nameRaw || isNonStudentRosterName(nameRaw)) {
      errors.push({ row: excelRow, name: nameRaw, reason: 'missing_name' })
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
      examNumber: examNumber || patch.examNumber,
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
  const sheets = readExcelSheets(filePath)
  if (sheets.length === 0) {
    throw new Error('Excel 文件中没有工作表')
  }
  return sheets[0].matrix
}

export interface ExcelSheetMatrix {
  name: string
  matrix: unknown[][]
}

/**
 * 读取全部工作表为矩阵（空表也返回，供导入端决定跳过）。
 * csv 是文本: 先按 GBK 兜底解码再按字符串读 — SheetJS 对字节输入默认
 * 按 cp1252 读 csv,中文(utf8 或 ANSI)会乱码成非法姓名。
 */
export function readExcelSheets(filePath: string): ExcelSheetMatrix[] {
  const isCsv = path.extname(filePath).toLowerCase() === '.csv'
  const workbook = isCsv
    ? XLSX.read(decodeTextBuffer(readFileSync(filePath)), { type: 'string' })
    : XLSX.readFile(filePath)
  if (workbook.SheetNames.length === 0) {
    throw new Error('Excel 文件中没有工作表')
  }
  return workbook.SheetNames.map((name) => {
    const worksheet = workbook.Sheets[name]
    const matrix = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      blankrows: true,
      raw: false,
    }) as unknown[][]
    return { name, matrix }
  })
}

function sheetHasAnyCell(matrix: unknown[][]): boolean {
  return matrix.some((row) =>
    (row ?? []).some((c) => c !== null && c !== undefined && String(c).trim() !== ''),
  )
}

/**
 * 合并所有含姓名表头的工作表（寄宿/走读分表常见）。
 * 空表跳过；所有非空表都找不到表头则失败。
 */
export function parseStudentImportSheets(
  sheets: ExcelSheetMatrix[],
  existingNames: ReadonlySet<string>,
  classIndex: ReadonlyMap<string, string>,
  options: ParseStudentImportOptions = {},
): StudentImportPreview & { sheets_used: string[] } {
  const empty: StudentImportPreview & { sheets_used: string[] } = {
    success: false,
    rows: [],
    errors: [],
    totalRows: 0,
    sheets_used: [],
  }
  const nonEmpty = sheets.filter((s) => sheetHasAnyCell(s.matrix))
  if (nonEmpty.length === 0) {
    return { ...empty, error: 'Excel 文件中没有工作表数据' }
  }

  const seen = new Set<string>()
  const rows: StudentImportRow[] = []
  const errors: StudentImportRowError[] = []
  const sheetsUsed: string[] = []
  const headerFails: string[] = []
  let totalRows = 0

  for (const sheet of nonEmpty) {
    const preview = parseStudentImportMatrix(sheet.matrix, existingNames, classIndex, {
      ...options,
      sheetLabel: sheet.name,
      alreadySeenNames: seen,
    })
    if (!preview.success) {
      headerFails.push(preview.error || `${sheet.name}: 无法解析`)
      continue
    }
    sheetsUsed.push(sheet.name)
    totalRows += preview.totalRows
    for (const row of preview.rows) {
      seen.add(row.name)
      rows.push(row)
    }
    errors.push(...preview.errors)
  }

  if (sheetsUsed.length === 0) {
    return {
      ...empty,
      error:
        headerFails.join('\n') ||
        formatMissingRosterHeaderError(nonEmpty[0]?.matrix ?? [], nonEmpty[0]?.name),
    }
  }

  return { success: true, rows, errors, totalRows, sheets_used: sheetsUsed }
}
