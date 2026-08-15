// =============================================================
// AI 自定义模型管理 handler — 添加/删除/更新
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { ipcMain } from 'electron'
import { piAIService } from '../../services/pi-ai-service'

export function registerAICustomModelHandlers(): void {
  // ----- 自定义模型管理 -----
  // H-10 修复: 加 try-catch
  // R78 修复: 加参数校验,providerId/modelId 必须为非空字符串,
  // 防止存储到 undefined 键导致脏数据和后续 list/update/delete 异常
  ipcMain.handle(
    IPC.IPC_AI_ADD_CUSTOM_MODEL,
    async (
      _e,
      params: {
        providerId: string
        modelId: string
        name?: string
        contextWindow?: number
        maxOutputTokens?: number
        supportsReasoning?: boolean
      },
    ) => {
      try {
        // R78: 参数校验 — providerId/modelId 必须为非空字符串
        if (typeof params?.providerId !== 'string' || params.providerId.trim().length === 0) {
          return { success: false, error: 'providerId is required and must be a non-empty string' }
        }
        if (typeof params?.modelId !== 'string' || params.modelId.trim().length === 0) {
          return { success: false, error: 'modelId is required and must be a non-empty string' }
        }
        return piAIService.addCustomModel(params.providerId, {
          id: params.modelId,
          name: params.name,
          contextWindow: params.contextWindow,
          maxOutputTokens: params.maxOutputTokens,
          supportsReasoning: params.supportsReasoning,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(
          `[IPC] ai:add-custom-model failed for "${params.providerId}/${params.modelId}":`,
          msg,
        )
        return { success: false, error: msg }
      }
    },
  )

  // H-10 修复: 加 try-catch
  ipcMain.handle(IPC.IPC_AI_DEL_CUSTOM_MODEL, async (_e, providerId: string, modelId: string) => {
    try {
      const removed = piAIService.removeCustomModel(providerId, modelId)
      return { success: removed }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] ai:del-custom-model failed for "${providerId}/${modelId}":`, msg)
      return { success: false, error: msg }
    }
  })

  // H-10 修复: 加 try-catch
  ipcMain.handle(
    IPC.IPC_AI_UPDATE_CUSTOM_MODEL,
    async (
      _e,
      params: {
        providerId: string
        modelId: string
        name?: string
        contextWindow?: number
        maxOutputTokens?: number
        supportsReasoning?: boolean
        costPerInputToken?: number
        costPerOutputToken?: number
        api?: string
        baseUrl?: string
      },
    ) => {
      try {
        const updated = piAIService.updateCustomModel(params.providerId, params.modelId, {
          name: params.name,
          contextWindow: params.contextWindow,
          maxOutputTokens: params.maxOutputTokens,
          supportsReasoning: params.supportsReasoning,
          costPerInputToken: params.costPerInputToken,
          costPerOutputToken: params.costPerOutputToken,
          api: params.api,
          baseUrl: params.baseUrl,
        })
        return { success: updated }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(
          `[IPC] ai:update-custom-model failed for "${params.providerId}/${params.modelId}":`,
          msg,
        )
        return { success: false, error: msg }
      }
    },
  )
}
