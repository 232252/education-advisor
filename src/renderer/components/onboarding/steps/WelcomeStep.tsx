// =============================================================
// WelcomeStep — 引导向导欢迎页
// 展示产品简介与三步流程概览;可「跳过引导」或「开始配置」。
// =============================================================

import { Sparkles } from 'lucide-react'
import type { RefObject } from 'react'
import { useT } from '../../../i18n'
import type { WizardStepDef } from '../StepIndicator'

interface WelcomeStepProps {
  /** 步骤定义(渲染三步概览卡片) */
  steps: readonly WizardStepDef[]
  /** 跳过引导(标记完成并关闭) */
  onSkip: () => void
  /** 开始配置 → 进入建班步骤 */
  onStart: () => void
  /** 主按钮 ref — 弹层内接管键盘焦点(替代 autoFocus) */
  primaryBtnRef: RefObject<HTMLButtonElement | null>
}

export function WelcomeStep({ steps, onSkip, onStart, primaryBtnRef }: WelcomeStepProps) {
  const { t } = useT()
  return (
    <div className="text-center py-4">
      <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-500 text-white shadow-lg shadow-blue-500/25 mx-auto mb-4">
        <Sparkles size={26} />
      </div>
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1.5">
        {t('onboarding.welcome.title', '欢迎使用 Education Advisor')}
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
        {t(
          'onboarding.welcome.desc',
          '智能教育管理助手 — 事件驱动的学生操行记录、学业分析与多 Agent 协作。只需 3 步即可开始使用。',
        )}
      </p>
      <div className="grid grid-cols-3 gap-3 mb-6">
        {steps.map((s, i) => {
          const Icon = s.icon
          return (
            <div
              key={s.key}
              className="rounded-xl border border-gray-200/70 dark:border-white/[0.06] bg-gray-50/60 dark:bg-white/[0.03] p-3.5 text-center"
            >
              <Icon size={20} className="mx-auto text-blue-500 dark:text-blue-400 mb-2" />
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                {i + 1}. {s.label}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex items-center justify-center gap-2.5">
        <button
          type="button"
          onClick={onSkip}
          className="px-4 py-2 rounded-lg text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
        >
          {t('onboarding.skip', '跳过引导')}
        </button>
        <button
          type="button"
          onClick={onStart}
          ref={primaryBtnRef}
          className="px-5 py-2 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 shadow-md shadow-blue-500/20 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
        >
          {t('onboarding.start', '开始配置')}
        </button>
      </div>
    </div>
  )
}
