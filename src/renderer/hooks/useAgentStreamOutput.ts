// =============================================================
// useAgentStreamOutput — 手动 agent 运行的流式输出收集
// (useAgentAnalysis 与 useCommunicationScript 此前的同构骨架收敛)
//
// 已知脆弱点(单点维护): runManual 的 IPC resolve 先于最后一个
// status 事件到达,靠 1500ms 固定等待收尾;将来改事件驱动
// (以 idle/result 事件收尾)时只需改本文件的 settle 实现。
// =============================================================

import { useState } from 'react'
import { t } from '../i18n'
import { useAgentStore } from '../stores/agent/store'

/** runManual resolve 后等待流式事件收尾的固定节奏 */
const STREAM_SETTLE_MS = 1500

export interface AgentStreamSession {
  /** 追加一段文本到输出(如每个 agent 的标题行) */
  append: (chunk: string) => void
  /** runManual resolve 后等待流式输出收尾 */
  settle: () => Promise<void>
  /** 结束收集并退订 */
  finish: () => void
}

interface StartSessionOptions {
  /** 只收集命中此谓词的 agent 事件(防其他 agent 串扰) */
  filter: (agentId: string) => boolean
  /** 拿到执行结果时追加的分隔行文案(如「执行完成 (123ms)」) */
  onResult?: (durationMs: number) => string
}

export function useAgentStreamOutput() {
  const [output, setOutput] = useState('')

  const resetOutput = () => setOutput('')

  const startSession = ({ filter, onResult }: StartSessionOptions): AgentStreamSession => {
    const unsub = useAgentStore.getState().subscribeStatus((data) => {
      if (!filter(data.agentId)) return
      if (data.output) {
        setOutput((prev) => prev + data.output)
      }
      if (data.result && onResult) {
        const { durationMs } = data.result
        setOutput((prev) => prev + onResult(durationMs))
      }
      if (data.error) {
        setOutput((prev) => `${prev}\n[${t('common.error', '错误')}] ${data.error}\n`)
      }
    })
    return {
      append: (chunk: string) => setOutput((prev) => prev + chunk),
      settle: () => new Promise<void>((r) => setTimeout(r, STREAM_SETTLE_MS)),
      finish: unsub,
    }
  }

  return { output, resetOutput, startSession }
}
