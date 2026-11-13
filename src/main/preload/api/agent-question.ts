// =============================================================
// Preload API — 智能体提问（dsh 运行时向教师澄清）
// =============================================================

import type { AgentQuestionAPI } from '@shared/api/agent-question'
import * as IPC from '@shared/ipc-channels'
import { ipcInvoke } from '@shared/ipc-runtime'
import { subscribe } from './subscribe'

export const agentQuestionApi: AgentQuestionAPI = {
  respond: (requestId, result) => ipcInvoke(IPC.IPC_AGENT_QUESTION_RESPOND, requestId, result),
  onRequest: (callback) => subscribe(IPC.IPC_AGENT_QUESTION_REQUEST, callback),
}
