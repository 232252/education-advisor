// =============================================================
// useDashboardActions — Dashboard 系统管理 & 诊断动作
// 职责：健康检查(doctor) / 数据验证(validate) / 事件重放(replay) /
// 导出 HTML 仪表盘的运行状态与 IPC 调用（toast 反馈）。
// =============================================================

import type { EAADoctorData, EAAValidateData } from '@shared/types'
import { useCallback, useState } from 'react'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'

export function useDashboardActions() {
  const { t } = useT()
  // 系统管理 & 诊断（仅本页使用的局部状态）
  const [doctorData, setDoctorData] = useState<EAADoctorData | null>(null)
  const [doctorRunning, setDoctorRunning] = useState(false)
  const [validateData, setValidateData] = useState<EAAValidateData | null>(null)
  const [validateRunning, setValidateRunning] = useState(false)

  // 健康检查
  const runDoctor = useCallback(async () => {
    setDoctorRunning(true)
    try {
      const res = await getAPI().eaa.doctor()
      if (res.success && res.data) setDoctorData(res.data)
      else toast.error(t('error.unknown'))
    } catch {
      toast.error(t('error.unknown'))
    } finally {
      setDoctorRunning(false)
    }
  }, [t])

  // 数据验证
  const runValidate = useCallback(async () => {
    setValidateRunning(true)
    try {
      const res = await getAPI().eaa.validate()
      if (res.success && res.data) setValidateData(res.data)
      else toast.error(t('error.unknown'))
    } catch {
      toast.error(t('error.unknown'))
    } finally {
      setValidateRunning(false)
    }
  }, [t])

  // 事件重放（重建聚合数据）
  const replayEvents = useCallback(async () => {
    try {
      const res = await getAPI().eaa.replay()
      if (res.success) toast.success(t('page.dashboard.sysmgmt.replay.success'))
      else toast.error(t('error.unknown'))
    } catch {
      toast.error(t('error.unknown'))
    }
  }, [t])

  // 导出 HTML 仪表盘
  const exportHtmlDashboard = useCallback(async () => {
    try {
      const res = await getAPI().eaa.dashboard()
      if (res.success)
        toast.success(
          res.data
            ? `HTML 仪表盘已生成: ${res.data}`
            : t('page.dashboard.sysmgmt.dashboard.success'),
        )
      else toast.error(res.stderr || t('error.unknown'))
    } catch {
      toast.error(t('error.unknown'))
    }
  }, [t])

  return {
    doctorData,
    doctorRunning,
    runDoctor,
    validateData,
    validateRunning,
    runValidate,
    replayEvents,
    exportHtmlDashboard,
  }
}
