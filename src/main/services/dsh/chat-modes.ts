// =============================================================
// 对话模式预设表 — 模式 = 一组 cordis 行开关（稳定面，升级友好）
//
// 教师端自己的「模式表」，与连接中心 im-preset 同一套路：每个模式只是
// 对官方行 id 的开关/配置覆盖，不碰 DSH 源码、不 insert 新行、不含密钥。
// 模式 patch 排在加固层之后（同 id 后写覆盖，官方 patch 层顺序约定）。
//
// - standard：空表。与现行加固完全一致（plan-mode 关、native 执行器）。
// - plan：重开 plan-mode 行并给 section 引导。计划评审走已接好的
//   user-question 通道（intent=plan-review），教师批准才执行。
//   注意：plan 模式不限制工具（官方语义），强制限制仍靠加固+沙箱。
// - ptc：互换两执行器行开关，模型可见 run_code（代码编排工具）。
//   教师显式选择才启用；默认永远 standard。
//
// 升级纪律：这里只允许出现已登记的行 id；DSH 新增行由
// dsh-tool-row-audit 门禁揭出，不在此静默放行。
// =============================================================

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify } from 'yaml'
import type { EaaCordisPatchRow } from './hardening'

export const CHAT_MODES = ['standard', 'plan', 'ptc'] as const
export type ChatMode = (typeof CHAT_MODES)[number]

export const EAA_CHAT_MODE_PATCH_FILE = 'eaa-chat-mode.cordis.patch.yml'

/** plan-mode 唯一必填配置：规划期渲染给模型的引导段（官方 schema 只收 section）。 */
const PLAN_SECTION = `你正处于计划模式。先充分探索与设计，不要直接执行改动。
把完整计划用 markdown 写成（以标题开头），通过 exit_plan_mode 提交给教师评审。
教师批准后才可以执行；教师要求继续规划时，按反馈完善计划再次提交。
计划要具体到步骤、涉及的数据与风险，让教师能据此作出决定。`

export function normalizeChatMode(value: unknown): ChatMode {
  return CHAT_MODES.includes(value as ChatMode) ? (value as ChatMode) : 'standard'
}

/** 模式的行开关表。standard 为空数组＝不改任何行。 */
export function chatModeRows(mode: ChatMode): EaaCordisPatchRow[] {
  switch (mode) {
    case 'plan':
      return [{ id: 'plan-mode', disabled: false, config: { section: PLAN_SECTION } }]
    case 'ptc':
      return [
        { id: 'tool-executor-native', disabled: true },
        { id: 'tool-executor-ptc', disabled: false },
      ]
    default:
      return []
  }
}

export function buildChatModePatch(mode: string): string {
  return stringify(chatModeRows(normalizeChatMode(mode)), { lineWidth: 0 })
}

/**
 * 落盘并返回路径；standard 返回 null（不带这层，沿用加固原样）。
 * 内容一致不重写（与 hardening 同款幂等写法）。
 */
export function ensureChatModePatch(patchDir: string, mode: string): string | null {
  const normalized = normalizeChatMode(mode)
  if (normalized === 'standard') return null
  const patchPath = join(patchDir, EAA_CHAT_MODE_PATCH_FILE)
  const text = buildChatModePatch(normalized)
  let current: string | null = null
  try {
    current = readFileSync(patchPath, 'utf8')
  } catch {
    current = null
  }
  if (current !== text) writeFileSync(patchPath, text, 'utf8')
  return patchPath
}
