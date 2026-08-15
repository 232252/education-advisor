// =============================================================
// usePluginsOverview — 插件中心概览数据加载
// 复用各能力的现有 API 拉取概览计数,不发明新 IPC 通道
// 逻辑自 tabs/PluginsTab.tsx 逐字搬移,行为不变
// =============================================================

import { useCallback, useEffect, useState } from 'react'
import { getAPI } from '../../../lib/ipc-client'
import {
  type CronOverview,
  type FeishuOverview,
  isPluginsAllEmpty,
  type McpOverview,
  type OllamaOverview,
} from '../lib/plugins-overview'

export function usePluginsOverview() {
  const [loading, setLoading] = useState(true)
  const [mcp, setMcp] = useState<McpOverview | null>(null)
  const [skillsCount, setSkillsCount] = useState(0)
  const [cron, setCron] = useState<CronOverview | null>(null)
  const [feishu, setFeishu] = useState<FeishuOverview | null>(null)
  const [ollama, setOllama] = useState<OllamaOverview | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setErrorMsg(null)
    const api = getAPI()
    // 并行拉取所有概览数据，任一失败不阻塞其余
    const results = await Promise.allSettled([
      // MCP：设置 + server 列表
      (async () => {
        const settings = await api.settings.get()
        const enabled = settings?.mcp?.enabled === true
        if (!enabled) return { enabled: false, total: 0, active: 0 } as McpOverview
        const r = await api.mcp.list()
        const servers = r.success ? r.servers : []
        return {
          enabled,
          total: servers.length,
          active: servers.filter((s) => s.connected).length,
        } as McpOverview
      })(),
      // 技能计数
      (async () => {
        const list = await api.skill.list()
        return Array.isArray(list) ? list.length : 0
      })(),
      // Cron 概览
      (async () => {
        const list = await api.cron.list()
        const arr = Array.isArray(list) ? list : []
        return {
          total: arr.length,
          enabled: arr.filter((x: unknown) => {
            const e = (x as { enabled?: boolean })?.enabled
            return e === true || e === undefined // undefined 视为默认启用
          }).length,
        } as CronOverview
      })(),
      // 飞书机器人状态
      (async () => {
        const info = await api.feishu.botStatus()
        const status = (info as { status?: string })?.status ?? null
        return { status } as FeishuOverview
      })(),
      // Ollama 本地模型
      (async () => {
        const info = await api.ollama.detect()
        const det = info as { running?: boolean; models?: unknown[] }
        let modelCount = 0
        if (det.running) {
          try {
            const models = await api.ollama.listModels()
            modelCount = Array.isArray(models) ? models.length : 0
          } catch {
            modelCount = 0
          }
        }
        return {
          modelCount,
          running: det.running === true,
        } as OllamaOverview
      })(),
    ])
    // MCP
    if (results[0].status === 'fulfilled') setMcp(results[0].value as McpOverview)
    // 技能
    if (results[1].status === 'fulfilled') setSkillsCount(results[1].value as number)
    // Cron
    if (results[2].status === 'fulfilled') setCron(results[2].value as CronOverview)
    // 飞书
    if (results[3].status === 'fulfilled') setFeishu(results[3].value as FeishuOverview)
    // Ollama
    if (results[4].status === 'fulfilled') setOllama(results[4].value as OllamaOverview)
    // 收集错误
    const errs = results
      .filter((r) => r.status === 'rejected')
      .map((r) => (r as PromiseRejectedResult).reason)
    if (errs.length > 0) {
      setErrorMsg(`${errs.length} 个能力加载失败`)
      console.error('[PluginsTab] some capabilities failed:', errs)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // 判定是否"全部空"——MCP 禁用 + 技能 0 + cron 0 + 飞书未连 + ollama 未跑
  const allEmpty = isPluginsAllEmpty(mcp, skillsCount, cron, feishu, ollama)

  return {
    loading,
    mcp,
    skillsCount,
    cron,
    feishu,
    ollama,
    errorMsg,
    loadAll,
    allEmpty,
  }
}
