// =============================================================
// EAA Tools — 学业写入(改分 / 删考试)
// 查询见 academic-tools.ts。改分是普通写入，没有 confirm 参数。
// 删考试会级联清成绩，必须等教师在界面点确认。
// =============================================================

import type { AgentTool } from '@main/services/llm-contracts'
import type { ExamDef } from '@shared/types'
import { Type } from 'typebox'
import { invalidateOnExamsWrite, invalidateOnGradesWrite } from '../../../ipc/academic/cache'
import { sanitizeName } from '../../../utils/sanitize'
import { academicService } from '../../academic-service'
import { requireTeacherConfirm } from '../../teacher-confirm'
import { jsonResult } from './shared'

const setGradeParams = Type.Object({
  exam_id: Type.String({ description: '考试 ID。先用 eaa_exams 取得，不要猜。' }),
  student: Type.String({ description: '学生姓名，须与成绩记录里的姓名一致' }),
  subject: Type.String({
    description: '科目 ID 或科目名，如 math 或 数学。先看 eaa_exams 返回的 subjects。',
  }),
  score: Type.Union([Type.Number(), Type.Null()], {
    description: '新分数。null 表示缺考。不要传 confirm，也没有这个参数。',
  }),
})

const deleteExamParams = Type.Object({
  exam_id: Type.String({
    description: '要删除的考试 ID。调用后应用会弹出确认，教师点取消则不删除。不要自填 confirm。',
  }),
})

async function requireExam(examId: string): Promise<ExamDef> {
  const exams = await academicService.listExams()
  const exam = exams.find((e) => e.id === examId)
  if (!exam) {
    throw new Error(`考试不存在: ${examId}。请先调用 eaa_exams 获取有效考试 ID`)
  }
  return exam
}

async function resolveSubject(
  subject: string,
  exam: ExamDef,
): Promise<{ id: string; fullMark: number }> {
  const needle = subject.trim()
  if (!needle) throw new Error('科目不能为空')
  const config = await academicService.getConfig()
  const meta = config.subjects.find((s) => s.id === needle || s.name === needle)
  if (!meta) {
    throw new Error(`未知科目: ${subject}。请用 eaa_exams 返回的科目 id 或名称`)
  }
  if (exam.subjects.length > 0 && !exam.subjects.includes(meta.id)) {
    throw new Error(`科目 ${meta.name} 不属于考试 ${exam.name}`)
  }
  return { id: meta.id, fullMark: meta.fullMark }
}

export const setGradeTool: AgentTool<typeof setGradeParams> = {
  name: 'eaa_set_grade',
  label: '修改学业成绩',
  description:
    '修改一名学生在一场已有考试中的一科分数，或把该科记为缺考(score=null)。' +
    '先用 eaa_exams / eaa_exam_grades 核对考试和原分，向教师复述「谁、哪一场、哪一科、改成多少」后再调用。' +
    '没有 confirm 参数。不能新建考试、不能删考试、不能删除学生。',
  parameters: setGradeParams,
  execute: async (_toolCallId, params) => {
    const exam = await requireExam(params.exam_id)
    const student = sanitizeName(params.student, 'name')
    const subject = await resolveSubject(params.subject, exam)
    if (params.score !== null && !Number.isFinite(params.score)) {
      throw new Error('score 必须是有限数字或 null')
    }
    const written = await academicService.batchSetGrades([
      {
        examId: exam.id,
        subjectId: subject.id,
        studentName: student,
        score: params.score,
        fullMark: subject.fullMark,
      },
    ])
    invalidateOnGradesWrite([student])
    return jsonResult(
      {
        exam_id: exam.id,
        exam: exam.name,
        student,
        subject_id: subject.id,
        score: params.score,
        written,
      },
      params.score === null
        ? `已把 ${student} 在 ${exam.name} 的该科记为缺考`
        : `已把 ${student} 在 ${exam.name} 的该科改为 ${params.score}`,
    )
  },
}

export const deleteExamTool: AgentTool<typeof deleteExamParams> = {
  name: 'eaa_delete_exam',
  label: '删除考试',
  description:
    '删除一场考试，并级联删除这场考试的全部成绩。不可撤销。' +
    '调用后应用弹出确认框，只有教师点击确认才会删除；取消则考试和成绩都保留。' +
    '不要传 confirm，模型不能代替教师点击。',
  parameters: deleteExamParams,
  execute: async (_toolCallId, params, signal) => {
    const exam = await requireExam(params.exam_id)
    await requireTeacherConfirm(
      { kind: 'delete-exam', detail: `${exam.name} (${exam.id})` },
      signal,
    )
    await academicService.deleteExam(exam.id)
    invalidateOnExamsWrite()
    return jsonResult(
      { exam_id: exam.id, name: exam.name, deleted: true },
      `已删除考试: ${exam.name}`,
    )
  },
}
