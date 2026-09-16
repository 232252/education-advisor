// =============================================================
// Grading Publish — 批改结果发布为学业成绩(ExamDef + GradeRecord)
// 映射口径:
//   一个批改任务 → 一场考试(ExamDef, type='other', scope='ai-grading')
//   量规题目 → 科目(subjectId = "1.选择题" 顺序前缀保证唯一且可读)
//   另加"总分"科目(fullMark = 量规满分)
//   生效分 = 教师覆盖 > AI 分(grading-helpers 同一口径)
// 发布幂等: examId 复用 task.publishedExamId,batchSetGrades 按
// (examId, subjectId) upsert,重复发布=覆盖。
// =============================================================

import { effectiveQuestionScore, effectiveTotalScore } from '@shared/grading-helpers'
import type { ExamDef, GradeRecord, GradingTask } from '@shared/types'

/** 总分科目 id(展示层直接回退显示该字符串) */
export const TOTAL_SUBJECT_ID = '总分'

export interface PublishPayload {
  examInput: Omit<ExamDef, 'id' | 'createdAt'>
  /** examId 在服务层确定(首次发布创建考试后回填 task.publishedExamId) */
  records: Array<Omit<GradeRecord, 'updatedAt' | 'examId'>>
  /** 无法发布的学生及原因(批改失败未复核/未归组等) */
  skipped: Array<{ paperId: string; studentName: string | null; reason: string }>
}

/** 题目 → 科目 id: 顺序前缀保证唯一,"1.选择题" 形式可直接显示 */
export function questionSubjectIds(rubric: GradingTask['rubric']): string[] {
  const used = new Set<string>([TOTAL_SUBJECT_ID])
  return rubric.map((q, i) => {
    let candidate = `${i + 1}.${q.title}`
    while (used.has(candidate)) candidate = `${candidate}′`
    used.add(candidate)
    return candidate
  })
}

/**
 * 构造发布载荷(纯函数):
 * - 只发布"有归属学生且整卷生效分完整"的试卷
 * - 总分记录与逐题记录同批写入;note 标注 AI 批改溯源
 */
export function buildPublishPayload(task: GradingTask): PublishPayload {
  const subjectIds = questionSubjectIds(task.rubric)
  const fullMarkTotal = task.rubric.reduce((sum, q) => sum + q.fullMark, 0)
  const note = `AI批改·${task.name}`
  const date = task.examDate || task.createdAt.slice(0, 10)

  const examInput: Omit<ExamDef, 'id' | 'createdAt'> = {
    name: task.name,
    type: 'other',
    date,
    semester: task.semester,
    scope: 'ai-grading',
    // 带上任务班级:学业页按生过滤"非本班考试"(任务未选班则留空=全员可见)
    classId: task.classId,
    className: task.className,
    subjects: [...subjectIds, TOTAL_SUBJECT_ID],
  }

  const records: PublishPayload['records'] = []
  const skipped: PublishPayload['skipped'] = []
  const publishedStudents = new Set<string>()
  for (const paper of task.papers) {
    if (paper.studentName === null) {
      skipped.push({ paperId: paper.id, studentName: null, reason: '未归组' })
      continue
    }
    if (!paper.ai) {
      skipped.push({ paperId: paper.id, studentName: paper.studentName, reason: '未批改' })
      continue
    }
    if (publishedStudents.has(paper.studentName)) {
      skipped.push({
        paperId: paper.id,
        studentName: paper.studentName,
        reason: '同学生已有另一份试卷，跳过以免覆盖成绩',
      })
      continue
    }
    const total = effectiveTotalScore(paper)
    if (total === null) {
      skipped.push({ paperId: paper.id, studentName: paper.studentName, reason: '分数不完整' })
      continue
    }
    for (const [i, q] of task.rubric.entries()) {
      const score = effectiveQuestionScore(paper, q.id)
      if (score === null) {
        // 理论不可达(effectiveTotalScore 非 null 已保证逐题有分),防御性跳过
        skipped.push({ paperId: paper.id, studentName: paper.studentName, reason: '分数不完整' })
        continue
      }
      records.push({
        subjectId: subjectIds[i] as string,
        studentName: paper.studentName,
        score,
        fullMark: q.fullMark,
        note,
      })
    }
    records.push({
      subjectId: TOTAL_SUBJECT_ID,
      studentName: paper.studentName,
      score: total,
      fullMark: fullMarkTotal,
      note,
    })
    publishedStudents.add(paper.studentName)
  }
  return { examInput, records, skipped }
}
