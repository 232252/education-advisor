// =============================================================
// EAA Tools — 成绩表导入（excel_path → 建考试 + 按花名册对号写入）
// 考号≠学号时按姓名匹配；对不上的行进 unmatched，禁止编学生。
// =============================================================

import type { AgentTool } from '@earendil-works/pi-agent-core'
import { DEFAULT_EXAM_TYPES } from '@shared/academic-defaults'
import {
  type GradeRosterStudent,
  matchGradeRowsToRoster,
  parseGradeSheetMatrix,
} from '@shared/grade-sheet'
import type { ExamType } from '@shared/types'
import { Type } from 'typebox'
import { readExcelSheets, validateExcelFilePath } from '../../../ipc/students/excel-import'
import { sanitizeClassId } from '../../../utils/sanitize'
import { academicService } from '../../academic-service'
import { classService } from '../../class-service'
import { eaaBridge } from '../../eaa-bridge'
import { profileService } from '../../profile-service'
import { jsonResult, textResult } from './shared'

const EXAM_TYPES = new Set<ExamType>(DEFAULT_EXAM_TYPES.map((t) => t.value))

const importGradesParams = Type.Object({
  excel_path: Type.String({
    description:
      '成绩表 Excel 的绝对路径。必须传文件路径，禁止把分数抄进对话或编学生。自动跳过标题行，识别姓名/学号/考号与语文数学等科目列。',
  }),
  class_id: Type.String({
    description: '对号用的班级编号，如 G12-5。只在该班花名册里匹配，对不上的行不会新建学生。',
  }),
  exam_name: Type.String({ description: '考试名称，如「2026春第一次月考」' }),
  exam_date: Type.Optional(Type.String({ description: '考试日期 YYYY-MM-DD；不填用今天' })),
  semester: Type.Optional(Type.String({ description: '学期，如 2025-2026-2；不填按当前月份推断' })),
  exam_type: Type.Optional(
    Type.String({
      description: '考试类型：monthly/midterm/final/quiz/test/mock/other，或中文月考/期中/期末等',
    }),
  ),
  subject_id: Type.Optional(
    Type.String({
      description: '表头只有「分数」没有科目名时必填，如 math / chinese',
    }),
  ),
  dry_run: Type.Optional(
    Type.Boolean({
      description: '只解析对号、不写入。表头或考号吃不准时先用这个给教师核对。',
    }),
  ),
  sheet: Type.Optional(Type.String({ description: '工作表名；不填则用第一张有成绩表头的表' })),
})

function currentSemester(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const semester = month >= 9 || month <= 2 ? 1 : 2
  const startYear = month >= 9 ? year : year - 1
  return `${startYear}-${startYear + 1}-${semester}`
}

function todayIsoDate(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function parseExamType(raw?: string): ExamType {
  const t = (raw ?? '').trim()
  if (EXAM_TYPES.has(t as ExamType)) return t as ExamType
  const hit = DEFAULT_EXAM_TYPES.find(
    (x) => x.label === t || t.includes(x.label.replace('考试', '')),
  )
  return hit?.value ?? 'other'
}

async function loadClassRoster(classId: string): Promise<GradeRosterStudent[]> {
  const result = await eaaBridge.execute<{
    students?: Array<{ name?: string; class_id?: string | null }>
  }>({ command: 'list-students', args: [] })
  if (!result.success) {
    throw new Error(`读取花名册失败: ${result.stderr || '未知错误'}`)
  }
  const list = Array.isArray(result.data?.students) ? result.data.students : []
  const names = list.flatMap((s) => {
    const name = typeof s?.name === 'string' ? s.name.trim() : ''
    if (!name || (s.class_id ?? '') !== classId) return []
    return [name]
  })
  const roster: GradeRosterStudent[] = []
  for (const name of names) {
    const profile = await profileService.get(name)
    roster.push({
      name,
      studentNumber: typeof profile.studentNumber === 'string' ? profile.studentNumber : undefined,
      examNumber: typeof profile.examNumber === 'string' ? profile.examNumber : undefined,
    })
  }
  return roster
}

export const importGradesTool: AgentTool<typeof importGradesParams> = {
  name: 'eaa_import_grades',
  label: '导入成绩表',
  description:
    '把成绩 Excel 导入指定班级：按花名册对号（姓名优先；考号经常不等于学号，对不上也不要新建学生）。' +
    '必须传 excel_path + class_id + exam_name。不确定时先 dry_run:true 把 unmatched 给教师核对。' +
    '禁止把分数抄进对话，禁止用 eaa_import_students 导成绩表。',
  parameters: importGradesParams,
  execute: async (_toolCallId, params, signal) => {
    if (signal?.aborted) return textResult('已取消')
    const classId = sanitizeClassId(params.class_id)
    const classes = classService.list()
    if (!classes.some((c) => c.class_id === classId)) {
      throw new Error(`班级不存在: ${classId}。请先 eaa_list_classes，没有则 eaa_create_class`)
    }
    const validated = validateExcelFilePath(params.excel_path)
    if (!validated.ok) throw new Error(validated.error)

    const sheets = readExcelSheets(params.excel_path)
    const wanted = params.sheet?.trim()
    const targets = wanted ? sheets.filter((s) => s.name === wanted) : sheets
    if (wanted && targets.length === 0) {
      throw new Error(`工作表不存在: ${wanted}。可用: ${sheets.map((s) => s.name).join(', ')}`)
    }

    let parsed: ReturnType<typeof parseGradeSheetMatrix> | null = null
    let sheetUsed = ''
    const headerErrors: string[] = []
    for (const sheet of targets) {
      try {
        parsed = parseGradeSheetMatrix(sheet.matrix, { genericSubjectId: params.subject_id })
        sheetUsed = sheet.name
        break
      } catch (err) {
        headerErrors.push(`${sheet.name}: ${(err as Error).message}`)
      }
    }
    if (!parsed) {
      throw new Error(
        headerErrors.join('\n') ||
          '未识别到成绩表。需要姓名列 + 科目列（语文/数学…）或分数列。禁止改用 students[] 或编成绩。',
      )
    }

    const roster = await loadClassRoster(classId)
    if (roster.length === 0) {
      throw new Error(
        `${classId} 花名册为空。请先用 eaa_import_students 导入该班学生，再导成绩。禁止把成绩表里的姓名新建成学生。`,
      )
    }
    const { matched, unmatched } = matchGradeRowsToRoster(parsed.rows, roster)
    const subjectIds = [...new Set(matched.flatMap((r) => Object.keys(r.scores)))]
    const warnings = [...parsed.errors, ...matched.flatMap((r) => r.warnings)]

    const preview = {
      class_id: classId,
      sheet: sheetUsed,
      exam_name: params.exam_name.trim(),
      matched: matched.length,
      unmatched: unmatched.length,
      unmatched_rows: unmatched.map((r) => ({
        row: r.row,
        name: r.name,
        exam_number: r.examNumber || undefined,
        student_number: r.studentNumber || undefined,
        reason: r.unmatchedReason,
      })),
      warnings: warnings.length > 0 ? warnings : undefined,
      subjects: subjectIds,
      hint:
        unmatched.length > 0
          ? '有对不上的行：考号可能与学号不同。已按姓名匹配的仍会导入；unmatched 不会新建学生。把这几行交给教师核对。'
          : '全部按花名册对上（姓名优先）。考号与学号不一致时仍按姓名写入，不会新建学生。',
    }

    if (params.dry_run) {
      return jsonResult(
        { dry_run: true, ...preview },
        `预览：对上 ${matched.length} 人，未对上 ${unmatched.length} 人`,
      )
    }
    if (matched.length === 0) {
      throw new Error(
        `没有一行能对上 ${classId} 花名册。未写入。请核对班级、姓名是否与 eaa_list_students({ class_id: "${classId}" }) 一致。`,
      )
    }

    const config = await academicService.getConfig()
    const fullMarkBySubject = new Map(config.subjects.map((s) => [s.id, s.fullMark] as const))
    const exam = await academicService.createExam({
      name: params.exam_name.trim(),
      type: parseExamType(params.exam_type),
      date: params.exam_date?.trim() || todayIsoDate(),
      semester: params.semester?.trim() || currentSemester(),
      scope: classId,
      // 班级落库:学业页按生过滤"非本班考试"
      classId,
      subjects: subjectIds,
    })

    const records: Array<{
      examId: string
      subjectId: string
      studentName: string
      score: number | null
      fullMark: number
    }> = []
    for (const row of matched) {
      for (const [subjectId, score] of Object.entries(row.scores)) {
        records.push({
          examId: exam.id,
          subjectId,
          studentName: row.matchedName ?? row.name,
          score,
          fullMark: fullMarkBySubject.get(subjectId) ?? 100,
        })
      }
    }
    const written = await academicService.batchSetGrades(records)
    return jsonResult(
      {
        dry_run: false,
        exam_id: exam.id,
        written,
        ...preview,
      },
      `已导入 ${matched.length} 人、${written} 条成绩到「${exam.name}」；未对上 ${unmatched.length} 人`,
    )
  },
}
