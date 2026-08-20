// =============================================================
// StepIndicator — 引导向导步骤指示器
// 渲染「创建班级 → 添加学生 → 启用 Agent」三步进度条。
// 欢迎/完成页隐藏(由外层向导控制是否渲染)。
// =============================================================

import { CheckCircle2, type LucideIcon } from 'lucide-react'
import { cn } from '../../lib/ui-utils'

/** 向导步骤定义(步骤指示器与欢迎页共用) */
export interface WizardStepDef {
  key: 'class' | 'students' | 'agents'
  icon: LucideIcon
  label: string
}

interface StepIndicatorProps {
  /** 步骤定义列表 */
  steps: readonly WizardStepDef[]
  /** 当前步骤下标(0 起; -1 = 欢迎页, 3 = 完成页) */
  stepIndex: number
}

export function StepIndicator({ steps, stepIndex }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-0 mb-6">
      {steps.map((s, i) => {
        const Icon = s.icon
        const state = i < stepIndex ? 'done' : i === stepIndex ? 'active' : 'todo'
        return (
          <div key={s.key} className="flex items-center">
            {i > 0 && (
              <span
                className={cn(
                  'w-10 h-px mx-1',
                  i <= stepIndex ? 'bg-blue-500' : 'bg-gray-200 dark:bg-white/[0.1]',
                )}
              />
            )}
            <div className="flex flex-col items-center gap-1">
              <span
                className={cn(
                  'flex items-center justify-center w-8 h-8 rounded-full border text-xs font-semibold transition-colors',
                  state === 'done' && 'bg-blue-500 border-blue-500 text-white',
                  state === 'active' &&
                    'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10',
                  state === 'todo' &&
                    'border-gray-200 dark:border-white/[0.1] text-gray-400 dark:text-gray-500',
                )}
              >
                {state === 'done' ? <CheckCircle2 size={14} /> : <Icon size={14} />}
              </span>
              <span
                className={cn(
                  'text-[10px] font-medium',
                  state === 'todo'
                    ? 'text-gray-400 dark:text-gray-500'
                    : 'text-gray-700 dark:text-gray-300',
                )}
              >
                {s.label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
