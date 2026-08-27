// =============================================================
// useReportsData — 报告中心数据加载(列表 / 选中项 / 立即生成)
// R2-12: 产物目录 data_archive/agent_outputs 的消费端 — 此前周报
// 产得出但没有任何 UI 入口(renderer 全仓 grep agent_outputs = 0)
// =============================================================

import type { ReportEntry } from '@shared/types/reports'
import { useCallback, useEffect, useState } from 'react'
import { getAPI } from '../../../lib/ipc-client'

/** 与 agents.yaml weekly-reporter cron 指令同口径的即时生成 prompt */
const GENERATE_PROMPT =
  '请根据本周操行数据生成班级周报(默认本周一到当前日期,对比上周同期),' +
  '按周报结构:概况/重点关注/事件分析/进步亮点/建议措施;' +
  '产物写入 data_archive/agent_outputs/ 目录,文件名 weekly_report_<日期>。'

export function useReportsData() {
  const [entries, setEntries] = useState<ReportEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [contentLoading, setContentLoading] = useState(false)
  const [generating, setGenerating] = useState(false)

  const fetchList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await getAPI().reports.list()
      if (!r.success) {
        setError(r.error ?? '加载失败')
        setEntries([])
      } else {
        setEntries(r.entries)
        // 默认选中最新一份
        if (r.entries.length > 0 && !r.entries.some((e) => e.name === selectedName)) {
          setSelectedName((cur) => cur ?? r.entries[0]!.name)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [selectedName])

  const select = useCallback(async (name: string) => {
    setSelectedName(name)
    setContentLoading(true)
    try {
      const r = await getAPI().reports.read(name)
      if (r.success && r.content !== undefined) {
        setContent(r.content)
      } else {
        setContent(`读取失败: ${r.error ?? '未知错误'}`)
      }
    } catch (err) {
      setContent(`读取异常: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setContentLoading(false)
    }
  }, [])

  // 选中项变化时(列表加载完成)自动读取
  useEffect(() => {
    if (selectedName) void select(selectedName)
  }, [selectedName, select])

  const generateNow = useCallback(async () => {
    setGenerating(true)
    try {
      // fire-and-forget 与 manual run 一致;结果会写入产物目录,生成后刷新列表
      await getAPI().agent.runManual('weekly-reporter', GENERATE_PROMPT, [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenerating(false)
      // agent 运行是异步的,稳定延迟后刷新一次列表
      setTimeout(() => void fetchList(), 5000)
    }
  }, [fetchList])

  return {
    entries,
    loading,
    error,
    selectedName,
    content,
    contentLoading,
    generating,
    select,
    fetchList,
    generateNow,
  }
}
