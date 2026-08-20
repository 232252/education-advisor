// =============================================================
// 技能 IPC 处理器
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { type BrowserWindow, ipcMain } from 'electron'
import { skillService } from '../services/skill-service'

export function registerSkillHandlers(_win: BrowserWindow) {
  ipcMain.handle(IPC.IPC_SKILL_LIST, async () => {
    try {
      return skillService.listSkills()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] skill:list failed:', msg)
      return []
    }
  })

  ipcMain.handle(IPC.IPC_SKILL_GET, async (_e, name: string) => {
    try {
      return skillService.getSkill(name)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] skill:get failed:', msg)
      // F3 模式: 渲染层契约是 Skill | null,错误时返回 null 而非形状不符的对象
      return null
    }
  })

  ipcMain.handle(IPC.IPC_SKILL_SAVE, async (_e, name: string, content: string) => {
    try {
      return skillService.saveSkill(name, content)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] skill:save failed:', msg)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(IPC.IPC_SKILL_DELETE, async (_e, name: string) => {
    try {
      return skillService.deleteSkill(name)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] skill:delete failed:', msg)
      return { success: false, error: msg }
    }
  })

  console.log('[IPC] Skill handlers registered')
}
