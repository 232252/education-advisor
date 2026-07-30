// =============================================================
// 诊断 & 维护 Section — EAA 健康检查 (doctor) + 数据完整性验证 (validate)
// =============================================================

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

export interface DiagnosticSectionProps {
  doctorStatus: 'idle' | 'running' | 'done'
  doctorResult: DoctorResult | null
  setDoctorStatus: (s: 'idle' | 'running' | 'done') => void
  setDoctorResult: (r: DoctorResult | null) => void
  validateStatus: 'idle' | 'running' | 'done'
  validateResult: ValidateResult | null
  setValidateStatus: (s: 'idle' | 'running' | 'done') => void
  setValidateResult: (r: ValidateResult | null) => void
}

export function DiagnosticSection({
  doctorStatus,
  doctorResult,
  setDoctorStatus,
  setDoctorResult,
  validateStatus,
  validateResult,
  setValidateStatus,
  setValidateResult,
}: DiagnosticSectionProps) {
  return (
    <Section title="诊断 & 维护">
      <SettingRow
        label="EAA 健康检查"
        path="eaa.doctor"
        description="检查 EAA 引擎运行环境、数据完整性、配置正确性"
      >
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={async () => {
              setDoctorStatus('running')
              setDoctorResult(null)
              try {
                const result = await getAPI().eaa.doctor()
                if (result.success && result.data) {
                  setDoctorResult(
                    result.data as {
                      healthy: boolean
                      passed: number
                      failed: number
                      issues: string[]
                    },
                  )
                } else {
                  setDoctorResult({
                    healthy: false,
                    passed: 0,
                    failed: 0,
                    issues: [(result as { stderr?: string }).stderr || '未知错误'],
                  })
                }
              } catch (err) {
                setDoctorResult({ healthy: false, passed: 0, failed: 0, issues: [String(err)] })
              } finally {
                setDoctorStatus('done')
              }
            }}
            disabled={doctorStatus === 'running'}
            className={cn(
              btnStyle('secondary'),
              'text-xs bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20',
            )}
          >
            {doctorStatus === 'running' ? '检查中...' : '运行检查'}
          </button>
          {doctorResult && (
            <div className="text-[10px] leading-relaxed">
              {doctorResult.healthy ? (
                <span className="text-emerald-500 dark:text-emerald-400">✓ 健康</span>
              ) : (
                <span className="text-rose-500 dark:text-rose-400">✗ 异常</span>
              )}
              <span className="text-gray-500 dark:text-gray-400 ml-2">
                通过 {doctorResult.passed} / 失败 {doctorResult.failed}
              </span>
              {doctorResult.issues.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-rose-500 dark:text-rose-400">
                  {doctorResult.issues.map((issue) => (
                    <li key={issue}>• {issue}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </SettingRow>

      <SettingRow
        label="数据完整性验证"
        path="eaa.validate"
        description="验证所有事件数据的完整性和一致性"
      >
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={async () => {
              setValidateStatus('running')
              setValidateResult(null)
              try {
                const result = await getAPI().eaa.validate()
                if (result.success && result.data) {
                  setValidateResult(
                    result.data as {
                      valid: boolean
                      total_events: number
                      errors: string[]
                      warnings: string[]
                    },
                  )
                } else {
                  setValidateResult({
                    valid: false,
                    total_events: 0,
                    errors: ['验证失败'],
                    warnings: [],
                  })
                }
              } catch (err) {
                setValidateResult({
                  valid: false,
                  total_events: 0,
                  errors: [String(err)],
                  warnings: [],
                })
              } finally {
                setValidateStatus('done')
              }
            }}
            disabled={validateStatus === 'running'}
            className={cn(
              btnStyle('secondary'),
              'text-xs bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20',
            )}
          >
            {validateStatus === 'running' ? '验证中...' : '验证'}
          </button>
          {validateResult && (
            <div className="text-[10px] leading-relaxed">
              {validateResult.valid ? (
                <span className="text-emerald-500 dark:text-emerald-400">✓ 数据完整</span>
              ) : (
                <span className="text-rose-500 dark:text-rose-400">✗ 发现问题</span>
              )}
              <span className="text-gray-500 dark:text-gray-400 ml-2">
                共 {validateResult.total_events} 条事件
                {validateResult.errors.length > 0 && (
                  <span className="text-rose-500 dark:text-rose-400 ml-1">
                    错误 {validateResult.errors.length}
                  </span>
                )}
                {validateResult.warnings.length > 0 && (
                  <span className="text-amber-500 dark:text-amber-400 ml-1">
                    警告 {validateResult.warnings.length}
                  </span>
                )}
              </span>
              {validateResult.errors.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-rose-500 dark:text-rose-400">
                  {validateResult.errors.map((e) => (
                    <li key={e}>• {e}</li>
                  ))}
                </ul>
              )}
              {validateResult.warnings.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-amber-500 dark:text-amber-400">
                  {validateResult.warnings.map((w) => (
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
