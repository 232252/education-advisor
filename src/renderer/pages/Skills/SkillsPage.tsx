// =============================================================
// 技能工作台 — Tab 容器 (Skills / MCP / Plugins)
// =============================================================

import { useLocalStorage } from '../../hooks'
import { useT } from '../../i18n'
import { PageHeader } from '../../components/PageHeader'
import { McpTab } from './tabs/McpTab'
import { PluginsTab } from './tabs/PluginsTab'
import { SkillsTab } from './tabs/SkillsTab'

type TabKey = 'skills' | 'mcp' | 'plugins'

export function SkillsPage() {
  const { t } = useT()
  const [tab, setTab] = useLocalStorage<TabKey>('skills.activeTab', 'skills')

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'skills', label: t('page.skills.tab.skills') },
    { key: 'mcp', label: t('page.skills.tab.mcp') },
    { key: 'plugins', label: t('page.skills.tab.plugins') },
  ]

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const idx = tabs.findIndex((tb) => tb.key === tab)
    if (idx < 0) return
    const nextIdx =
      e.key === 'ArrowRight' ? (idx + 1) % tabs.length : (idx - 1 + tabs.length) % tabs.length
    const nextKey = tabs[nextIdx].key
    setTab(nextKey)
    // 把焦点也移到新选中的 tab 上,符合 roving tabindex 模式
    const btn = document.getElementById(`skills-tab-${nextKey}`)
    btn?.focus()
  }

  return (
    <section className="h-full flex flex-col" aria-label={t('page.skills.title')}>
      <PageHeader
        title={t('page.skills.title')}
        subtitle={t('page.skills.subtitle', '技能 / MCP / 插件管理')}
        size="md"
        sticky
      />
      {/* Tab 栏 */}
      <div
        role="tablist"
        aria-label={t('page.skills.title')}
        onKeyDown={handleTabKeyDown}
        className="flex border-b border-gray-200 dark:border-white/[0.06] flex-shrink-0 px-6"
      >
        {tabs.map((tb) => (
          <button
            type="button"
            role="tab"
            key={tb.key}
            id={`skills-tab-${tb.key}`}
            aria-selected={tab === tb.key}
            aria-controls="skills-tabpanel"
            tabIndex={tab === tb.key ? 0 : -1}
            onClick={() => setTab(tb.key)}
            className={`px-4 py-2 text-sm transition-colors
              ${
                tab === tb.key
                  ? 'text-blue-500 dark:text-blue-400 border-b-2 border-blue-500 dark:border-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div
        role="tabpanel"
        id="skills-tabpanel"
        aria-labelledby={`skills-tab-${tab}`}
        className="flex-1 overflow-hidden"
      >
        {tab === 'skills' && <SkillsTab />}
        {tab === 'mcp' && <McpTab />}
        {tab === 'plugins' && <PluginsTab />}
      </div>
    </section>
  )
}
