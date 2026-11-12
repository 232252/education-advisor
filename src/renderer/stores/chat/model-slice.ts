// =============================================================
// 模型配置 slice — setModel / setModelContext / fetchModelInfo /
// initFromSettings / setThinkingLevel
// =============================================================

import { debugLog } from '@shared/debug'
import { getAPI } from '../../lib/ipc-client'
import type { ChatGet, ChatSet, ChatState } from './types'

export function createModelSlice(
  set: ChatSet,
  get: ChatGet,
): Pick<
  ChatState,
  'setModel' | 'setModelContext' | 'fetchModelInfo' | 'initFromSettings' | 'setThinkingLevel'
> {
  return {
    setModel: (provider, model) => {
      set({
        currentProvider: provider,
        currentModel: model,
        currentModelReasoningLevels: null,
      })
      // 异步拉模型的 contextWindow
      void get().fetchModelInfo(provider, model)
    },
    setModelContext: (contextWindow, maxOutput) =>
      set({ currentModelContext: contextWindow, currentModelMaxOutput: maxOutput }),
    /**
     * 启动时从 settings 同步当前模型(provider + model)
     * 修复 Bug-1: chatStore 初始化时 currentProvider/currentModel 是空串,
     *              不主动从 settings 拉, UI 永远显示"未设置"
     */
    initFromSettings: async () => {
      try {
        const s = await getAPI().settings.get()
        // DSH 当前路由优先；接口缺失或失败时回落到 settings，不能把已选模型丢掉
        let route: { provider?: string; model?: string } | null | undefined
        try {
          route = await getAPI().ai.getDshRoute?.()
        } catch (err) {
          console.warn('[chatStore] getDshRoute failed, falling back to settings:', err)
        }
        const provider = route?.provider || s.models?.defaultProvider || ''
        const model =
          route?.model ||
          s.models?.defaultModel ||
          s.models?.highQualityModel ||
          s.models?.lowCostModel ||
          ''
        if (provider || model) {
          set({ currentProvider: provider, currentModel: model })
          if (provider && model) {
            void get().fetchModelInfo(provider, model)
          }
        }
        // C-1 修复: 从 settings 恢复 thinkingLevel 到 UI
        const thinkingLevel = s.chat?.thinkingLevel
        if (thinkingLevel) {
          set({ thinkingLevel })
        }
      } catch (err) {
        console.warn('[chatStore] initFromSettings failed:', err)
      }
    },
    /**
     * 从主进程拉取指定模型的 contextWindow / maxOutput
     * 修复 Bug-1: 真正从用户 settings 透传,不在前端硬编码
     */
    fetchModelInfo: async (provider, model) => {
      if (!provider || !model) {
        debugLog('chat', `fetchModelInfo skipped: provider=${provider} model=${model}`)
        return
      }
      try {
        const models = await getAPI().ai.listModels(provider)
        debugLog(
          'chat',
          `fetchModelInfo: provider=${provider} model=${model} returned ${models.length} models:`,
          models.map((m) => `${m.id}@${m.contextWindow}`),
        )
        const found = models.find((m) => m.id === model)
        if (get().currentProvider !== provider || get().currentModel !== model) return
        if (found) {
          debugLog(
            'chat',
            `model matched: ${model} contextWindow=${found.contextWindow} maxOutput=${found.maxOutputTokens}`,
          )
          set({
            currentModelContext: found.contextWindow || 0,
            currentModelMaxOutput: found.maxOutputTokens || 0,
            currentModelReasoningLevels: found.reasoningLevels ?? null,
          })
        } else {
          console.warn(
            `[chatStore] model ${model} not found in listModels(${provider}); available:`,
            models.map((m) => m.id),
          )
        }
      } catch (err) {
        console.warn('[chatStore] fetchModelInfo failed:', err)
      }
    },
    setThinkingLevel: (level) => set({ thinkingLevel: level }),
  }
}
