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
import { useState } from 'react'
import { useAgentStreamOutput } from '../../../hooks/useAgentStreamOutput'
import { useAutoDismiss } from '../../../hooks/useAutoDismiss'
import { useMountedRef } from '../../../hooks/useMountedRef'
import { useT } from '../../../i18n'
import { errText, getAPI } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'

export function useAgentAnalysis(
  student: EAAStudent,
  agents: AgentListItem[],
  profileData: StudentProfileData,
) {
  const { t } = useT()
  // R95 修复: mountedRef 防止异步 agent 分析循环在组件卸载后继续调用 setState
  const mountedRef = useMountedRef()

  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set())
  const [aiRunning, setAiRunning] = useState(false)
  const { output: aiOutput, resetOutput: resetAiOutput, startSession } = useAgentStreamOutput()
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
    resetAiOutput()
    setAiSaved(false)

    // High 修复语义保留: agentStore 派生订阅 + agentId 过滤防串扰
    // (订阅/收集/收尾节奏的实现收敛在 useAgentStreamOutput)
    const runningAgentIds = new Set(agentIds)
    const session = startSession({
      filter: (id) => runningAgentIds.has(id),
      onResult: (durationMs) =>
        `\n\n--- ${t('page.students.ai.executed', '执行完成')} (${durationMs}ms) ---\n`,
    })

    try {
      for (const agentId of agentIds) {
        // R95 修复: 组件卸载后立即中止循环,不再调用 setState
        if (!mountedRef.current) break
        session.append(`\n=== 🤖 ${agentId} ===\n`)
        const prompt = `请分析学生"${student.name}"的操行情况。基本信息：- 分数：${student.score}\n- 风险等级：${student.risk}\n- 事件数：${student.events_count}\n\n请从以下维度进行分析：\n1. 操行总结\n2. 风险预警\n3. 行为模式\n4. 教育建议`
        await getAPI().agent.runManual(agentId, prompt)
        // 等待一段时间让流式输出到达
        await session.settle()
      }
      if (mountedRef.current) setAiMessageAuto(t('page.students.ai.done', 'AI 分析完成'))
    } catch (err) {
      if (mountedRef.current)
        setAiMessageAuto(`${t('page.students.ai.failed', '分析失败')}: ${errText(err)}`)
    } finally {
      session.finish()
      if (mountedRef.current) setAiRunning(false)
    }
  }

  // 返回所有已选中的 agent
  const runSelected = async () => {
    if (selectedAgents.size === 0) {
      setAiMessageAuto(t('page.students.ai.selectAtLeastOne', '请至少选择一个Agent'))
      return
    }
    await runAgents(Array.from(selectedAgents))
  }

  // 返回所有启用的 agent（并同步勾选状态）
  const runAll = async () => {
    const allIds = agents.filter((a) => a.enabled).map((a) => a.id)
    if (allIds.length === 0) {
      setAiMessageAuto(t('page.students.ai.noAgentAvailable', '没有可用的Agent'))
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
