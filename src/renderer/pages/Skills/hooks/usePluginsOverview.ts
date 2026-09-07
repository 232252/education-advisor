// =============================================================
// usePluginsOverview — 插件中心概览数据加载
// 复用各能力的现有 API 拉取概览计数,不发明新 IPC 通道
// 逻辑自 tabs/PluginsTab.tsx 逐字搬移,行为不变
// =============================================================

import { tr } from '../../../i18n'
import { useEffect } from 'react'
import { useMultiLoader } from '../../../hooks/useMultiLoader'
import { getAPI } from '../../../lib/ipc-client'
import {
  type CronOverview,
  type FeishuOverview,
  isPluginsAllEmpty,
  type McpOverview,
  type OllamaOverview,
} from '../lib/plugins-overview'

const FALLBACKS = {
  mcp: null as McpOverview | null,
  skillsCount: 0,
  cron: null as CronOverview | null,
  feishu: null as FeishuOverview | null,
  ollama: null as OllamaOverview | null,
}

export function usePluginsOverview() {
  const api = getAPI()
  // 并行拉取所有概览数据,任一失败不阻塞其余(渐进渲染 + stale 防护由 useMultiLoader 提供)
  const {
    data,
    loading,
    errors,
    readyKeys,
    reload: loadAll,
  } = useMultiLoader(
    {
      mcp: async (): Promise<McpOverview> => {
        const settings = await api.settings.get()
        const enabled = settings?.mcp?.enabled === true
        if (!enabled) return { enabled: false, total: 0, active: 0 }
        const r = await api.mcp.list()
        const servers = r.success ? r.servers : []
        return {
          enabled,
          total: servers.length,
          active: servers.filter((s) => s.connected).length,
        }
      },
      // 技能计数
      skillsCount: async (): Promise<number> => {
        const list = await api.skill.list()
        return Array.isArray(list) ? list.length : 0
      },
      // Cron 概览(undefined 的 enabled 视为默认启用)
      cron: async (): Promise<CronOverview> => {
        const list = await api.cron.list()
        const arr = Array.isArray(list) ? list : []
        return {
          total: arr.length,
          enabled: arr.filter((x: unknown) => {
            const e = (x as { enabled?: boolean })?.enabled
            return e === true || e === undefined
          }).length,
        }
      },
      // 飞书机器人状态
      feishu: async (): Promise<FeishuOverview> => {
        const info = await api.feishu.botStatus()
        const status = (info as { status?: string })?.status ?? null
        return { status }
      },
      // Ollama 本地模型
      ollama: async (): Promise<OllamaOverview> => {
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
        }
      },
    },
    { fallbacks: FALLBACKS },
  )

  const { mcp, skillsCount, cron, feishu, ollama } = data
  // 收集错误(文案保持原样;日志仅在错误集合变化时打一次)
  const failedReasons = Object.values(errors)
  const errorMsg = failedReasons.length > 0 ? tr('skills.capabilitiesLoadFailed', { n: failedReasons.length }) : null
  useEffect(() => {
    const reasons = Object.values(errors)
    if (reasons.length > 0) {
      console.error('[PluginsTab] some capabilities failed:', reasons)
    }
  }, [errors])

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
    readyKeys,
  }
}
