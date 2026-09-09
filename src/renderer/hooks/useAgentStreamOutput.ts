// =============================================================
// useAgentStreamOutput — 手动 agent 运行的流式输出收集
// (useAgentAnalysis 与 useCommunicationScript 此前的同构骨架收敛)
//
// 收尾节奏(单点维护): runManual 的 IPC 是「已启动即 resolve」,
// 不能用固定等待——改为事件驱动: settle() 等 filter 命中的 agent
// 进入终态(idle/error)才放行,封顶 SETTLE_TIMEOUT_MS 防挂死。
// =============================================================

import { useState } from 'react'
import { t } from '../i18n'
import { useAgentStore } from '../stores/agent/store'

/** settle 的兜底封顶: 终态事件丢失(崩溃等)时不至于永久挂起 */
const SETTLE_TIMEOUT_MS = 120_000

export interface AgentStreamSession {
  /** 追加一段文本到输出(如每个 agent 的标题行) */
  append: (chunk: string) => void
  /** runManual resolve 后,等 agent 进入终态再放行 */
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
      settle: () =>
        new Promise<void>((resolve) => {
          let done = false
          const finish = () => {
            if (done) return
            done = true
            clearTimeout(cap)
            watchUnsub()
            resolve()
          }
          const cap = setTimeout(finish, SETTLE_TIMEOUT_MS)
          const watchUnsub = useAgentStore.getState().subscribeStatus((data) => {
            if (!filter(data.agentId)) return
            if (data.status === 'idle' || data.status === 'error') finish()
          })
        }),
      finish: unsub,
    }
  }

  return { output, resetOutput, startSession }
}
