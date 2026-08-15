// =============================================================
// useAgentAnalysis — 学生 AI 分析域 hook
// 合并 StudentProfile 中几乎重复的 runSelectedAgents/runAllAgents
// 为单一 runAgents 实现,保留:
//   - mountedRef 防卸载（R95）
//   - agentStore.subscribeStatus 订阅 + agentId 过滤（High 修复）
//   - 串行执行 + 1500ms 流式输出等待
//   - 完整错误处理
// 并暴露 selectedAgents/toggleAgent/aiRunning/aiOutput/aiMessage/
// aiSaved/saveAiResult 供 AIAnalysisTab 使用。
// =============================================================

import type { AgentListItem, EAAStudent, StudentProfileData } from '@shared/types'
import { useEffect, useRef, useState } from 'react'
import { useAutoDismiss } from '../../../hooks/useAutoDismiss'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { useAgentStore } from '../../../stores/agentStore'
import { toast } from '../../../stores/toastStore'

export function useAgentAnalysis(
  student: EAAStudent,
  agents: AgentListItem[],
  profileData: StudentProfileData,
) {
  const { t } = useT()
  // R95 修复: mountedRef 防止异步 agent 分析循环在组件卸载后继续调用 setState
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set())
  const [aiRunning, setAiRunning] = useState(false)
  const [aiOutput, setAiOutput] = useState('')
  const [aiMessage, setAiMessage] = useState('')
  const setAiMessageAuto = useAutoDismiss<string>(setAiMessage, '')
  const [aiSaved, setAiSaved] = useState(false)

  const toggleAgent = (id: string) => {
    setSelectedAgents((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // 串行运行指定 agent 集合（runSelectedAgents/runAllAgents 的合并实现）
  const runAgents = async (agentIds: string[]) => {
    setAiRunning(true)
    setAiOutput('')
    setAiSaved(false)

    // High 修复: 改用 agentStore.subscribeStatus 派生订阅,并通过 agentId 过滤避免事件串扰
    // 之前直接 getAPI().agent.onStatusUpdate 会绕过 agentStore 的去重逻辑,
    // 多个组件同时订阅时收到重复事件;且不过滤 agentId 时,其他 agent 的事件会串扰到此处
    const runningAgentIds = new Set(agentIds)
    const unsub = useAgentStore.getState().subscribeStatus((data) => {
      // 仅处理当前选中的 agent 发出的状态事件
      if (!runningAgentIds.has(data.agentId)) return
      if (data.output) {
        setAiOutput((prev) => prev + data.output)
      }
      if (data.result) {
        setAiOutput((prev) => `${prev}\n\n--- 执行完成 (${data.result?.durationMs}ms) ---\n`)
      }
      if (data.error) {
        setAiOutput((prev) => `${prev}\n[错误] ${data.error}\n`)
      }
    })

    try {
      for (const agentId of agentIds) {
        // R95 修复: 组件卸载后立即中止循环,不再调用 setState
        if (!mountedRef.current) break
        setAiOutput((prev) => `${prev}\n=== 🤖 ${agentId} ===\n`)
        const prompt = `请分析学生"${student.name}"的操行情况。基本信息：- 分数：${student.score}\n- 风险等级：${student.risk}\n- 事件数：${student.events_count}\n\n请从以下维度进行分析：\n1. 操行总结\n2. 风险预警\n3. 行为模式\n4. 教育建议`
        await getAPI().agent.runManual(agentId, prompt)
        // 等待一段时间让流式输出到达
        await new Promise((r) => setTimeout(r, 1500))
      }
      if (mountedRef.current) setAiMessageAuto('AI 分析完成')
    } catch (err) {
      if (mountedRef.current)
        setAiMessageAuto(`分析失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      unsub()
      if (mountedRef.current) setAiRunning(false)
    }
  }

  // 返回所有已选中的 agent
  const runSelected = async () => {
    if (selectedAgents.size === 0) {
      setAiMessageAuto('请至少选择一个Agent')
      return
    }
    await runAgents(Array.from(selectedAgents))
  }

  // 返回所有启用的 agent（并同步勾选状态）
  const runAll = async () => {
    const allIds = agents.filter((a) => a.enabled).map((a) => a.id)
    if (allIds.length === 0) {
      setAiMessageAuto('没有可用的Agent')
      return
    }
    setSelectedAgents(new Set(allIds))
    await runAgents(allIds)
  }

  // 保存 AI 分析结果到学生档案
  const saveAiResult = async () => {
    try {
      const result = await getAPI().profile.set(student.name, {
        ...profileData,
        aiAnalysis: aiOutput,
        aiAnalyzedAt: Date.now(),
      })
      if (result.success) {
        setAiSaved(true)
        toast.success(t('toast.profile.analysisSaved'))
      }
    } catch (_err) {
      toast.error(t('toast.common.saveFailed'))
    }
  }

  return {
    aiRunning,
    aiOutput,
    aiMessage,
    aiSaved,
    setAiSaved,
    toggleAgent,
    selectedAgents,
    runSelected,
    runAll,
    saveAiResult,
  }
}
