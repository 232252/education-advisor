// =============================================================
// useReportsData — 报告中心数据加载(列表 / 选中项 / 立即生成)
// R2-12: 产物目录 data_archive/agent_outputs 的消费端 — 此前周报
// 产得出但没有任何 UI 入口(renderer 全仓 grep agent_outputs = 0)
// =============================================================

import type { ReportEntry } from '@shared/types/reports'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useIpcQuery } from '../../../hooks/useIpcQuery'
import { tr } from '../../../i18n'
import { errText, getAPI } from '../../../lib/ipc-client'

// 稳定空数组引用,避免加载前/失败后每次渲染产生新引用
const EMPTY_ENTRIES: ReportEntry[] = []

/** 与 agents.yaml weekly-reporter cron 指令同口径的即时生成 prompt */
const GENERATE_PROMPT =
  '请根据本周操行数据生成班级周报(默认本周一到当前日期,对比上周同期),' +
  '按周报结构:概况/重点关注/事件分析/进步亮点/建议措施;' +
  '产物写入 data_archive/agent_outputs/ 目录,文件名 weekly_report_<日期>。'

export function useReportsData() {
  const [error, setError] = useState<string | null>(null)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [contentLoading, setContentLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  // onData 闭包用 ref 读最新选中项,fetchList 依赖收口为稳定引用
  const selectedNameRef = useRef(selectedName)
  selectedNameRef.current = selectedName

  // 列表加载收口至 useIpcQuery — 修复: 原实现 fetchList 从未在挂载时
  // 触发,首次进入报告中心列表恒为空,必须手点刷新
  const {
    data: entriesData,
    loading,
    reload: fetchList,
  } = useIpcQuery<ReportEntry[]>(
    async () => {
      const r = await getAPI().reports.list()
      if (!r.success) throw new Error(r.error ?? tr('reports.loadFailed', {}))
      return r.entries
    },
    {
      scope: 'Reports',
      // 失败即清空列表(与原实现一致)
      keepDataOnError: false,
      onError: (err) => setError(errText(err)),
      onData: (list) => {
        // 默认选中最新一份(长度已判,?. 仅为满足 lint;取不到时保持 undefined)
        if (list.length > 0 && !list.some((e) => e.name === selectedNameRef.current)) {
          setSelectedName((cur) => cur ?? list[0]?.name)
        }
      },
    },
  )
  const entries = entriesData ?? EMPTY_ENTRIES

  const select = useCallback(async (name: string) => {
    setSelectedName(name)
    setContentLoading(true)
    try {
      const r = await getAPI().reports.read(name)
      if (r.success && r.content !== undefined) {
        setContent(r.content)
      } else {
        setContent(tr('reports.readFailed', { err: r.error ?? tr('reports.unknownError', {}) }))
      }
    } catch (err) {
      setContent(tr('reports.readError', { err: errText(err) }))
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
      setError(errText(err))
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
