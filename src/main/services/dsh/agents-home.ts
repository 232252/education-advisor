// =============================================================
// 每个角色一份 DSH 能读的 AGENTS.md
//
// dsh-base 的 agent-instructions 从 $DSH_HOME 和 $DSH_AGENTS_HOME
// 加载 AGENTS.md，不走 session/prompt 的 system 角色。多个角色共用
// 一个 DSH_HOME，所以角色说明写到各自的 agents 目录，只让这一次子进程
// 的 DSH_AGENTS_HOME 指过去。
// =============================================================

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { readInstalledRowConfig } from './hardening'

export const EAA_AGENTS_BUDGET_PATCH_FILE = 'eaa-agents-instructions.cordis.patch.yml'

/** 官方默认 64KiB。教育提示更长，只提高这一行的上限，不改其它配置。 */
export const EAA_AGENTS_INSTRUCTION_BYTES = 262144

export function writeRoleAgentsHome(dshHome: string, roleId: string, instructions: string): string {
  const safe =
    roleId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'agent'
  const home = join(dshHome, 'agents', safe)
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'AGENTS.md'), instructions, 'utf8')
  return home
}

export function buildAgentsInstructionBudgetPatch(installed?: Record<string, unknown>): string {
  return stringify(
    [
      {
        id: 'agent-instructions',
        config: { ...(installed ?? {}), maxBytes: EAA_AGENTS_INSTRUCTION_BYTES },
      },
    ],
    { lineWidth: 0 },
  )
}

export function ensureAgentsInstructionBudget(patchDir: string, dshBin?: string): string {
  const patchPath = join(patchDir, EAA_AGENTS_BUDGET_PATCH_FILE)
  const installed = readInstalledRowConfig(dshBin, '@deepseek-ai/dsh-base', 'agent-instructions')
  writeFileSync(patchPath, buildAgentsInstructionBudgetPatch(installed), 'utf8')
  return patchPath
}
