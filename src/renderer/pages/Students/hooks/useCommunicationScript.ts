// =============================================================
// useCommunicationScript — 家校沟通话术生成 hook
// 按场景×语气构建 prompt,调用所选 Agent 生成话术;
// 流式输出经 agentStore 派生订阅收集,agentId 过滤防串扰。
// =============================================================

import type { AgentListItem, EAAHistoryEvent, EAAStudent, StudentProfileData } from '@shared/types'
import { useRef, useState } from 'react'
import { useAutoDismiss } from '../../../hooks/useAutoDismiss'
import { getAPI } from '../../../lib/ipc-client'
import { useAgentStore } from '../../../stores/agentStore'
import { buildCommunicationPrompt, type CommScenario, type CommTone } from '../lib/home-school'

export function useCommunicationScript(
  student: EAAStudent,
  events: EAAHistoryEvent[],
  profileData: StudentProfileData,
  agents: AgentListItem[],
) {
  const mountedRef = useRef(true)
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState('')
  const [message, setMessage] = useState('')
  const setMessageAuto = useAutoDismiss<string>(setMessage, '')
  const [agentId, setAgentId] = useState<string>('')
  const [scenario, setScenario] = useState<CommScenario>('phone')
  const [tone, setTone] = useState<CommTone>('praise')
  const [generatedAt, setGeneratedAt] = useState<number | null>(null)

  // 默认选中第一个启用的 agent
  const effectiveAgentId =
    agentId && agents.some((a) => a.id === agentId)
      ? agentId
      : (agents.find((a) => a.enabled)?.id ?? '')

  const generate = async () => {
    if (!effectiveAgentId) {
      setMessageAuto('没有可用的 Agent，请先在「Agent」页启用')
      return
    }
    const prompt = buildCommunicationPrompt({ student, events, profileData }, scenario, tone)
    setRunning(true)
    setOutput('')

    const unsub = useAgentStore.getState().subscribeStatus((data) => {
      if (data.agentId !== effectiveAgentId) return
      if (data.output) setOutput((prev) => prev + data.output)
      if (data.error) setOutput((prev) => `${prev}\n[错误] ${data.error}\n`)
    })

    try {
      await getAPI().agent.runManual(effectiveAgentId, prompt)
      // 等待流式输出收尾(与 useAgentAnalysis 相同的节奏)
      await new Promise((r) => setTimeout(r, 1500))
      if (mountedRef.current) {
        setGeneratedAt(Date.now())
        setMessageAuto('话术已生成')
      }
    } catch (err) {
      if (mountedRef.current)
        setMessageAuto(`生成失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      unsub()
      if (mountedRef.current) setRunning(false)
    }
  }

  return {
    scenario,
    setScenario,
    tone,
    setTone,
    agentId: effectiveAgentId,
    setAgentId,
    running,
    output,
    message,
    generatedAt,
    generate,
  }
}
