// =============================================================
// channels/bridge/command-context — 斜杠命令上下文构造(注入 EAA + Agent 能力)
// (M3 从 feishu-bot/command-context.ts 上提,行为不变;原文件改为 re-export 壳)
// =============================================================

import type { BrowserWindow } from 'electron'
import { agentService } from '../../agent-service'
import { eaaBridge } from '../../eaa-bridge'
import type { CommandContext } from '../runtime/command/router'
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
