// =============================================================
// PluginsTab — 插件中心 (编排层)
// 聚合呈现各类可插拔能力：MCP 服务器 / 技能 / 飞书机器人 / 定时任务 / 本地模型
// 用户原诉求："插件都可以在技能里面，包括未来的设计都在在里面"
// 设计：插件中心不发明新 IPC 通道，复用各能力的现有 API 拉取概览计数，
//       点击卡片跳转到对应页/Tab。底部预留"未来扩展位"占位区。
// 数据: hooks/usePluginsOverview.ts
// UI 块: components/PluginCard / FutureCard
// =============================================================

import { Brain, Clock, DoorOpen, MessageCircle, Plug, Puzzle, ScrollText } from 'lucide-react'
import { EmptyState } from '../../../components/EmptyState'
import { Skeleton } from '../../../components/Skeleton'
import { useT } from '../../../i18n'
import { FutureCard } from '../components/FutureCard'
import { PluginCard } from '../components/PluginCard'
import { usePluginsOverview } from '../hooks/usePluginsOverview'

export function PluginsTab() {
  const { t } = useT()
  const { loading, mcp, skillsCount, cron, feishu, ollama, errorMsg, loadAll, allEmpty } =
    usePluginsOverview()

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
            icon={<Puzzle className="h-6 w-6" />}
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
              icon={<Plug className="h-5 w-5" />}
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
              icon={<ScrollText className="h-5 w-5" />}
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
              icon={<Clock className="h-5 w-5" />}
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
              icon={<MessageCircle className="h-5 w-5" />}
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
              icon={<Brain className="h-5 w-5" />}
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
              icon={<DoorOpen className="h-5 w-5" />}
              title={t('page.skills.plugins.future.agentCapabilities')}
              description={t('page.skills.plugins.future.agentCapabilities.desc')}
            />
            <FutureCard
              icon={<Plug className="h-5 w-5" />}
              title={t('page.skills.plugins.future.skillMcp')}
              description={t('page.skills.plugins.future.skillMcp.desc')}
            />
            <FutureCard
              icon={<Puzzle className="h-5 w-5" />}
              title={t('page.skills.plugins.future.pluginRegistry')}
              description={t('page.skills.plugins.future.pluginRegistry.desc')}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
