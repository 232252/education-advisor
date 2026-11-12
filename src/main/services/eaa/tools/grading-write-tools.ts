// =============================================================
// EAA Tools — AI 批改写入(从对话创建任务 / 改策略 / 发布成绩)
// 读工具见 grading-tools.ts。
// confirm 只表示模型已向教师复述，不是教师点击。
// extreme 另等界面确认框；教师取消则不建任务、不改策略。
// =============================================================

import type { AgentTool } from '@main/services/llm-contracts'
import { GRADING_STRATEGIES, normalizeGradingStrategy } from '@shared/grading-helpers'
import type { GradingStrategy } from '@shared/types'
import { Type } from 'typebox'
import { startGradingFromFiles } from '../../grading/batch-from-files'
import { assertDualModelConfigured } from '../../grading/dual-model-guard'
import { gradingService } from '../../grading/grading-service'
import { requireTeacherConfirm } from '../../teacher-confirm'
import { jsonResult } from './shared'

const strategySchema = Type.Union(
  [Type.Literal('fast'), Type.Literal('standard'), Type.Literal('dual'), Type.Literal('extreme')],
  {
    description:
      '流程策略，与 grading_mode 松紧不是一回事。fast=快改，standard=标准，dual=双评，extreme=极致 AI。不传则开批时按 standard。dual 未配置第二模型会失败，不会降成 standard。extreme 由应用弹出费用确认，教师点击后才生效；不要把 confirm 写成教师已同意。',
  },
)

const fromFilesParams = Type.Object({
  confirm: Type.Boolean({
    description:
      '非极致任务须为 true，表示你已向教师复述任务名、原卷路径、作业路径和流程策略。这不是教师点击。极致策略忽略本字段，费用确认只看界面对话框。',
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
  roster_paths: Type.Optional(
    Type.Array(Type.String(), {
      description:
        '花名册文件本地绝对路径(xlsx/xls/csv/md/txt/yaml,可选):卷面姓名归组优先用它,与 eaa 学生名单合并去重;不提供则只用 eaa 学生名单',
    }),
  ),
  auto_publish: Type.Optional(
    Type.Boolean({
      description: '批改完成后是否写入学业成绩(学生学业页/档案可查)。默认 true',
    }),
  ),
  grading_mode: Type.Optional(
    Type.Union([Type.Literal('strict'), Type.Literal('normal'), Type.Literal('lenient')], {
      description:
        '给分松紧，不是流程策略: strict=严格 / normal=正常(默认) / lenient=宽松。不要用它表示快改或极致 AI。',
    }),
  ),
  grading_strategy: Type.Optional(strategySchema),
})

const setStrategyParams = Type.Object({
  task_id: Type.String({
    description: '批改任务 ID(来自 eaa_grading_overview 或 from_files 回执)',
  }),
  grading_strategy: strategySchema,
})

const publishParams = Type.Object({
  confirm: Type.Boolean({
    description: '须为 true，表示你已向教师复述将要发布的任务。这不是教师点击确认。',
  }),
  task_id: Type.String({
    description: '批改任务 ID(来自 eaa_grading_overview 或 from_files 回执)',
  }),
})

function assertStrategy(strategy: string): asserts strategy is GradingStrategy {
  if (!(GRADING_STRATEGIES as string[]).includes(strategy)) {
    throw new Error(`非法批改模式: ${strategy}(${GRADING_STRATEGIES.join('/')})`)
  }
}

export const gradingFromFilesTool: AgentTool<typeof fromFilesParams> = {
  name: 'eaa_grading_from_files',
  label: '从附件创建批改任务',
  description:
    '教师在对话里发了原卷+学生作业(PDF/照片/zip)后调用:建任务、抽量规、导入作业、认人并异步开批。' +
    'grading_mode 是给分松紧(strict/normal/lenient)。grading_strategy 是流程策略(fast/standard/dual/extreme)，不传则按 standard 开批。' +
    '不要另造极致或双评工具。dual 未配置第二模型会失败，不会降成 standard。' +
    'extreme 会弹出费用确认，只有教师点击后才建任务；取消则不创建、不开批。confirm 不能代替这次点击。' +
    '非极致任务的 confirm 只表示你已复述任务。套打、批注 PDF、家长报告打印不在本工具里。',
  parameters: fromFilesParams,
  execute: async (_toolCallId, params, signal) => {
    const strategy = params.grading_strategy
    if (strategy !== 'extreme' && !params.confirm) {
      throw new Error(
        '创建批改任务前请先向教师复述任务名、路径和流程策略，再把 confirm 设为 true。这不是教师点击，也不能用来批准极致模式。',
      )
    }
    const result = await startGradingFromFiles(
      {
        name: params.name,
        semester: params.semester,
        className: params.class_name,
        examDate: params.exam_date,
        gradingMode: params.grading_mode,
        gradingStrategy: strategy,
        samplePaths: params.sample_paths,
        homeworkPaths: params.homework_paths,
        rosterPaths: params.roster_paths,
        autoPublish: params.auto_publish,
      },
      signal,
    )
    return jsonResult(result, result.hint)
  },
}

export const gradingSetStrategyTool: AgentTool<typeof setStrategyParams> = {
  name: 'eaa_grading_set_strategy',
  label: '修改批改流程策略',
  description:
    '修改已有批改任务的流程策略(fast/standard/dual/extreme)。不改给分松紧，也不重新开批。' +
    '改成 extreme 时应用会弹出费用确认，教师取消则策略保持原样。' +
    'dual 未配置第二模型会失败，不会改成 standard。没有 confirm 参数，不要自己声称教师已确认。',
  parameters: setStrategyParams,
  execute: async (_toolCallId, params, signal) => {
    assertStrategy(params.grading_strategy)
    assertDualModelConfigured(params.grading_strategy)
    const task = await gradingService.getTask(params.task_id)
    const current = normalizeGradingStrategy(task.gradingStrategy)
    if (params.grading_strategy === 'extreme' && current !== 'extreme') {
      await requireTeacherConfirm({ kind: 'extreme-grading', detail: task.name }, signal)
    }
    const updated = await gradingService.updateTask(params.task_id, {
      gradingStrategy: params.grading_strategy,
    })
    return jsonResult(
      {
        task_id: updated.id,
        grading_strategy: normalizeGradingStrategy(updated.gradingStrategy),
      },
      `流程策略已改为 ${params.grading_strategy}`,
    )
  },
}

export const gradingPublishTool: AgentTool<typeof publishParams> = {
  name: 'eaa_grading_publish',
  label: '发布批改成绩',
  description:
    '把已复核/已批改的任务成绩写入学业管线(考试+逐题分),学生「学业」页会自动出现。confirm 只表示你已复述任务，不是教师点击。',
  parameters: publishParams,
  execute: async (_toolCallId, params) => {
    if (!params.confirm) {
      throw new Error('发布成绩前请向教师复述任务，再将 confirm 设为 true。这不是教师点击确认。')
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
