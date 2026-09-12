// =============================================================
// ClassGradesAiPanel — 「AI 分析本班」entry + streaming output.
// Reuses academic agent via useClassGradesAiAnalysis.
// =============================================================

import { Bot, Sparkles } from 'lucide-react'
import { useMemo } from 'react'
import { Button } from '../../../components/Button'
import { useT } from '../../../i18n'
import { CARD_BASE } from '../../../lib/ui-utils'
import type {
  AcademicStatsSummary,
  StudentGradeRow,
} from '../../Dashboard/dashboard-academic-stats'
import { useClassGradesAiAnalysis } from '../hooks/useClassGradesAiAnalysis'
import type { ClassGradesAiPromptInput } from '../lib/class-grades-ai-prompt'

export function ClassGradesAiPanel({
  classLabel,
  examName,
  examDate,
  subjectLabel,
  stats,
  avgLabel,
  ranked,
  watchlist,
  movement,
  canCompare,
  examAName,
  examBName,
  movers,
  disabled,
}: {
  classLabel?: string
  examName: string
  examDate?: string
  subjectLabel: string
  stats: AcademicStatsSummary
  avgLabel: string
  ranked: StudentGradeRow[]
  watchlist: StudentGradeRow[]
  movement: { improved: number; declined: number; flat: number }
  canCompare: boolean
  examAName?: string
  examBName?: string
  movers: Array<{ studentName: string; totalScoreDelta: number | null }>
  disabled?: boolean
}) {
  const { t } = useT()
  const ai = useClassGradesAiAnalysis()

  const promptInput: ClassGradesAiPromptInput = useMemo(() => {
    const base: ClassGradesAiPromptInput = {
      classLabel,
      examName,
      examDate,
      subjectLabel,
      stats,
      avgLabel,
      ranked,
      watchlist,
    }
    if (canCompare && examAName && examBName) {
      base.movement = movement
      base.examAName = examAName
      base.examBName = examBName
      base.movers = movers
    }
    return base
  }, [
    avgLabel,
    canCompare,
    classLabel,
    examAName,
    examBName,
    examDate,
    examName,
    movers,
    movement,
    ranked,
    stats,
    subjectLabel,
    watchlist,
  ])

  return (
    <div className={`${CARD_BASE} p-3 space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles size={16} className="text-purple-500 shrink-0" aria-hidden />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">
              {t('page.classes.grades.ai.title', 'AI 分析本班')}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {ai.agentsReady
                ? ai.agentId
                  ? t('page.classes.grades.ai.usingAgent', '将使用：{name}').replace(
                      '{name}',
                      ai.agentName ?? ai.agentId,
                    )
                  : t(
                      'page.classes.grades.ai.noAgent',
                      '没有可用的 Agent，请先在「Agent」页启用学业分析师',
                    )
                : t('page.classes.grades.ai.loadingAgents', '加载 Agent…')}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {ai.output && !ai.running && (
            <Button variant="ghost" size="sm" onClick={ai.clear}>
              {t('page.classes.grades.ai.clear', '清除')}
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={Boolean(disabled) || ai.running || !ai.agentId}
            onClick={() => void ai.run(promptInput)}
          >
            <Bot size={14} strokeWidth={2} />
            {ai.running
              ? t('page.classes.grades.ai.running', '分析中…')
              : t('page.classes.grades.ai.run', 'AI 分析本班')}
          </Button>
        </div>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        {t(
          'page.classes.grades.ai.hint',
          '仅附带班级名、考试、摘要统计、排行/待关注与升降人数等上下文，不会整表导出原始成绩。',
        )}
      </p>

      {ai.message && (
        <div
          className={`text-xs ${
            ai.message.includes('失败') || ai.message.toLowerCase().includes('fail')
              ? 'text-red-500'
              : 'text-green-600 dark:text-green-400'
          }`}
        >
          {ai.message}
        </div>
      )}

      {(ai.output || ai.running) && (
        <div className="rounded-lg border border-purple-200/60 dark:border-purple-900/40 bg-gradient-to-br from-purple-50/80 to-blue-50/40 dark:from-purple-950/20 dark:to-blue-950/10 p-3 max-h-80 overflow-y-auto">
          <pre className="text-xs text-gray-700 dark:text-gray-200 whitespace-pre-wrap font-sans leading-relaxed m-0">
            {ai.output || t('page.classes.grades.ai.streaming', '正在生成…')}
          </pre>
        </div>
      )}
    </div>
  )
}
