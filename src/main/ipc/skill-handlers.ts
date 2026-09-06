// =============================================================
// 技能 IPC 处理器
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { BrowserWindow } from 'electron'
import { skillService } from '../services/skill-service'
import { handleIpc } from './handle'

export function registerSkillHandlers(_win: BrowserWindow) {
  handleIpc(
    IPC.IPC_SKILL_LIST,
    () => skillService.listSkills(),
    () => [],
  )

  // F3 模式: 渲染层契约是 Skill | null,错误时返回 null 而非形状不符的对象
  handleIpc(
    IPC.IPC_SKILL_GET,
    (_e, name: string) => skillService.getSkill(name),
    () => null,
  )

  handleIpc(IPC.IPC_SKILL_SAVE, (_e, name: string, content: string) =>
    skillService.saveSkill(name, content),
  )

  handleIpc(IPC.IPC_SKILL_DELETE, (_e, name: string) => skillService.deleteSkill(name))

  console.log('[IPC] Skill handlers registered')
}
