// =============================================================
// DoneStep — 引导向导完成页
// 展示配置摘要(班级/学生/Agent)并提供「开始使用」入口。
// =============================================================

import type { LucideIcon } from 'lucide-react'
import { Bot, CheckCircle2, School, UserPlus } from 'lucide-react'
import type { RefObject } from 'react'
import { useT } from '../../../i18n'

/** 完成页摘要数据 */
export interface OnboardingSummary {
  className: string | null
  studentsAdded: number
  studentsFailed: number
  agentsEnabled: number
}

interface DoneStepProps {
  summary: OnboardingSummary
  /** 开始使用 → 标记完成并跳转仪表盘 */
  onFinish: () => void
  /** 主按钮 ref — 弹层内接管键盘焦点(替代 autoFocus) */
  primaryBtnRef: RefObject<HTMLButtonElement | null>
}

export function DoneStep({ summary, onFinish, primaryBtnRef }: DoneStepProps) {
  const { t } = useT()
  return (
    <div className="text-center py-4">
      <div className="flex items-center justify-center w-14 h-14 rounded-full bg-green-100 dark:bg-green-500/15 text-green-600 dark:text-green-400 mx-auto mb-4">
        <CheckCircle2 size={28} />
      </div>
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1.5">
        {t('onboarding.done.title', '配置完成!')}
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
        {t('onboarding.done.desc', '一切就绪,现在可以开始使用 Education Advisor 了。')}
      </p>
      <div className="rounded-xl border border-gray-200/70 dark:border-white/[0.06] bg-gray-50/60 dark:bg-white/[0.03] p-4 space-y-1.5 text-left mb-5">
        <SummaryRow
          icon={School}
          label={t('onboarding.summary.class', '已创建班级')}
          value={summary.className ?? t('onboarding.summary.none', '未配置')}
        />
        <SummaryRow
          icon={UserPlus}
          label={t('onboarding.summary.students', '已添加学生')}
          value={
            summary.studentsAdded > 0
              ? `${summary.studentsAdded} ${t('onboarding.summary.people', '名')}` +
                (summary.studentsFailed > 0
                  ? ` (${summary.studentsFailed} ${t('onboarding.summary.failed', '名失败')})`
                  : '')
              : t('onboarding.summary.none', '未配置')
          }
        />
        <SummaryRow
          icon={Bot}
          label={t('onboarding.summary.agents', '已启用 Agent')}
          value={
            summary.agentsEnabled > 0
              ? `${summary.agentsEnabled} ${t('onboarding.summary.units', '个')}`
              : t('onboarding.summary.none', '未配置')
          }
        />
      </div>
      <button
        type="button"
        onClick={onFinish}
        ref={primaryBtnRef}
        className="px-6 py-2 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 shadow-md shadow-blue-500/20 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
      >
        {t('onboarding.done.start', '开始使用')}
      </button>
    </div>
  )
}

/** 完成页摘要行: 图标 + 标签 + 右对齐数值 */
function SummaryRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon size={14} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <span className="ml-auto text-xs font-semibold text-gray-800 dark:text-gray-200">
        {value}
      </span>
    </div>
  )
}
