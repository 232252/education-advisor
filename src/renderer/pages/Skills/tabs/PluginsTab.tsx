// =============================================================
// PluginsTab — 插件中心
// 聚合呈现各类可插拔能力：MCP 服务器 / 技能 / 飞书机器人 / 定时任务 / 本地模型
// 用户原诉求："插件都可以在技能里面，包括未来的设计都在在里面"
// 设计：插件中心不发明新 IPC 通道，复用各能力的现有 API 拉取概览计数，
//       点击卡片跳转到对应页/Tab。底部预留"未来扩展位"占位区。
// =============================================================

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from '../../../components/Card'
import { EmptyState } from '../../../components/EmptyState'
import { Skeleton } from '../../../components/Skeleton'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'

/** MCP 概览数据 */
interface McpOverview {
  enabled: boolean
  total: number
  active: number
}

/** Cron 概览数据 */
interface CronOverview {
  total: number
  enabled: number
}

/** 飞书机器人状态（简化） */
interface FeishuOverview {
  status: string | null
}

/** 本地模型概览 */
interface OllamaOverview {
  modelCount: number
  running: boolean
}

/** 单个插件卡的 props */
interface PluginCardProps {
  icon: string
  title: string
  description: string
  /** 主行计数文案，例 "3 个服务器 · 2 已连接" */
  countText: string
  /** 跳转按钮文案 */
  manageLabel: string
  /** 跳转目标 hash 路径，例 "/skills" */
  to: string
  /** 跳转后是否需要切到特定 Tab，传 tab key 会被 localStorage 写入 */
  tabKey?: string
  tabValue?: string
  /** 已禁用态 */
  disabled?: boolean
  /** 禁用态展示文案 */
  disabledText?: string
}

function PluginCard({
  icon,
  title,
  description,
  countText,
  manageLabel,
  to,
  tabKey,
  tabValue,
  disabled,
  disabledText,
}: PluginCardProps) {
  const { t } = useT()
  const navigate = useNavigate()

  const handleGo = () => {
    if (disabled) return
    // 预设 Tab：写入 localStorage 后导航，目标页 useEffect 会读取
    if (tabKey && tabValue) {
      try {
        window.localStorage.setItem(tabKey, tabValue)
      } catch {
        // 忽略 localStorage 异常（隐私模式等）
      }
    }
    navigate(to)
  }

  return (
    <Card className="flex flex-col p-4 gap-2">
      <div className="flex items-start gap-3">
        <span className="text-2xl flex-shrink-0" aria-hidden>
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">{title}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
            {description}
          </p>
        </div>
      </div>
      <div className="text-xs text-gray-700 dark:text-gray-300 mt-1">
        {disabled ? (
          <span className="text-amber-600 dark:text-amber-400">
            {disabledText || t('common.disabled')}
          </span>
        ) : (
          <span>{countText}</span>
        )}
      </div>
      <button
        type="button"
        onClick={handleGo}
        disabled={disabled}
        className="self-start mt-1 px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-white/[0.08] hover:bg-gray-100 dark:hover:bg-white/[0.06] disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300"
      >
        {manageLabel}
      </button>
    </Card>
  )
}

/** 未来扩展位占位卡（不可点击，仅展示设计蓝图） */
function FutureCard({
  icon,
  title,
  description,
}: {
  icon: string
  title: string
  description: string
}) {
  return (
    <Card className="flex flex-col p-4 gap-2 opacity-70 border-dashed">
      <div className="flex items-start gap-3">
        <span className="text-2xl flex-shrink-0" aria-hidden>
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-700 dark:text-gray-300 truncate">
            <span className="text-xs align-middle mr-1.5 px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
              SOON
            </span>
            {title}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
            {description}
          </p>
        </div>
      </div>
    </Card>
  )
}

export function PluginsTab() {
  const { t } = useT()
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

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </div>
    )
  }

  // 判定是否"全部空"——MCP 禁用 + 技能 0 + cron 0 + 飞书未连 + ollama 未跑
  const allEmpty =
    (mcp === null || (!mcp.enabled && mcp.total === 0)) &&
    skillsCount === 0 &&
    (cron === null || cron.total === 0) &&
    (feishu === null || feishu.status === null || feishu.status === 'idle') &&
    (ollama === null || (!ollama.running && ollama.modelCount === 0))

  return (
    <section className="h-full flex flex-col overflow-auto">
      {/* 顶部标题区 */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-white/[0.06] flex-shrink-0">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t('page.skills.plugins.title')}
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {t('page.skills.plugins.subtitle')}
        </p>
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={loadAll}
            className="px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-white/[0.08] hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-700 dark:text-gray-300"
          >
            ⟳ {t('page.skills.plugins.action.refresh')}
          </button>
          {errorMsg && (
            <span className="text-xs text-amber-600 dark:text-amber-400">{errorMsg}</span>
          )}
        </div>
      </div>

      <div className="flex-1 p-4 space-y-5">
        {/* 全空时引导 */}
        {allEmpty && (
          <EmptyState
            icon="🧩"
            title={t('page.skills.plugins.empty.title')}
            description={t('page.skills.plugins.empty.hint')}
          />
        )}

        {/* 已启用能力 */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-2">
            {t('page.skills.plugins.section.active')}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* MCP 即插即用 */}
            <PluginCard
              icon="🔌"
              title={t('page.skills.plugins.card.mcp')}
              description={t('page.skills.plugins.card.mcp.desc')}
              countText={
                mcp?.enabled
                  ? t('page.skills.plugins.card.mcp.count')
                      .replace('{count}', String(mcp.total))
                      .replace('{active}', String(mcp.active))
                  : mcp && !mcp.enabled
                    ? t('common.disabled')
                    : t('page.skills.plugins.card.mcp.empty')
              }
              manageLabel={t('page.skills.plugins.card.mcp.manage')}
              to="/skills"
              tabKey="skills.activeTab"
              tabValue="mcp"
            />
            {/* 技能 */}
            <PluginCard
              icon="📜"
              title={t('page.skills.plugins.card.skills')}
              description={t('page.skills.plugins.card.skills.desc')}
              countText={t('page.skills.plugins.card.skills.count').replace(
                '{count}',
                String(skillsCount),
              )}
              manageLabel={t('page.skills.plugins.card.skills.manage')}
              to="/skills"
              tabKey="skills.activeTab"
              tabValue="skills"
            />
            {/* 定时任务 */}
            <PluginCard
              icon="⏰"
              title={t('page.skills.plugins.card.cron')}
              description={t('page.skills.plugins.card.cron.desc')}
              countText={
                cron
                  ? t('page.skills.plugins.card.cron.count')
                      .replace('{count}', String(cron.total))
                      .replace('{enabled}', String(cron.enabled))
                  : '—'
              }
              manageLabel={t('page.skills.plugins.card.cron.manage')}
              to="/scheduler"
            />
            {/* 飞书机器人 */}
            <PluginCard
              icon="🐦"
              title={t('page.skills.plugins.card.feishu')}
              description={t('page.skills.plugins.card.feishu.desc')}
              countText={
                feishu?.status
                  ? t('page.skills.plugins.card.feishu.count').replace('{status}', feishu.status)
                  : t('common.offline')
              }
              manageLabel={t('page.skills.plugins.card.feishu.manage')}
              to="/settings"
            />
            {/* 本地模型 */}
            <PluginCard
              icon="🧠"
              title={t('page.skills.plugins.card.localModels')}
              description={t('page.skills.plugins.card.localModels.desc')}
              countText={
                ollama
                  ? t('page.skills.plugins.card.localModels.count')
                      .replace('{count}', String(ollama.modelCount))
                      .replace(
                        '{running}',
                        ollama.running ? t('common.online') : t('common.offline'),
                      )
                  : '—'
              }
              manageLabel={t('page.skills.plugins.card.localModels.manage')}
              to="/models"
            />
          </div>
        </div>

        {/* 未来扩展位 */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-2">
            {t('page.skills.plugins.section.future')}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FutureCard
              icon="🚪"
              title={t('page.skills.plugins.future.agentCapabilities')}
              description={t('page.skills.plugins.future.agentCapabilities.desc')}
            />
            <FutureCard
              icon="🔌"
              title={t('page.skills.plugins.future.skillMcp')}
              description={t('page.skills.plugins.future.skillMcp.desc')}
            />
            <FutureCard
              icon="🧩"
              title={t('page.skills.plugins.future.pluginRegistry')}
              description={t('page.skills.plugins.future.pluginRegistry.desc')}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
