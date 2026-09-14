// =============================================================
// EAA Tools — AI 批改写入(从对话创建任务 / 发布成绩)
// 读工具见 grading-tools.ts。写入须 confirm:true(教师在对话里先复述再调)。
// =============================================================

import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { startGradingFromFiles } from '../../grading/batch-from-files'
import { gradingService } from '../../grading/grading-service'
import { jsonResult } from './shared'

const fromFilesParams = Type.Object({
  confirm: Type.Boolean({
    description: '必须为 true 才执行。先向教师复述:任务名、原卷路径、作业包路径、是否发布成绩',
  }),
  name: Type.String({ description: '批改任务名,如「期中数学」' }),
  semester: Type.Optional(Type.String({ description: '学期,如 2025-2026-1;缺省用当前学期' })),
  class_name: Type.Optional(Type.String({ description: '班级名,用于过滤花名册识别卷面姓名' })),
  exam_date: Type.Optional(Type.String({ description: '考试日期 YYYY-MM-DD' })),
  sample_paths: Type.Array(Type.String(), {
    description: '原卷或答案卷的本地绝对路径(图片或 PDF,电子版/扫描件均可),用于抽取量规',
  }),
  homework_paths: Type.Array(Type.String(), {
    description: '学生作业本地绝对路径:照片 / PDF(电子版或扫描件) / 照片 zip(可按姓名分文件夹)',
  }),
  auto_publish: Type.Optional(
    Type.Boolean({
      description: '批改完成后是否写入学业成绩(学生学业页/档案可查)。默认 true',
    }),
  ),
  grading_mode: Type.Optional(
    Type.Union([Type.Literal('strict'), Type.Literal('normal'), Type.Literal('lenient')], {
      description:
        '批改口径: strict=严格(按步扣分不放过瑕疵) / normal=正常(默认) / lenient=宽松(思路对小瑕疵少扣)',
    }),
  ),
})

const publishParams = Type.Object({
  confirm: Type.Boolean({ description: '必须为 true 才发布' }),
  task_id: Type.String({
    description: '批改任务 ID(来自 eaa_grading_overview 或 from_files 回执)',
  }),
})

export const gradingFromFilesTool: AgentTool<typeof fromFilesParams> = {
  name: 'eaa_grading_from_files',
  label: '从附件创建批改任务',
  description:
    '教师在对话里发了原卷+学生作业(PDF/照片/zip)后调用:自动建任务、从原卷抽量规、导入作业、按花名册认人、启动视觉模型逐份批改。批改走 pi-ai,量规进 system prompt 并开短缓存(整班 50–60 人时后续份应命中 cacheRead)。默认批完写入学业。必须 confirm:true',
  parameters: fromFilesParams,
  execute: async (_toolCallId, params) => {
    if (!params.confirm) {
      throw new Error(
        '创建批改任务需要确认:请向教师复述任务名、原卷与作业路径后,将 confirm 设为 true 再调用',
      )
    }
    const result = await startGradingFromFiles({
      name: params.name,
      semester: params.semester,
      className: params.class_name,
      examDate: params.exam_date,
      gradingMode: params.grading_mode,
      samplePaths: params.sample_paths,
      homeworkPaths: params.homework_paths,
      autoPublish: params.auto_publish,
    })
    return jsonResult(result, result.hint)
  },
}

export const gradingPublishTool: AgentTool<typeof publishParams> = {
  name: 'eaa_grading_publish',
  label: '发布批改成绩',
  description:
    '把已复核/已批改的任务成绩写入学业管线(考试+逐题分),学生「学业」页会自动出现。必须 confirm:true',
  parameters: publishParams,
  execute: async (_toolCallId, params) => {
    if (!params.confirm) {
      throw new Error('发布成绩需要确认:请将 confirm 设为 true')
    }
    const published = await gradingService.publishTask(params.task_id)
    return jsonResult(
      {
        task_id: published.task.id,
        exam_id: published.task.publishedExamId,
        published: published.published,
        skipped: published.skipped,
      },
      `已发布 ${published.published} 条成绩到学业`,
    )
  },
}
