// =============================================================
// useBitableList — 飞书 Bitable 表列表拉取动作 handler
// 逻辑自 sections/FeishuSection.tsx 拉取按钮 onClick 逐字搬移
// =============================================================

import { useCallback } from 'react'
import { getAPI } from '../../../lib/ipc-client'

// Bitable 列表状态机的状态/动作类型(与 SettingsPage 内 useReducer 对齐)
export type BitListStatus = 'idle' | 'listing' | 'success' | 'error'
export type BitListAction =
  | { type: 'LIST' }
  | { type: 'SUCCESS' }
  | { type: 'ERROR' }
  | { type: 'RESET' }

interface UseBitableListParams {
  appId: string
  bitableAppToken: string
  dispatchBitList: (action: BitListAction) => void
  setBitableListInfo: (s: string) => void
}

export function useBitableList({
  appId,
  bitableAppToken,
  dispatchBitList,
  setBitableListInfo,
}: UseBitableListParams) {
  const handleListBitable = useCallback(async () => {
    if (!appId || !bitableAppToken) {
      setBitableListInfo('请先填写 App ID 和 Bitable App Token')
      return
    }
    setBitableListInfo('正在拉取...')
    dispatchBitList({ type: 'LIST' })
    const result = await getAPI().feishu.listBitable(appId, bitableAppToken)
    if (result.success && result.tables) {
      dispatchBitList({ type: 'SUCCESS' })
      setBitableListInfo(
        `找到 ${result.tables.length} 个表: ${result.tables.map((t) => t.name).join(', ')}`,
      )
    } else {
      dispatchBitList({ type: 'ERROR' })
      setBitableListInfo(`拉取失败 · ${result.error || '未知错误'}`)
    }
  }, [appId, bitableAppToken, dispatchBitList, setBitableListInfo])

  return handleListBitable
}
