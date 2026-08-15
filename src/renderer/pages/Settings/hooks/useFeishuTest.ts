// =============================================================
// useFeishuTest — 飞书"测试连接"动作 handler
// 逻辑自 sections/FeishuSection.tsx 测试按钮 onClick 逐字搬移
// =============================================================

import { useCallback } from 'react'
import { getAPI } from '../../../lib/ipc-client'

export type FeishuTestStatus = 'idle' | 'testing' | 'success' | 'error'

interface UseFeishuTestParams {
  appId: string
  setFeishuTestStatus: (s: FeishuTestStatus) => void
  setFeishuTestInfo: (s: string) => void
}

export function useFeishuTest({
  appId,
  setFeishuTestStatus,
  setFeishuTestInfo,
}: UseFeishuTestParams) {
  const handleTestConnection = useCallback(async () => {
    if (!appId) {
      setFeishuTestStatus('error')
      setFeishuTestInfo('请先填写 App ID')
      return
    }
    setFeishuTestStatus('testing')
    setFeishuTestInfo('正在测试...')
    // appSecret 从 keystore 读取，不再通过参数传递
    const result = await getAPI().feishu.test(appId)
    if (result.success) {
      setFeishuTestStatus('success')
      // R6-2 修复: 不在 UI 显示 token 明文,避免敏感信息泄露
      setFeishuTestInfo(`连接成功 · 过期 ${result.expireSec}s`)
    } else {
      setFeishuTestStatus('error')
      // 防御: 错误信息可能是对象, 统一转字符串避免 UI 显示 "[object Object]"
      setFeishuTestInfo(
        `连接失败 · ${typeof result.error === 'string' ? result.error : JSON.stringify(result.error)}`,
      )
    }
  }, [appId, setFeishuTestStatus, setFeishuTestInfo])

  return handleTestConnection
}
