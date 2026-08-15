// =============================================================
// feishu-bot/command-context — 斜杠命令上下文构造(注入 EAA + Agent 能力)
// 从 feishu-bot-service.ts 拆出(纯重构,行为不变)
// =============================================================

import type { BrowserWindow } from 'electron'
import { agentService } from '../agent-service'
import { eaaBridge } from '../eaa-bridge'
import type { CommandContext } from '../feishu-command-router'
import { runAgentAndCollect } from './agent-runner'

/** 构造命令上下文(注入 EAA + Agent 能力) */
export function createCommandContext(win: BrowserWindow | null): CommandContext {
  return {
    runEAA: async (command, args = []) => {
      return eaaBridge.execute({ command, args })
    },
    listAgents: () =>
      agentService
        .listAgents()
        .filter((a) => a.enabled)
        .map((a) => ({ id: a.id, name: a.name, description: a.description })),
    runAgent: (prompt) => runAgentAndCollect(prompt, win),
  }
}
