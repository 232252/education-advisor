// =============================================================
// 花名册表头别名 + 行 → 档案补丁（纯函数，主进程 / 测试共用）
// 中文学校花名册常见列：姓名 / 身份证号 / 电话 / 家庭住址 …
// =============================================================

import type { StudentProfileData } from './types/academics'
import { isCorruptedIdCardCell, parseChineseIdCard } from './id-card'

/** 模板表头（中文，教师下载模板即用） */
export const ROSTER_TEMPLATE_HEADERS = [
  '姓名',
  '学号',
  '班级',
  '身份证号',
  '性别',
  '电话',
  '家庭住址',
] as const

const HEADER_ALIASES: Record<string, string[]> = {
  name: ['name', '姓名', '学生姓名', '学生', '名字', '学员姓名', '姓名（必填）'],
  studentId: ['student_id', 'studentid', '学号', '学籍号', '学籍编号', '学生学号', '学籍'],
  examNumber: ['exam_number', 'examnumber', 'exam_no', '考号', '考生号', '准考证号', '考试号'],
  className: [
    'class_name',
    'class',
    'classname',
    '班级',
    '班级名称',
    '班级名',
    '就读班级',
    '学生班级',
    '所在班级',
    '班级（必填）',
  ],
  idCard: ['id_card', 'idcard', '身份证号', '身份证', '身份证号码', '证件号', '证件号码'],
  gender: ['gender', 'sex', '性别'],
  birthDate: ['birth_date', 'birthdate', 'birthday', '出生日期', '生日', '出生年月'],
  phone: [
    'phone',
    'mobile',
    'tel',
    '电话',
    '手机',
    '手机号',
    '联系电话',
    '学生电话',
    '家长电话',
    '家长联系电话',
  ],
  address: ['address', '家庭住址', '家庭地址', '住址', '地址', '通讯地址'],
  email: ['email', 'e-mail', '邮箱', '电子邮箱'],
  fatherName: ['father_name', 'fathername', '父亲姓名', '父亲', '爸爸', '家长姓名', '家长', '监护人', '监护人姓名'],
  fatherPhone: ['father_phone', 'fatherphone', '父亲电话', '父亲手机', '爸爸电话'],
  motherName: ['mother_name', 'mothername', '母亲姓名', '母亲', '妈妈'],
  motherPhone: ['mother_phone', 'motherphone', '母亲电话', '母亲手机', '妈妈电话'],
  enrollmentDate: ['enrollment_date', 'enrollmentdate', '入学日期', '入学时间'],
  dormNumber: ['dorm_number', 'dorm', '宿舍号', '宿舍'],
}

export type RosterHeaderKey = keyof typeof HEADER_ALIASES

export type RosterHeaderIndexes = Record<RosterHeaderKey, number>

const HEADER_KEYS = Object.keys(HEADER_ALIASES) as RosterHeaderKey[]

function normalizeHeader(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-]/g, '')
}

const ALIAS_INDEX = new Map<string, RosterHeaderKey>()
for (const key of HEADER_KEYS) {
  for (const alias of HEADER_ALIASES[key]) {
    ALIAS_INDEX.set(normalizeHeader(alias), key)
  }
}

export function emptyHeaderIndexes(): RosterHeaderIndexes {
  const out = {} as RosterHeaderIndexes
  for (const key of HEADER_KEYS) out[key] = -1
  return out
}

function applyFuzzyHeader(indexes: RosterHeaderIndexes, headerRow: unknown[]): void {
  headerRow.forEach((cell, col) => {
    const n = normalizeHeader(cell)
    if (!n) return
    if (
      indexes.name === -1 &&
      (n.endsWith('姓名') || n === '名字') &&
      !/家长|父亲|母亲|监护人|妈妈|爸爸/.test(n)
    ) {
      indexes.name = col
      return
    }
    if (indexes.studentId === -1 && (n.includes('学号') || n.includes('学籍')) && !n.includes('考号')) {
      indexes.studentId = col
      return
    }
    if (indexes.examNumber === -1 && (n.includes('考号') || n.includes('准考证'))) {
      indexes.examNumber = col
      return
    }
    if (indexes.className === -1 && n.includes('班级') && !n.includes('班主任')) {
      indexes.className = col
    }
  })
}

/** 从表头行解析列索引；没有姓名列返回 null */
export function resolveRosterHeaders(headerRow: unknown[]): RosterHeaderIndexes | null {
  const indexes = emptyHeaderIndexes()
  headerRow.forEach((cell, col) => {
    const key = ALIAS_INDEX.get(normalizeHeader(cell))
    if (key && indexes[key] === -1) indexes[key] = col
  })
  applyFuzzyHeader(indexes, headerRow)
  if (indexes.name === -1) return null
  return indexes
}

export const ROSTER_HEADER_SCAN_ROWS = 15

/** 学校花名册常在第 1 行放合并标题，真正表头在后面。返回最先识别到姓名列的行。 */
export function findRosterHeaderRow(
  matrix: unknown[][],
  maxScan = ROSTER_HEADER_SCAN_ROWS,
): { indexes: RosterHeaderIndexes; rowIndex: number } | null {
  if (!Array.isArray(matrix) || matrix.length === 0) return null
  const limit = Math.min(Math.max(1, maxScan), matrix.length)
  for (let i = 0; i < limit; i++) {
    const indexes = resolveRosterHeaders(matrix[i] ?? [])
    if (indexes) return { indexes, rowIndex: i }
  }
  return null
}

/** 合计行 / 表头残片，不当学生导入 */
export function isNonStudentRosterName(name: string): boolean {
  const t = name.trim()
  if (!t) return true
  return /^(序号|编号|姓名|名字|学生姓名|合计|小计|总计|备注|性别|班级|就读班级|学生)$/.test(t)
}

export function previewMatrixRows(matrix: unknown[][], maxRows = 4, maxCols = 8): string {
  const lines: string[] = []
  const n = Math.min(maxRows, matrix.length)
  for (let i = 0; i < n; i++) {
    const cells = (matrix[i] ?? []).slice(0, maxCols).map((c) => {
      const s = String(c ?? '').replace(/\s+/g, ' ').trim()
      return s.length > 24 ? `${s.slice(0, 24)}…` : s || '(空)'
    })
    lines.push(`第${i + 1}行: ${cells.join(' | ') || '(空行)'}`)
  }
  return lines.join('\n')
}

export function formatMissingRosterHeaderError(matrix: unknown[][], sheetLabel?: string): string {
  const where = sheetLabel ? `工作表「${sheetLabel}」` : '该文件'
  const preview = previewMatrixRows(matrix)
  return (
    `${where}未找到姓名列表头（可识别：姓名 / 学生姓名 / name）。工具会自动跳过标题行与空行。` +
    (preview ? `\n前几行：\n${preview}` : '') +
    `\n禁止改用 students[] 从对话、其他班级或上一份文件抄名单。请把本错误告诉教师，或检查是否选错工作表。`
  )
}

/** 身份证 / 电话 / 住址 / 邮箱等列 — read_excel 对模型隐藏单元格，导入走 excel_path */
const PII_HEADER_RE =
  /身份证|证件号|电话|手机|住址|地址|id[_\s-]?card|phone|mobile|address|e-?mail|邮箱/i

export function isPiiRosterHeader(header: unknown): boolean {
  const h = String(header ?? '').trim()
  if (!h) return false
  return PII_HEADER_RE.test(h)
}

export interface RosterProfilePatch {
  studentNumber?: string
  examNumber?: string
  classId?: string
  idCard?: string
  gender?: '男' | '女' | string
  birthDate?: string
  phone?: string
  address?: string
  email?: string
  fatherName?: string
  fatherPhone?: string
  motherName?: string
  motherPhone?: string
  enrollmentDate?: string
  dormNumber?: string
}

function cellText(cells: unknown[], col: number): string {
  if (col < 0) return ''
  const v = cells[col]
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function genderFromCell(raw: string): '男' | '女' | undefined {
  const t = raw.trim()
  if (t === '男' || /^m(ale)?$/i.test(t)) return '男'
  if (t === '女' || /^f(emale)?$/i.test(t)) return '女'
  return undefined
}

/** 把一行花名册单元格收成档案补丁；身份证合法时覆盖性别与出生日期 */
export function rowToProfilePatch(
  cells: unknown[],
  header: RosterHeaderIndexes,
  classId?: string | null,
): RosterProfilePatch {
  const patch: RosterProfilePatch = {}
  const studentNumber = cellText(cells, header.studentId)
  const examNumber = cellText(cells, header.examNumber)
  const idCardRaw = cellText(cells, header.idCard)
  const genderRaw = cellText(cells, header.gender)
  const birthDate = cellText(cells, header.birthDate)
  const phone = cellText(cells, header.phone)
  const address = cellText(cells, header.address)
  const email = cellText(cells, header.email)
  const fatherName = cellText(cells, header.fatherName)
  const fatherPhone = cellText(cells, header.fatherPhone)
  const motherName = cellText(cells, header.motherName)
  const motherPhone = cellText(cells, header.motherPhone)
  const enrollmentDate = cellText(cells, header.enrollmentDate)
  const dormNumber = cellText(cells, header.dormNumber)

  if (studentNumber) patch.studentNumber = studentNumber
  if (examNumber) patch.examNumber = examNumber
  // 花名册只有考号没有学号时，考号写入学号字段，卷面仍能按编号命中
  if (!patch.studentNumber && examNumber) patch.studentNumber = examNumber
  if (phone) patch.phone = phone
  if (address) patch.address = address
  if (email) patch.email = email
  if (fatherName) patch.fatherName = fatherName
  if (fatherPhone) patch.fatherPhone = fatherPhone
  if (motherName) patch.motherName = motherName
  if (motherPhone) patch.motherPhone = motherPhone
  if (enrollmentDate) patch.enrollmentDate = enrollmentDate
  if (dormNumber) patch.dormNumber = dormNumber
  if (classId) patch.classId = classId

  const gender = genderFromCell(genderRaw)
  if (gender) patch.gender = gender
  if (birthDate) patch.birthDate = birthDate

  if (idCardRaw && !isCorruptedIdCardCell(idCardRaw)) {
    const parsed = parseChineseIdCard(idCardRaw)
    if (parsed) {
      patch.idCard = parsed.idCard
      patch.gender = parsed.gender
      patch.birthDate = parsed.birthDate
    } else {
      patch.idCard = idCardRaw
    }
  }

  return patch
}

export function profilePatchHasFields(patch: RosterProfilePatch): boolean {
  return Object.values(patch).some((v) => typeof v === 'string' && v.trim().length > 0)
}

export function toStudentProfileData(patch: RosterProfilePatch): StudentProfileData {
  const data: StudentProfileData = {}
  if (patch.studentNumber) data.studentNumber = patch.studentNumber
  if (patch.examNumber) data.examNumber = patch.examNumber
  if (patch.classId) data.classId = patch.classId
  if (patch.idCard) data.idCard = patch.idCard
  if (patch.gender === '男' || patch.gender === '女') data.gender = patch.gender
  if (patch.birthDate) data.birthDate = patch.birthDate
  if (patch.phone) data.phone = patch.phone
  if (patch.address) data.address = patch.address
  if (patch.email) data.email = patch.email
  if (patch.fatherName) data.fatherName = patch.fatherName
  if (patch.fatherPhone) data.fatherPhone = patch.fatherPhone
  if (patch.motherName) data.motherName = patch.motherName
  if (patch.motherPhone) data.motherPhone = patch.motherPhone
  if (patch.enrollmentDate) data.enrollmentDate = patch.enrollmentDate
  if (patch.dormNumber) data.dormNumber = patch.dormNumber
  return data
}

/** UI / Agent 传入的扁平字段 → 档案补丁（空串忽略） */
export function fieldsToProfilePatch(fields: {
  studentId?: string | null
  studentNumber?: string | null
  examNumber?: string | null
  classId?: string | null
  idCard?: string | null
  gender?: string | null
  birthDate?: string | null
  phone?: string | null
  address?: string | null
  email?: string | null
  fatherName?: string | null
  fatherPhone?: string | null
  motherName?: string | null
  motherPhone?: string | null
  enrollmentDate?: string | null
  dormNumber?: string | null
}): RosterProfilePatch {
  const pick = (v?: string | null): string => (typeof v === 'string' ? v.trim() : '')
  const cells: unknown[] = []
  const header = emptyHeaderIndexes()
  // 复用 rowToProfilePatch 的身份证解析：构造单列表
  const set = (key: RosterHeaderKey, value: string) => {
    if (!value) return
    header[key] = cells.length
    cells.push(value)
  }
  set('studentId', pick(fields.studentId) || pick(fields.studentNumber))
  set('examNumber', pick(fields.examNumber))
  set('idCard', pick(fields.idCard))
  set('gender', pick(fields.gender))
  set('birthDate', pick(fields.birthDate))
  set('phone', pick(fields.phone))
  set('address', pick(fields.address))
  set('email', pick(fields.email))
  set('fatherName', pick(fields.fatherName))
  set('fatherPhone', pick(fields.fatherPhone))
  set('motherName', pick(fields.motherName))
  set('motherPhone', pick(fields.motherPhone))
  set('enrollmentDate', pick(fields.enrollmentDate))
  set('dormNumber', pick(fields.dormNumber))
  return rowToProfilePatch(cells, header, pick(fields.classId) || null)
}

export function collectPrivacyTexts(name: string, patch: RosterProfilePatch): Array<{
  entityType: 'person' | 'id_card' | 'phone' | 'place' | 'email' | 'student_id'
  text: string
}> {
  const out: Array<{
    entityType: 'person' | 'id_card' | 'phone' | 'place' | 'email' | 'student_id'
    text: string
  }> = []
  if (name.trim()) out.push({ entityType: 'person', text: name.trim() })
  if (patch.idCard) out.push({ entityType: 'id_card', text: patch.idCard })
  if (patch.studentNumber) out.push({ entityType: 'student_id', text: patch.studentNumber })
  if (patch.examNumber && patch.examNumber !== patch.studentNumber) {
    out.push({ entityType: 'student_id', text: patch.examNumber })
  }
  if (patch.phone) out.push({ entityType: 'phone', text: patch.phone })
  if (patch.fatherPhone) out.push({ entityType: 'phone', text: patch.fatherPhone })
  if (patch.motherPhone) out.push({ entityType: 'phone', text: patch.motherPhone })
  if (patch.address) out.push({ entityType: 'place', text: patch.address })
  if (patch.email) out.push({ entityType: 'email', text: patch.email })
  return out
}
