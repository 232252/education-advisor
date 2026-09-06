// =============================================================
// 诊断 & 维护 Section — EAA 健康检查 (doctor) + 数据完整性验证 (validate)
// 状态自持(2026-09-05 下沉): doctor/validate 的运行态与结果仅本节消费,
// 不再从 SettingsPage 声明 4 个 useState + 透传 8 个 props
// =============================================================

import { useState } from 'react'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { btnStyle, cn } from '../../../lib/ui-utils'
import { Section, SettingRow } from '../components'

interface DoctorResult {
  healthy: boolean
  passed: number
  failed: number
  issues: string[]
}
interface ValidateResult {
  valid: boolean
  total_events: number
  errors: string[]
  warnings: string[]
}

/**
 * 运行态诊断: running → 调 IPC → 成功落数据 / envelope 失败走 fail / 异常走 caught → done。
 * doctor/validate 两个原本逐字同构的 ~30 行 handler 收敛为两次参数化调用。
 */
function useDiagnostic<T>(fail: (envelope: unknown) => T, caught: (err: unknown) => T) {
  const [status, setStatus] = useState<'idle' | 'running' | 'done'>('idle')
  const [result, setResult] = useState<T | null>(null)
  const run = async (invoke: () => Promise<{ success: boolean; data?: unknown }>) => {
    setStatus('running')
    setResult(null)
    try {
      const r = await invoke()
      setResult(r.success && r.data ? (r.data as T) : fail(r))
    } catch (err) {
      setResult(caught(err))
    } finally {
      setStatus('done')
    }
  }
  return { status, result, run }
}

/** 诊断按钮共用配色(与 UPDATE_BTN_BLUE 同族,本节两处使用) */
const DIAG_BTN = cn(
  btnStyle('secondary'),
  'text-xs bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20',
)

export function DiagnosticSection() {
  const { t } = useT()
  const doctor = useDiagnostic<DoctorResult>(
    (r) => ({
      healthy: false,
      passed: 0,
      failed: 0,
      issues: [(r as { stderr?: string }).stderr || t('error.unknown', '未知错误')],
    }),
    (err) => ({ healthy: false, passed: 0, failed: 0, issues: [String(err)] }),
  )
  const validate = useDiagnostic<ValidateResult>(
    () => ({
      valid: false,
      total_events: 0,
      errors: [t('page.settings.diagnostic.validateFailed', '验证失败')],
      warnings: [],
    }),
    (err) => ({ valid: false, total_events: 0, errors: [String(err)], warnings: [] }),
  )
  return (
    <Section title={t('page.settings.diagnostic.title', '诊断 & 维护')}>
      <SettingRow
        label={t('page.settings.diagnostic.doctor', 'EAA 健康检查')}
        path="eaa.doctor"
        description={t(
          'page.settings.diagnostic.doctorDesc',
          '检查 EAA 引擎运行环境、数据完整性、配置正确性',
        )}
      >
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => doctor.run(() => getAPI().eaa.doctor())}
            disabled={doctor.status === 'running'}
            className={DIAG_BTN}
          >
            {doctor.status === 'running'
              ? t('page.dashboard.sysmgmt.doctor.running', '检查中...')
              : t('page.dashboard.sysmgmt.doctor.run', '运行检查')}
          </button>
          {doctor.result && (
            <div className="text-[10px] leading-relaxed">
              {doctor.result.healthy ? (
                <span className="text-emerald-500 dark:text-emerald-400">
                  ✓ {t('page.dashboard.sysmgmt.doctor.healthy', '健康')}
                </span>
              ) : (
                <span className="text-red-500 dark:text-red-400">
                  ✗ {t('page.dashboard.sysmgmt.doctor.unhealthy', '异常')}
                </span>
              )}
              <span className="text-gray-500 dark:text-gray-400 ml-2">
                {t('page.dashboard.sysmgmt.doctor.passed', '通过')} {doctor.result.passed} /{' '}
                {t('page.dashboard.sysmgmt.doctor.failed', '失败')} {doctor.result.failed}
              </span>
              {doctor.result.issues.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-red-500 dark:text-red-400">
                  {doctor.result.issues.map((issue) => (
                    <li key={issue}>• {issue}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </SettingRow>

      <SettingRow
        label={t('page.settings.diagnostic.validate', '数据完整性验证')}
        path="eaa.validate"
        description={t('page.settings.diagnostic.validateDesc', '验证所有事件数据的完整性和一致性')}
      >
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => validate.run(() => getAPI().eaa.validate())}
            disabled={validate.status === 'running'}
            className={DIAG_BTN}
          >
            {validate.status === 'running'
              ? t('page.dashboard.sysmgmt.validate.running', '验证中...')
              : t('page.settings.diagnostic.validateBtn', '验证')}
          </button>
          {validate.result && (
            <div className="text-[10px] leading-relaxed">
              {validate.result.valid ? (
                <span className="text-emerald-500 dark:text-emerald-400">
                  ✓ {t('page.settings.diagnostic.dataIntact', '数据完整')}
                </span>
              ) : (
                <span className="text-red-500 dark:text-red-400">
                  ✗ {t('page.settings.diagnostic.issuesFound', '发现问题')}
                </span>
              )}
              <span className="text-gray-500 dark:text-gray-400 ml-2">
                {t('page.settings.diagnostic.total', '共')} {validate.result.total_events}{' '}
                {t('page.settings.diagnostic.eventsUnit', '条事件')}
                {validate.result.errors.length > 0 && (
                  <span className="text-red-500 dark:text-red-400 ml-1">
                    {t('page.dashboard.sysmgmt.validate.errors', '错误')}{' '}
                    {validate.result.errors.length}
                  </span>
                )}
                {validate.result.warnings.length > 0 && (
                  <span className="text-amber-500 dark:text-amber-400 ml-1">
                    {t('page.dashboard.sysmgmt.validate.warnings', '警告')}{' '}
                    {validate.result.warnings.length}
                  </span>
                )}
              </span>
              {validate.result.errors.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-red-500 dark:text-red-400">
                  {validate.result.errors.map((e) => (
                    <li key={e}>• {e}</li>
                  ))}
                </ul>
              )}
              {validate.result.warnings.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-amber-500 dark:text-amber-400">
                  {validate.result.warnings.map((w) => (
                    <li key={w}>• {w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </SettingRow>
    </Section>
  )
}
