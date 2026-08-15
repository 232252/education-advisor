// =============================================================
// Agent 运行 slice — runAgent / abortAgent / clearOutput
// =============================================================

import { getAPI } from '../../lib/ipc-client'
import { toast } from '../toastStore'
import { _flushLiveOutputNow, resetLiveOutputBuffer } from './live-output'
import type { AgentSet, AgentState } from './types'

export function createRunSlice(
  set: AgentSet,
): Pick<AgentState, 'runAgent' | 'abortAgent' | 'clearOutput'> {
  return {
    runAgent: async (id, prompt) => {
      // PERF: 启动新 run 前先 flush 旧输出并清空批处理缓冲
      _flushLiveOutputNow(set)
      resetLiveOutputBuffer()
      set({
        liveOutput: '',
        liveToolCalls: [],
        isRunning: true,
        lastExecution: null,
        lastError: null,
      })
      try {
        await getAPI().agent.runManual(id, prompt)
      } catch (err) {
        console.error('[AgentStore] Failed to run agent:', err)
        toast.error('执行 Agent 失败')
        set({ isRunning: false })
      }
    },

    abortAgent: async (id) => {
      try {
        await getAPI().agent.abort(id)
        set({ isRunning: false })
      } catch (err) {
        console.error('[AgentStore] Failed to abort agent:', err)
        toast.error('中止 Agent 失败')
      }
    },

    clearOutput: () => {
      // PERF: 清理批处理缓冲,避免遗留的 timer 在 clear 后再次 set
      resetLiveOutputBuffer()
      set({ liveOutput: '', liveToolCalls: [], lastExecution: null, lastError: null })
    },
  }
}
