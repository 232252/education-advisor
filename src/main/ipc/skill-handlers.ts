// =============================================================
// 技能 IPC 处理器
// =============================================================

import { type BrowserWindow, ipcMain } from 'electron'
import * as IPC from '../../shared/ipc-channels'
import { skillService } from '../services/skill-service'

export function registerSkillHandlers(_win: BrowserWindow) {
  ipcMain.handle(IPC.IPC_SKILL_LIST, async () => {
    return skillService.listSkills()
  })

  ipcMain.handle(IPC.IPC_SKILL_GET, async (_e, name: string) => {
    return skillService.getSkill(name)
  })

  ipcMain.handle(IPC.IPC_SKILL_SAVE, async (_e, name: string, content: string) => {
    return skillService.saveSkill(name, content)
  })

  ipcMain.handle(IPC.IPC_SKILL_DELETE, async (_e, name: string) => {
    return skillService.deleteSkill(name)
  })

  console.log('[IPC] Skill handlers registered')
}
