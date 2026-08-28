// =============================================================
// EAA Tools — 考试成绩查询类工具(exams / exam_grades / student_grades)
//
// 学业数据(.eaa-data/academics/,学业页录入)不走 Rust CLI,
// 经 academic-service 直读;只读工具,补齐「AI 知道考试成绩」的数据面
// (此前 academic 简历讲成绩分析,但任何 agent 工具都查不到考试数据)。
// 隐私:与其他 eaa_* 工具同管道 — privacyGuard.wrapTool 对入参化名→真名、
// 结果真名→化名,本文件无需自行处理化名。
// =============================================================

import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { ExamDef, GradeRecord } from '@shared/types'
import { Type } from 'typebox'
import { academicService } from '../../academic-service'
import { jsonResult } from './shared'

// =============================================================
// Schema 定义
// =============================================================

const examsParams = Type.Object({
  semester: Type.Optional(Type.String({ description: '按学期过滤(如 2026春);不填列出全部考试' })),
})

const examGradesParams = Type.Object({
  exam_id: Type.String({ description: '考试 ID(eaa_exams 返回的 id)' }),
  subject_id: Type.Optional(
    Type.String({ description: '科目 ID(如 chinese/math);不填返回该考试全部科目' }),
  ),
  student: Type.Optional(Type.String({ description: '只看该学生的成绩;不填返回全班' })),
})

const studentGradesParams = Type.Object({
  name: Type.String({ description: '学生姓名' }),
  semester: Type.Optional(Type.String({ description: '按学期过滤;不填返回全部' })),
})

// =============================================================
// 辅助: 科目元数据解析 + 成绩视图
// =============================================================

interface SubjectMeta {
  id: string
  name: string
  fullMark: number
}

const EMPTY_EXAMS_HINT =
  '尚无考试记录。请教师在应用「学业」页创建考试并录入成绩后,再通过 eaa_exams 查询。'

async function subjectMetaMap(): Promise<Map<string, SubjectMeta>> {
  const config = await academicService.getConfig()
  return new Map(
    config.subjects.map((s) => [s.id, { id: s.id, name: s.name, fullMark: s.fullMark }]),
  )
}

function examView(exam: ExamDef, subjects: Map<string, SubjectMeta>) {
  return {
    id: exam.id,
    name: exam.name,
    type: exam.type,
    date: exam.date,
    semester: exam.semester,
    scope: exam.scope,
    subjects: exam.subjects.map((id) => subjects.get(id) ?? { id, name: id, fullMark: 0 }),
  }
}

function gradeView(g: GradeRecord, exam: ExamDef | undefined, subjects: Map<string, SubjectMeta>) {
  const meta = subjects.get(g.subjectId)
  return {
    exam: exam ? `${exam.name}(${exam.date})` : g.examId,
    exam_id: g.examId,
    date: exam?.date ?? '',
    semester: exam?.semester ?? '',
    subject_id: g.subjectId,
    subject: meta?.name ?? g.subjectId,
    score: g.score,
    full_mark: g.fullMark ?? meta?.fullMark ?? 0,
    class_rank: g.classRank ?? null,
  }
}

/** 全班成绩 → 每科统计 + 学生得分表(score=null 缺考,未出现=未录)。
 *  subjectFilter 存在时只统计该科(byStudent 已在 service 层过滤)。 */
function classGradesView(
  byStudent: Record<string, GradeRecord[]>,
  exam: ExamDef,
  subjects: Map<string, SubjectMeta>,
  subjectFilter?: string,
) {
  const subjectIds = subjectFilter
    ? [subjectFilter]
    : exam.subjects.length > 0
      ? exam.subjects
      : Object.keys(subjects)
  const perSubject: Record<string, unknown> = {}
  for (const sid of subjectIds) {
    const scores: number[] = []
    let absent = 0
    for (const records of Object.values(byStudent)) {
      const rec = records.find((g) => g.subjectId === sid)
      if (!rec) continue
      if (rec.score === null) absent++
      else scores.push(rec.score)
    }
    const meta = subjects.get(sid)
    perSubject[sid] = {
      subject: meta?.name ?? sid,
      full_mark: meta?.fullMark ?? 0,
      entered: scores.length + absent,
      absent,
      avg:
        scores.length > 0
          ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1))
          : null,
      max: scores.length > 0 ? Math.max(...scores) : null,
      min: scores.length > 0 ? Math.min(...scores) : null,
    }
  }
  const students = Object.entries(byStudent).map(([name, records]) => ({
    name,
    scores: Object.fromEntries(records.map((g) => [g.subjectId, g.score])),
  }))
  return { per_subject: perSubject, students }
}

// =============================================================
// 1. 考试列表(含科目与满分)
// =============================================================
export const examsTool: AgentTool<typeof examsParams> = {
  name: 'eaa_exams',
  label: '考试列表',
  description:
    '列出已录入的考试(名称/类型/日期/学期/科目与满分)。查成绩前先调本工具拿考试 ID;数据由教师在「学业」页录入',
  parameters: examsParams,
  execute: async (_toolCallId, params) => {
    const [exams, subjects] = await Promise.all([academicService.listExams(), subjectMetaMap()])
    const filtered = params.semester ? exams.filter((e) => e.semester === params.semester) : exams
    if (filtered.length === 0) {
      return jsonResult(
        { exams: [], hint: EMPTY_EXAMS_HINT },
        params.semester ? `学期 ${params.semester} 无考试` : '无考试记录',
      )
    }
    return jsonResult(
      { exams: filtered.map((e) => examView(e, subjects)) },
      `${filtered.length} 场考试`,
    )
  },
}

// =============================================================
// 2. 一场考试的成绩(单生或全班)
// =============================================================
export const examGradesTool: AgentTool<typeof examGradesParams> = {
  name: 'eaa_exam_grades',
  label: '考试成绩查询',
  description:
    '查询一场考试的成绩:不填 student 返回全班(每科统计+学生得分表),填 student 只返回该生。缺考记 null;未出现的科目=未录入',
  parameters: examGradesParams,
  execute: async (_toolCallId, params) => {
    const [exams, subjects] = await Promise.all([academicService.listExams(), subjectMetaMap()])
    const exam = exams.find((e) => e.id === params.exam_id)
    if (!exam) {
      throw new Error(`考试不存在: ${params.exam_id}。请先调用 eaa_exams 获取有效考试 ID`)
    }

    if (params.student) {
      const records = (await academicService.getGrades(params.student))
        .filter((g) => g.examId === params.exam_id)
        .filter((g) => !params.subject_id || g.subjectId === params.subject_id)
      return jsonResult(
        {
          exam: examView(exam, subjects),
          grades: records.map((g) => gradeView(g, exam, subjects)),
        },
        `${params.student} 在 ${exam.name} 的成绩`,
      )
    }

    const byStudent = await academicService.getExamGrades(params.exam_id, params.subject_id)
    return jsonResult(
      {
        exam: examView(exam, subjects),
        ...classGradesView(byStudent, exam, subjects, params.subject_id),
      },
      `${exam.name} 全班成绩`,
    )
  },
}

// =============================================================
// 3. 单生全科成绩时间线
// =============================================================
export const studentGradesTool: AgentTool<typeof studentGradesParams> = {
  name: 'eaa_student_grades',
  label: '学生成绩时间线',
  description:
    '查询一个学生的全部考试成绩(按考试时间倒序,含科目/满分/排名)。判断该生学业趋势、进退步时使用',
  parameters: studentGradesParams,
  execute: async (_toolCallId, params) => {
    const [exams, subjects] = await Promise.all([academicService.listExams(), subjectMetaMap()])
    const examMap = new Map(exams.map((e) => [e.id, e]))
    let records = await academicService.getGrades(params.name)
    if (params.semester) {
      records = records.filter((g) => examMap.get(g.examId)?.semester === params.semester)
    }
    if (records.length === 0) {
      return jsonResult(
        {
          student: params.name,
          grades: [],
          hint: '该生无成绩记录(或学期无匹配)。成绩由教师在「学业」页录入',
        },
        `${params.name} 无成绩记录`,
      )
    }
    const views = records
      .map((g) => gradeView(g, examMap.get(g.examId), subjects))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
    return jsonResult({ student: params.name, grades: views }, `${params.name} 的成绩时间线`)
  },
}
