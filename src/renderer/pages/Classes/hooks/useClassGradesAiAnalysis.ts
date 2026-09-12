// =============================================================
// useClassGradesAiAnalysis — run academic (or first enabled) agent
// with a prefilled class-grades aggregate prompt. Reuses
// useAgentStreamOutput + agent.runManual (same path as student AI).
// =============================================================

import type { AgentListItem } from '@shared/types'
import { useCallback, useEffect, useState } from 'react'
import { useAgentStreamOutput } from '../../../hooks/useAgentStreamOutput'
import { useAutoDismiss } from '../../../hooks/useAutoDismiss'
import { useMountedRef } from '../../../hooks/useMountedRef'
import { useT } from '../../../i18n'
import { errText, getAPI } from '../../../lib/ipc-client'
import {
  buildClassGradesAiPrompt,
  type ClassGradesAiPromptInput,
  pickClassGradesAiAgentId,
} from '../lib/class-grades-ai-prompt'

export function useClassGradesAiAnalysis() {
  const { t } = useT()
  const mountedRef = useMountedRef()
  const [agents, setAgents] = useState<AgentListItem[]>([])
  const [agentsReady, setAgentsReady] = useState(false)
  const [running, setRunning] = useState(false)
  const { output, resetOutput, startSession } = useAgentStreamOutput()
  const [message, setMessage] = useState('')
  const setMessageAuto = useAutoDismiss<string>(setMessage, '')
  const [lastAgentId, setLastAgentId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await getAPI().agent.list()
        if (!cancelled && mountedRef.current) {
          setAgents(Array.isArray(list) ? list : [])
          setAgentsReady(true)
        }
      } catch {
        if (!cancelled && mountedRef.current) {
          setAgents([])
          setAgentsReady(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mountedRef])

  const agentId = pickClassGradesAiAgentId(agents)
  const agentMeta = agents.find((a) => a.id === agentId) ?? null

  const run = useCallback(
    async (input: ClassGradesAiPromptInput) => {
      if (!agentId) {
        setMessageAuto(
          t('page.classes.grades.ai.noAgent', '没有可用的 Agent，请先在「Agent」页启用学业分析师'),
        )
        return
      }
      const prompt = buildClassGradesAiPrompt(input)
      setRunning(true)
      resetOutput()
      setLastAgentId(agentId)
      const session = startSession({
        filter: (id) => id === agentId,
        onResult: (durationMs) =>
          `\n\n--- ${t('page.students.ai.executed', '执行完成')} (${durationMs}ms) ---\n`,
      })
      try {
        await getAPI().agent.runManual(agentId, prompt)
        await session.settle()
        if (mountedRef.current) {
          setMessageAuto(t('page.classes.grades.ai.done', '班级 AI 分析完成'))
        }
      } catch (err) {
        if (mountedRef.current) {
          setMessageAuto(`${t('page.classes.grades.ai.failed', '分析失败')}: ${errText(err)}`)
        }
      } finally {
        session.finish()
        if (mountedRef.current) setRunning(false)
      }
    },
    [agentId, mountedRef, resetOutput, setMessageAuto, startSession, t],
  )

  const clear = useCallback(() => {
    resetOutput()
    setMessage('')
  }, [resetOutput])

  return {
    agentsReady,
    agentId,
    agentName: agentMeta?.name ?? agentId,
    running,
    output,
    message,
    lastAgentId,
    run,
    clear,
  }
}
