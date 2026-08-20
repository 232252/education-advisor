// =============================================================
// HomeSchoolTab — 家校沟通 Tab
// 上: AI 沟通话术生成(场景×语气×Agent → 可复制话术)
// 下: 家长版报告打印(温和措辞,不含敏感信息)
// =============================================================

import type {
  AgentListItem,
  EAAHistoryData,
  EAAStudent,
  EAAStudentScore,
  StudentProfileData,
} from '@shared/types'
import { Copy, MessageCircleHeart, PhoneCall, Printer, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../components/Button'
import { ParentReportDocument } from '../../../components/print/ParentReportDocument'
import { PrintOverlay } from '../../../components/print/PrintOverlay'
import { useStudentPrintData } from '../../../components/print/useStudentPrintData'
import { useT } from '../../../i18n'
import { cn } from '../../../lib/ui-utils'
import { toast } from '../../../stores/toastStore'
import { useCommunicationScript } from '../hooks/useCommunicationScript'
import { COMM_SCENARIOS, COMM_TONES } from '../lib/home-school'

interface HomeSchoolTabProps {
  student: EAAStudent
  score: EAAStudentScore | null
  history: EAAHistoryData | null
  profileData: StudentProfileData
  agents: AgentListItem[]
}

export function HomeSchoolTab({
  student,
  score,
  history,
  profileData,
  agents,
}: HomeSchoolTabProps) {
  const { t } = useT()
  const events = history?.events ?? []
  const script = useCommunicationScript(student, events, profileData, agents)
  const printReport = useStudentPrintData(student)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!script.output) return
    try {
      await navigator.clipboard.writeText(script.output)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error(t('homeSchool.copyFailed', '复制失败,请手动选择文本复制'))
    }
  }

  return (
    <div className="space-y-4">
      {/* ── AI 沟通话术 ── */}
      <section className="rounded-xl border border-gray-200/70 dark:border-white/[0.06] bg-white dark:bg-surface-tertiary p-4">
        <div className="flex items-center gap-2 mb-3">
          <MessageCircleHeart size={16} className="text-blue-500 dark:text-blue-400" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('homeSchool.script.title', 'AI 沟通话术')}
          </h3>
        </div>

        {/* 场景选择 */}
        <div className="mb-3">
          <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">
            {t('homeSchool.scenario.label', '沟通场景')}
          </span>
          <div className="flex gap-2">
            {COMM_SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => script.setScenario(s.id)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                  script.scenario === s.id
                    ? 'border-blue-400 bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300'
                    : 'border-gray-200 dark:border-white/[0.08] text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.04]',
                )}
              >
                {t(s.labelKey, s.label)}
              </button>
            ))}
          </div>
        </div>

        {/* 语气选择 */}
        <div className="mb-3">
          <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">
            {t('homeSchool.tone.label', '语气基调')}
          </span>
          <div className="flex gap-2">
            {COMM_TONES.map((tone) => (
              <button
                key={tone.id}
                type="button"
                onClick={() => script.setTone(tone.id)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                  script.tone === tone.id
                    ? 'border-blue-400 bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300'
                    : 'border-gray-200 dark:border-white/[0.08] text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.04]',
                )}
              >
                {t(tone.labelKey, tone.label)}
              </button>
            ))}
          </div>
        </div>

        {/* Agent 选择 + 生成 */}
        <div className="flex items-end gap-2 mb-3">
          <label className="flex-1">
            <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">
              {t('homeSchool.agent', '生成 Agent')}
            </span>
            <select
              value={script.agentId}
              onChange={(e) => script.setAgentId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-white/[0.08] bg-white dark:bg-surface-elevated text-sm text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
            >
              {agents.length === 0 && (
                <option value="">{t('homeSchool.noAgent', '无可用 Agent')}</option>
              )}
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.enabled ? '' : ` (${t('homeSchool.disabled', '未启用')})`}
                </option>
              ))}
            </select>
          </label>
          <Button
            onClick={() => void script.generate()}
            disabled={script.running || !script.agentId}
            icon={<Sparkles size={14} aria-hidden />}
          >
            {script.running
              ? t('homeSchool.generating', '生成中…')
              : t('homeSchool.generate', '生成话术')}
          </Button>
        </div>

        {script.message && (
          <p className="text-xs text-blue-600 dark:text-blue-400 mb-2">{script.message}</p>
        )}

        {/* 话术输出 */}
        {script.output ? (
          <div className="relative">
            <pre className="rounded-lg border border-gray-200 dark:border-white/[0.06] bg-gray-50 dark:bg-white/[0.03] p-3.5 text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
              {script.output}
            </pre>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className={cn(
                'absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px]',
                'bg-white dark:bg-surface-elevated border border-gray-200 dark:border-white/[0.08]',
                'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors',
              )}
            >
              <Copy size={11} aria-hidden />
              {copied ? t('homeSchool.copied', '已复制') : t('homeSchool.copy', '复制')}
            </button>
          </div>
        ) : (
          <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
            {t(
              'homeSchool.script.hint',
              '选择场景与语气后点击生成。话术将基于该生的操行事件、学业情况自动撰写，措辞已做家长友好化处理。',
            )}
          </p>
        )}
      </section>

      {/* ── 家长版报告 ── */}
      <section className="rounded-xl border border-gray-200/70 dark:border-white/[0.06] bg-white dark:bg-surface-tertiary p-4">
        <div className="flex items-center gap-2 mb-2">
          <PhoneCall size={16} className="text-emerald-500 dark:text-emerald-400" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('homeSchool.parentReport.title', '家长版报告')}
          </h3>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 leading-relaxed">
          {t(
            'homeSchool.parentReport.desc',
            '面向家长的一页式报告: 温和措辞呈现表现亮点与关注点,不含身份证/联系方式等敏感信息,附家校配合建议。可直接打印或另存为 PDF。',
          )}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => void printReport.openPrint()}
            disabled={printReport.loading}
            icon={<Printer size={14} aria-hidden />}
          >
            {printReport.loading
              ? t('common.loading', '加载中...')
              : t('homeSchool.parentReport.print', '打印家长版报告')}
          </Button>
          <span className="text-[11px] text-gray-400 dark:text-gray-500">
            {t('homeSchool.parentReport.pdfHint', '打印对话框中选择「另存为 PDF」可导出 PDF')}
          </span>
        </div>
      </section>

      {/* 家长版报告打印预览 */}
      {printReport.open && printReport.data && (
        <PrintOverlay
          title={`${t('print.parentReport.title', '家校沟通报告')} — ${student.name}`}
          onClose={printReport.closePrint}
        >
          <ParentReportDocument
            studentName={student.name}
            classId={student.class_id}
            score={score}
            profileData={profileData}
            events={events}
            grades={printReport.data.grades}
            exams={printReport.data.exams}
            subjects={printReport.data.subjects}
          />
        </PrintOverlay>
      )}
    </div>
  )
}
