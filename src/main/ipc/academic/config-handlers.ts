// =============================================================
// Academic 配置 handler — 学业配置读取(科目定义/考试类型)
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { ipcMain } from 'electron'
import { academicService } from '../../services/academic-service'
import { academicCache } from './cache'

export function registerAcademicConfigHandlers(): void {
  // 读取学业配置
  ipcMain.handle(IPC.IPC_ACADEMIC_GET_CONFIG, async () => {
    try {
      // R136 优化: TTL 缓存命中直接返回, 避免重复 readFile config.json
      const cacheKey = 'config'
      const cached = academicCache.config.get(cacheKey)
      if (cached) {
        return { success: true, data: cached }
      }
      const data = await academicService.getConfig()
      academicCache.config.set(cacheKey, data)
      return { success: true, data }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] academic:get-config failed:', msg)
      return { success: false, error: msg }
    }
  })
}
