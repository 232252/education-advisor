// =============================================================
// PluginsTab — 插件中心
// 上面是已经装进 dsh 的插件：聊天、花名册、成绩、批改、操行。
// 下面是仍由本机页面管理的技能、定时任务和本地模型。
// 数据: hooks/usePluginsOverview.ts
// UI 块: components/PluginCard
// =============================================================

import type { EducationPluginInstall } from '@shared/api/dsh-im'
import type { OfficeKitStatus } from '@shared/api/office-kit'
import {
  Brain,
  ClipboardCheck,
  Clock,
  FileText,
  GraduationCap,
  MessageCircle,
  Plug,
  ScrollText,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { requestOpenConnectionCenter } from '../../../components/connection-center/open-connection-center'
import { Skeleton } from '../../../components/Skeleton'
import { tr, useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { PluginCard } from '../components/PluginCard'
import { usePluginsOverview } from '../hooks/usePluginsOverview'

function loadPluginInstall(setInstall: (row: EducationPluginInstall | 'error') => void): void {
  void getAPI()
    .dshIm.pluginInstall()
    .then((row) => {
      if (row && typeof row.roster === 'boolean' && typeof row.im === 'boolean') setInstall(row)
      else setInstall('error')
    })
    .catch(() => setInstall('error'))
}

export function PluginsTab() {
  const { t } = useT()
  const { loading, mcp, skillsCount, cron, ollama, errorMsg, loadAll } = usePluginsOverview()
  // AI 批改任务数:本组件就地拉取(不进 usePluginsOverview,保持该 hook 职责单一;挂载期一次)
  const [gradingCount, setGradingCount] = useState<number | null>(null)
  const [install, setInstall] = useState<EducationPluginInstall | 'error' | null>(null)
  // office 转 PDF 组件（随包 zip，首用本地解压；下载入口仅作损坏修复）
  const [officeKit, setOfficeKit] = useState<OfficeKitStatus | null>(null)
  const loadOfficeKit = useCallback(() => {
    void getAPI()
      .officeKit.status()
      .then(setOfficeKit)
      .catch(() => setOfficeKit(null))
  }, [])
  useEffect(() => {
    void (async () => {
      const r = await getAPI().grading.listTasks()
      if (r.success && r.data) setGradingCount(r.data.length)
    })()
    loadPluginInstall(setInstall)
    loadOfficeKit()
    // loadOfficeKit 是稳定的 useCallback，这里实际仍是挂载期一次
  }, [loadOfficeKit])
  // 下载中轮询进度（后台预热/手动安装共用）
  useEffect(() => {
    if (officeKit?.state !== 'installing') return
    const timer = setInterval(loadOfficeKit, 1500)
    return () => clearInterval(timer)
  }, [officeKit?.state, loadOfficeKit])

  const installOfficeKit = () => {
    setOfficeKit({
      state: 'installing',
      message: t('page.skills.plugins.card.officeKit.preparing', '准备组件…'),
    })
    void getAPI()
      .officeKit.install()
      .then(setOfficeKit)
      .catch((err: unknown) =>
        setOfficeKit({
          state: 'unknown',
          message: err instanceof Error ? err.message : String(err),
        }),
      )
  }

  const officeKitText = () => {
    if (officeKit === null) return '—'
    if (officeKit.state === 'ready') {
      return officeKit.source === 'bundled'
        ? t('page.skills.plugins.card.officeKit.bundled', '已就绪（随包）')
        : t('page.skills.plugins.card.officeKit.ready', '已就绪（在线补装）')
    }
    if (officeKit.state === 'installing') {
      return officeKit.message || t('page.skills.plugins.card.officeKit.installing', '准备中…')
    }
    if (officeKit.state === 'missing') {
      return t(
        'page.skills.plugins.card.officeKit.missing',
        '待解压（用到时自动从随包解压，不联网）',
      )
    }
    return officeKit.message || t('page.skills.plugins.card.officeKit.unknown', '状态未知')
  }

  const linkText = (on: boolean) => {
    if (install === null) return '—'
    if (install === 'error' || !on) return t('page.skills.plugins.card.unlinked', '未接入')
    return t('page.skills.plugins.card.linked', '已接入')
  }

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
            onClick={() => {
              loadAll()
              loadPluginInstall(setInstall)
            }}
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
        <div>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-2">
            {t('page.skills.plugins.section.dsh', 'DeepSeek 插件')}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <PluginCard
              icon={<MessageCircle className="h-5 w-5" />}
              title={t('page.skills.plugins.card.im', '聊天连接')}
              description={t(
                'page.skills.plugins.card.im.desc',
                '官方 dsh-im。微信、飞书、企微、钉钉和 QQ 的登录都在这里完成。',
              )}
              countText={
                install !== null && install !== 'error' && install.im
                  ? t('page.skills.plugins.card.im.count', 'dsh-im 5.10.0')
                  : linkText(false)
              }
              manageLabel={t('page.skills.plugins.card.im.manage', '打开')}
              onManage={requestOpenConnectionCenter}
            />
            <PluginCard
              icon={<Users className="h-5 w-5" />}
              title={t('page.skills.plugins.card.roster', '花名册')}
              description={t(
                'page.skills.plugins.card.roster.desc',
                '建班、导入和名单。和查分分开安装，卸掉这一组不影响操行查询。',
              )}
              countText={linkText(install !== 'error' && install !== null && install.roster)}
              manageLabel={t('page.skills.plugins.card.roster.manage', '打开学生')}
              to="/students"
            />
            <PluginCard
              icon={<GraduationCap className="h-5 w-5" />}
              title={t('page.skills.plugins.card.grades', '成绩')}
              description={t(
                'page.skills.plugins.card.grades.desc',
                '考试导入和成绩查询。和操行分开安装。',
              )}
              countText={linkText(install !== 'error' && install !== null && install.grades)}
              manageLabel={t('page.skills.plugins.card.grades.manage', '打开学业')}
              to="/academics"
            />
            <PluginCard
              icon={<ClipboardCheck className="h-5 w-5" />}
              title={t('page.skills.plugins.card.grading', 'AI 批改作业')}
              description={t(
                'page.skills.plugins.card.grading.desc',
                'eaa-grading 插件。上传原卷和学生作业，未归组的卷子不猜姓名。',
              )}
              countText={
                install === null ||
                (install !== 'error' && install.grading && gradingCount === null)
                  ? '—'
                  : install === 'error' || !install.grading
                    ? t('page.skills.plugins.card.unlinked', '未接入')
                    : tr('page.skills.plugins.card.grading.count', { count: gradingCount ?? 0 })
              }
              manageLabel={t('page.skills.plugins.card.grading.manage', '去批改')}
              to="/grading"
            />
            <PluginCard
              icon={<ScrollText className="h-5 w-5" />}
              title={t('page.skills.plugins.card.conduct', '操行工具')}
              description={t(
                'page.skills.plugins.card.conduct.desc',
                '查分、加减分和排名。这次运行没有这些工具时，这一组不会连上。',
              )}
              countText={linkText(install !== 'error' && install !== null && install.conduct)}
            />
            <PluginCard
              icon={<FileText className="h-5 w-5" />}
              title={t('page.skills.plugins.card.officeKit', 'Office 转 PDF 组件')}
              description={t(
                'page.skills.plugins.card.officeKit.desc',
                'Word/Excel 等 office 文件转 PDF 的转换引擎（~180MB）。为控制安装包体积不随包分发，首次使用前联网补装一次即可。',
              )}
              countText={officeKitText()}
              manageLabel={
                officeKit?.state === 'installing'
                  ? t('page.skills.plugins.card.officeKit.installing', '下载中…')
                  : officeKit?.state === 'ready'
                    ? undefined
                    : t('page.skills.plugins.card.officeKit.install', '下载组件')
              }
              onManage={officeKit?.state === 'installing' ? undefined : installOfficeKit}
            />
          </div>
        </div>

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
                  ? tr('page.skills.plugins.card.mcp.count', {
                      count: mcp.total,
                      active: mcp.active,
                    })
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
              countText={tr('page.skills.plugins.card.skills.count', { count: skillsCount })}
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
                  ? tr('page.skills.plugins.card.cron.count', {
                      count: cron.total,
                      enabled: cron.enabled,
                    })
                  : '—'
              }
              manageLabel={t('page.skills.plugins.card.cron.manage')}
              to="/scheduler"
            />
            {/* 本地模型 */}
            <PluginCard
              icon={<Brain className="h-5 w-5" />}
              title={t('page.skills.plugins.card.localModels')}
              description={t('page.skills.plugins.card.localModels.desc')}
              countText={
                ollama
                  ? tr('page.skills.plugins.card.localModels.count', {
                      count: ollama.modelCount,
                      running: ollama.running ? t('common.online') : t('common.offline'),
                    })
                  : '—'
              }
              manageLabel={t('page.skills.plugins.card.localModels.manage')}
              to="/models"
            />
          </div>
        </div>
      </div>
    </section>
  )
}
