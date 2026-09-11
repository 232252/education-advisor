// =============================================================
// 成绩表解析 + 与花名册对号（纯函数，主进程 / 测试共用）
// 考号经常不等于学号：姓名唯一命中即可录入；对不上的行进 unmatched，禁止编学生。
// =============================================================

import { DEFAULT_SUBJECTS } from './academic-defaults'
import { ROSTER_HEADER_SCAN_ROWS } from './roster-profile'

function normalizeHeader(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '')
}

const NAME_ALIASES = new Set(
  ['name', '姓名', '学生姓名', '学生', '名字', '学员姓名', '考生姓名', '姓名（必填）'].map(
    normalizeHeader,
  ),
)
const STUDENT_ID_ALIASES = new Set(
  ['student_id', 'studentid', '学号', '学籍号', '学籍编号', '学生学号', '学籍'].map(
    normalizeHeader,
  ),
)
const EXAM_NO_ALIASES = new Set(
  ['exam_number', 'examnumber', 'exam_no', '考号', '考生号', '准考证号', '考试号'].map(
    normalizeHeader,
  ),
)

const SKIP_SCORE_HEADERS =
  /^(总分|合计|总分成绩|总成绩|排名|班级排名|年级排名|名次|备注|说明|序号|编号|缺考)$/

const GENERIC_SCORE_HEADERS = new Set(
  ['分数', '成绩', '得分', 'score', 'grade'].map(normalizeHeader),
)

const SUBJECT_INDEX = new Map<string, string>()
for (const s of DEFAULT_SUBJECTS) {
  SUBJECT_INDEX.set(normalizeHeader(s.id), s.id)
  SUBJECT_INDEX.set(normalizeHeader(s.name), s.id)
  SUBJECT_INDEX.set(normalizeHeader(`${s.name}成绩`), s.id)
  SUBJECT_INDEX.set(normalizeHeader(`${s.name}分数`), s.id)
  SUBJECT_INDEX.set(normalizeHeader(`${s.name}得分`), s.id)
}
SUBJECT_INDEX.set(normalizeHeader('外语'), 'english')
SUBJECT_INDEX.set(normalizeHeader('外语成绩'), 'english')

export interface GradeSheetHeader {
  rowIndex: number
  nameCol: number
  studentIdCol: number
  examNumberCol: number
  /** 科目列：subjectId → 列下标。genericScoreCol 单科分数列另存 */
  subjectCols: Record<string, number>
  genericScoreCol: number
}

export interface GradeSheetRow {
  row: number
  name: string
  studentNumber: string
  examNumber: string
  scores: Record<string, number | null>
}

export interface GradeRosterStudent {
  name: string
  studentNumber?: string
  examNumber?: string
}

export interface GradeMatchResult {
  row: number
  name: string
  examNumber: string
  studentNumber: string
  matchedName: string | null
  matchedBy: 'name' | 'student_number' | 'exam_number' | null
  scores: Record<string, number | null>
  warnings: string[]
  unmatchedReason?: string
}

function cellText(cells: unknown[], col: number): string {
  if (col < 0) return ''
  const v = cells[col]
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function isNameHeader(n: string): boolean {
  if (NAME_ALIASES.has(n)) return true
  return (n.endsWith('姓名') || n === '名字') && !/家长|父亲|母亲|监护人|妈妈|爸爸/.test(n)
}

function isStudentIdHeader(n: string): boolean {
  if (STUDENT_ID_ALIASES.has(n)) return true
  return (n.includes('学号') || n.includes('学籍')) && !n.includes('考号')
}

function isExamNoHeader(n: string): boolean {
  if (EXAM_NO_ALIASES.has(n)) return true
  return n.includes('考号') || n.includes('准考证')
}

function subjectIdForHeader(raw: unknown): string | null {
  const n = normalizeHeader(raw)
  if (!n || SKIP_SCORE_HEADERS.test(n)) return null
  return SUBJECT_INDEX.get(n) ?? null
}

function isGenericScoreHeader(raw: unknown): boolean {
  return GENERIC_SCORE_HEADERS.has(normalizeHeader(raw))
}

/** 该行是否像成绩表头：有姓名列，且有科目列或「分数/成绩」列 */
export function resolveGradeSheetHeaders(
  headerRow: unknown[],
): Omit<GradeSheetHeader, 'rowIndex'> | null {
  let nameCol = -1
  let studentIdCol = -1
  let examNumberCol = -1
  let genericScoreCol = -1
  const subjectCols: Record<string, number> = {}

  headerRow.forEach((cell, col) => {
    const n = normalizeHeader(cell)
    if (!n) return
    if (nameCol === -1 && isNameHeader(n)) {
      nameCol = col
      return
    }
    if (studentIdCol === -1 && isStudentIdHeader(n)) {
      studentIdCol = col
      return
    }
    if (examNumberCol === -1 && isExamNoHeader(n)) {
      examNumberCol = col
      return
    }
    const sid = subjectIdForHeader(cell)
    if (sid && subjectCols[sid] === undefined) {
      subjectCols[sid] = col
      return
    }
    if (genericScoreCol === -1 && isGenericScoreHeader(cell)) {
      genericScoreCol = col
    }
  })

  if (nameCol === -1) return null
  if (Object.keys(subjectCols).length === 0 && genericScoreCol === -1) return null
  return { nameCol, studentIdCol, examNumberCol, subjectCols, genericScoreCol }
}

export function findGradeSheetHeaderRow(
  matrix: unknown[][],
  scanRows = ROSTER_HEADER_SCAN_ROWS,
): GradeSheetHeader | null {
  const limit = Math.min(matrix.length, scanRows)
  for (let i = 0; i < limit; i++) {
    const resolved = resolveGradeSheetHeaders(matrix[i] ?? [])
    if (resolved) return { rowIndex: i, ...resolved }
  }
  return null
}

function parseScoreCell(raw: unknown): number | null | undefined {
  if (raw === null || raw === undefined) return null
  const t = String(raw).trim()
  if (!t || t === '-' || t === '/' || t === '—' || /^(缺|缺考|请假|免考)$/.test(t)) return null
  const n = Number(t.replace(/,/g, ''))
  if (!Number.isFinite(n)) return undefined
  return n
}

export interface ParseGradeSheetOptions {
  /** 表头只有「分数」没有科目名时，用这个科目 ID */
  genericSubjectId?: string
}

export function parseGradeSheetMatrix(
  matrix: unknown[][],
  options: ParseGradeSheetOptions = {},
): { header: GradeSheetHeader; rows: GradeSheetRow[]; errors: string[] } {
  const header = findGradeSheetHeaderRow(matrix)
  if (!header) {
    throw new Error(
      '未找到成绩表头（需要「姓名」列，以及语文/数学等科目列或「分数/成绩」列）。' +
        '禁止把成绩表当花名册导入，也禁止从对话抄姓名编成绩。',
    )
  }
  const errors: string[] = []
  const subjectEntries = Object.entries(header.subjectCols)
  if (subjectEntries.length === 0) {
    if (!options.genericSubjectId) {
      throw new Error(
        '成绩表只有「分数/成绩」列、没有语文/数学等科目名。请在 eaa_import_grades 传入 subject_id（如 math）。',
      )
    }
  }

  const rows: GradeSheetRow[] = []
  for (let i = header.rowIndex + 1; i < matrix.length; i++) {
    const cells = matrix[i] ?? []
    const excelRow = i + 1
    const name = cellText(cells, header.nameCol)
    const studentNumber = cellText(cells, header.studentIdCol)
    const examNumber = cellText(cells, header.examNumberCol)
    const allEmpty = cells.every((c) => c === null || c === undefined || String(c).trim() === '')
    if (allEmpty) continue
    if (!name && !studentNumber && !examNumber) {
      errors.push(`第${excelRow}行：缺姓名且无学号/考号，已跳过`)
      continue
    }
    if (!name) {
      errors.push(`第${excelRow}行：无姓名，将尝试用学号/考号对花名册（对不上则跳过，不新建学生）`)
    }
    const scores: Record<string, number | null> = {}
    for (const [sid, col] of subjectEntries) {
      const parsed = parseScoreCell(cells[col])
      if (parsed === undefined) {
        errors.push(`第${excelRow}行 ${name}：科目 ${sid} 不是数字，已跳过该科`)
        continue
      }
      scores[sid] = parsed
    }
    if (subjectEntries.length === 0 && header.genericScoreCol >= 0 && options.genericSubjectId) {
      const parsed = parseScoreCell(cells[header.genericScoreCol])
      if (parsed === undefined) {
        errors.push(`第${excelRow}行 ${name}：分数不是数字，已跳过`)
        continue
      }
      scores[options.genericSubjectId] = parsed
    }
    if (Object.keys(scores).length === 0) {
      errors.push(`第${excelRow}行 ${name}：没有可导入的分数`)
      continue
    }
    rows.push({ row: excelRow, name, studentNumber, examNumber, scores })
  }
  return { header, rows, errors }
}

function compactId(raw: string): string {
  return raw.replace(/\s+/g, '').toLowerCase()
}

/**
 * 成绩行对花名册：姓名唯一命中优先（即使考号≠学号）；
 * 否则学号、再否则考号（对花名册学号或考号）。对不上 → unmatched，不编学生。
 */
export function matchGradeRowsToRoster(
  rows: GradeSheetRow[],
  roster: GradeRosterStudent[],
): { matched: GradeMatchResult[]; unmatched: GradeMatchResult[] } {
  const byName = new Map<string, GradeRosterStudent[]>()
  const byStudentNo = new Map<string, GradeRosterStudent[]>()
  const byExamNo = new Map<string, GradeRosterStudent[]>()
  for (const s of roster) {
    const nameKey = s.name.trim()
    if (nameKey) {
      const list = byName.get(nameKey) ?? []
      list.push(s)
      byName.set(nameKey, list)
    }
    const sn = compactId(s.studentNumber ?? '')
    if (sn) {
      const list = byStudentNo.get(sn) ?? []
      list.push(s)
      byStudentNo.set(sn, list)
    }
    const en = compactId(s.examNumber ?? '')
    if (en) {
      const list = byExamNo.get(en) ?? []
      list.push(s)
      byExamNo.set(en, list)
    }
  }

  const unique = (list: GradeRosterStudent[] | undefined): GradeRosterStudent | null =>
    list && list.length === 1 ? (list[0] ?? null) : null

  const matched: GradeMatchResult[] = []
  const unmatched: GradeMatchResult[] = []

  for (const row of rows) {
    const warnings: string[] = []
    let hit: GradeRosterStudent | null = unique(byName.get(row.name.trim()))
    let matchedBy: GradeMatchResult['matchedBy'] = hit ? 'name' : null

    if (!hit && row.studentNumber) {
      hit = unique(byStudentNo.get(compactId(row.studentNumber)))
      if (hit) matchedBy = 'student_number'
    }
    if (!hit && row.examNumber) {
      const examKey = compactId(row.examNumber)
      hit = unique(byExamNo.get(examKey)) ?? unique(byStudentNo.get(examKey))
      if (hit) matchedBy = 'exam_number'
    }

    if (hit && row.examNumber) {
      const examKey = compactId(row.examNumber)
      const rosterNos = [
        compactId(hit.studentNumber ?? ''),
        compactId(hit.examNumber ?? ''),
      ].filter((x) => x.length > 0)
      if (rosterNos.length > 0 && !rosterNos.includes(examKey)) {
        warnings.push(
          `考号 ${row.examNumber} 与档案学号/考号不一致（已按${matchedBy === 'name' ? '姓名' : '编号'}匹配，未新建学生）`,
        )
      }
    }

    const result: GradeMatchResult = {
      row: row.row,
      name: row.name,
      examNumber: row.examNumber,
      studentNumber: row.studentNumber,
      matchedName: hit?.name ?? null,
      matchedBy,
      scores: row.scores,
      warnings,
      unmatchedReason: hit
        ? undefined
        : row.name
          ? '花名册无此姓名，且学号/考号对不上。禁止新建学生，请教师核对该行。'
          : '缺姓名且编号对不上',
    }
    if (hit) matched.push(result)
    else unmatched.push(result)
  }
  return { matched, unmatched }
}
