// =============================================================
// EAA Tools — AI 批改数据查询类工具(grading_overview / grading_student)
//
// 批改任务(<appData>/grading/,批改作业页产生)只读查询,补齐
// 「AI 知道作业批改表现」的数据面: 已发布的成绩经 publish 落入学业
// 管线(eaa_exams/eaa_exam_grades 可查),本工具补充批改过程视角
// (逐题得分/依据/迟交缺席等行为面)。
// 隐私:与其他 eaa_* 工具同管道 — privacyGuard.wrapTool 对入参化名→
// 真名、结果真名→化名,本文件无需自行处理化名。
// =============================================================

import type { AgentTool } from '@main/services/llm-contracts'
import { effectiveQuestionScore, effectiveTotalScore } from '@shared/grading-helpers'
import { Type } from 'typebox'
import { gradingService } from '../../grading/grading-service'
import { jsonResult } from './shared'

// =============================================================
// Schema
// =============================================================

const gradingOverviewParams = Type.Object({
  semester: Type.Optional(
    Type.String({ description: '按学期过滤(如 2026秋);不填列出全部批改任务' }),
  ),
})

const gradingStudentParams = Type.Object({
  name: Type.String({ description: '学生姓名' }),
})

// =============================================================
// 视图辅助
// =============================================================

const EMPTY_GRADING_HINT =
  '尚无批改任务。教师在「批改作业」页创建任务、上传试卷并 AI 批改后,才可查询。'

/** 任务级概览(不含逐题明细,控制输出体量) */
function taskOverview(task: Awaited<ReturnType<typeof gradingService.listTasks>>[number]) {
  const graded = task.papers.filter((p) => p.status === 'graded')
  const totals = graded.map((p) => effectiveTotalScore(p)).filter((v): v is number => v !== null)
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    semester: task.semester,
    date: task.examDate ?? '',
    class: task.className ?? '',
    questions: task.rubric.length,
    full_mark: task.rubric.reduce((s, q) => s + q.fullMark, 0),
    papers: task.papers.length,
    graded: graded.length,
    failed: task.papers.filter((p) => p.status === 'failed').length,
    unassigned: task.papers.filter((p) => p.studentName === null).length,
    avg_score:
      totals.length > 0
        ? Number((totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(1))
        : null,
    published_exam_id: task.publishedExamId ?? null,
  }
}

/** 单生单任务的逐题视图 */
function studentPaperView(
  task: Awaited<ReturnType<typeof gradingService.listTasks>>[number],
  paper: Awaited<ReturnType<typeof gradingService.listTasks>>[number]['papers'][number],
) {
  return {
    task: task.name,
    task_id: task.id,
    date: task.examDate ?? '',
    status: paper.status,
    total: effectiveTotalScore(paper),
    full_mark: task.rubric.reduce((s, q) => s + q.fullMark, 0),
    questions: task.rubric.map((q) => ({
      question: q.title,
      ai_score: paper.ai?.questions.find((a) => a.questionId === q.id)?.score ?? null,
      score: effectiveQuestionScore(paper, q.id),
      full_mark: q.fullMark,
      evidence: paper.ai?.questions.find((a) => a.questionId === q.id)?.evidence ?? '',
    })),
    teacher_overridden: paper.review ? Object.keys(paper.review.questions).length > 0 : false,
    error: paper.error ?? null,
  }
}

// =============================================================
// 1. 批改任务概览
// =============================================================
export const gradingOverviewTool: AgentTool<typeof gradingOverviewParams> = {
  name: 'eaa_grading_overview',
  label: '批改任务概览',
  description:
    '列出 AI 批改任务(名称/状态/题目数/份数/已批/失败/均分)。查作业批改表现先看本工具;已发布任务的成绩也可用 eaa_exam_grades 按考试查',
  parameters: gradingOverviewParams,
  execute: async (_toolCallId, params) => {
    const tasks = await gradingService.listTasks()
    const filtered = params.semester ? tasks.filter((t) => t.semester === params.semester) : tasks
    if (filtered.length === 0) {
      return jsonResult(
        { tasks: [], hint: EMPTY_GRADING_HINT },
        params.semester ? `学期 ${params.semester} 无批改任务` : '无批改任务',
      )
    }
    return jsonResult({ tasks: filtered.map(taskOverview) }, `${filtered.length} 个批改任务`)
  },
}

// =============================================================
// 2. 单生批改明细时间线
// =============================================================
export const gradingStudentTool: AgentTool<typeof gradingStudentParams> = {
  name: 'eaa_grading_student',
  label: '学生批改明细',
  description:
    '查询一个学生在各批改任务中的逐题得分(AI 分/生效分/满分/判分依据)与教师改分标记,按任务时间倒序。分析作业薄弱知识点时使用',
  parameters: gradingStudentParams,
  execute: async (_toolCallId, params) => {
    const tasks = await gradingService.listTasks()
    const papers = tasks
      .flatMap((task) =>
        task.papers.filter((p) => p.studentName === params.name).map((p) => ({ task, paper: p })),
      )
      .sort((a, b) => (a.task.createdAt < b.task.createdAt ? 1 : -1))
    if (papers.length === 0) {
      return jsonResult(
        {
          student: params.name,
          papers: [],
          hint: '该生没有任何批改记录。可能是姓名不一致(用 eaa_list_students 核对)或该生缺交/未归组',
        },
        `${params.name} 无批改记录`,
      )
    }
    return jsonResult(
      {
        student: params.name,
        papers: papers.map(({ task, paper }) => studentPaperView(task, paper)),
      },
      `${params.name} 的批改明细`,
    )
  },
}
