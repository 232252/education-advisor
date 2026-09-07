// =============================================================
// OnboardingWizard — 首用向导壳(常驻 entry 的轻检测层)
// 触发: 无 localStorage 完成标记 且 当前无任何班级(判定为首次使用)。
// 判定通过才懒加载向导本体(OnboardingWizardBody + 5 个步骤 UI,
// 共 ~1000 行) — 老用户/已引导会话零加载成本;查询失败不打扰用户
// (下次启动重试,不标记)。
// =============================================================

import { lazy, Suspense, useEffect, useState } from 'react'
import { getAPI } from '../../lib/ipc-client'
import { markOnboardingDone, ONBOARDING_DONE_KEY } from './onboarding-done'

const WizardBody = lazy(() =>
  import('./OnboardingWizardBody').then((m) => ({ default: m.OnboardingWizardBody })),
)

export function OnboardingWizard() {
  const [needed, setNeeded] = useState(false)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        if (localStorage.getItem(ONBOARDING_DONE_KEY) === '1') return
        const res = await getAPI().class.list()
        if (!res.success) return
        if (Array.isArray(res.data) && res.data.length > 0) {
          // 已有班级 → 老用户,静默标记
          markOnboardingDone()
          return
        }
        if (!cancelled) setNeeded(true)
      } catch {
        /* 检测失败不打扰用户 */
      }
    }
    void check()
    return () => {
      cancelled = true
    }
  }, [])

  if (!needed) return null
  return (
    <Suspense fallback={null}>
      <WizardBody />
    </Suspense>
  )
}
