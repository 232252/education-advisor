// =============================================================
// AgentRuntimeConfig — 运行时固定为 DeepSeek Harness，并编辑 dsh 路由映射
// 写 settings.models.dshRoutes。旧的 models.agentRuntime=pi 在打开本页时改回 dsh。
// =============================================================

import { memo, useEffect, useRef, useState } from 'react'
import { useAutoDismiss } from '../../../hooks/useAutoDismiss'
import { tr, useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { btnStyle, cn, INPUT_SM } from '../../../lib/ui-utils'
import { toast } from '../../../stores/toastStore'

const RUNTIME_PATH = 'models.agentRuntime'
const ROUTES_PATH = 'models.dshRoutes'

export const AgentRuntimeConfig = memo(function AgentRuntimeConfig() {
  const { t } = useT()
  /** 已持久化的 provider id → dsh 路由名 */
  const [routes, setRoutes] = useState<Record<string, string>>({})
  /** 行内编辑草稿: provider id → 输入框当前值(未提交;提交后清掉) */
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  /** 新增一行的两个输入框 */
  const [newProvider, setNewProvider] = useState('')
  const [newRoute, setNewRoute] = useState('')
  const [saveToast, setSaveToast] = useState('')
  const setSaveToastAuto = useAutoDismiss<string>(setSaveToast, '', 3000)

  // 挂载自取一次(与 GradingModelConfig 同款 ref 守卫,避免重复请求)
  const initialLoadDone = useRef(false)
  useEffect(() => {
    if (initialLoadDone.current) return
    initialLoadDone.current = true
    void (async () => {
      try {
        const settings = await getAPI().settings.get()
        setRoutes({ ...(settings?.models?.dshRoutes ?? {}) })
        if (settings?.models?.agentRuntime === 'pi') {
          await getAPI().settings.set(RUNTIME_PATH, 'dsh')
        }
      } catch (err) {
        console.error('[AgentRuntimeConfig] Failed to load settings:', err)
      }
    })()
  }, [])

  const save = async (path: string, value: unknown) => {
    try {
      const result = await getAPI().settings.set(path, value)
      if (!result?.success) throw new Error(result?.error || 'settings.set failed')
      setSaveToastAuto('ok', 2000)
    } catch (err) {
      console.error(`[AgentRuntimeConfig] Failed to save ${path}:`, err)
      setSaveToastAuto('error', 3000)
      toast.error(tr('page.models.default.saveFailedPath', { path }))
    }
  }

  const commitRoutes = (next: Record<string, string>) => {
    setRoutes(next)
    void save(ROUTES_PATH, next)
  }

  /** 行内提交: 草稿存在且与已存值不同才写(避免无意义的整对象回写) */
  const commitDraft = (providerId: string) => {
    if (!(providerId in drafts)) return
    const next = drafts[providerId].trim()
    setDrafts((prev) => {
      const rest = { ...prev }
      delete rest[providerId]
      return rest
    })
    if (next === routes[providerId]) return
    commitRoutes({ ...routes, [providerId]: next })
  }

  const addPair = () => {
    const providerId = newProvider.trim()
    const route = newRoute.trim()
    if (!providerId || !route) return
    commitRoutes({ ...routes, [providerId]: route })
    setNewProvider('')
    setNewRoute('')
  }

  const removePair = (providerId: string) => {
    const next = { ...routes }
    delete next[providerId]
    commitRoutes(next)
  }

  const routeEntries = Object.entries(routes)

  return (
    <div className="bg-gray-50 dark:bg-surface-elevated border border-gray-200 dark:border-white/[0.06] rounded-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4">
        <h2 className="font-semibold text-lg">
          {t('page.models.agentRuntime.title', 'DeepSeek Harness')}
        </h2>
        {saveToast && (
          <span
            className={`text-xs px-2.5 py-1 rounded-full transition-opacity ${
              saveToast === 'ok'
                ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                : 'bg-red-500/20 text-red-600 dark:text-red-400'
            }`}
          >
            {saveToast === 'ok'
              ? t('page.models.default.saved')
              : t('page.models.default.saveFailed')}
          </span>
        )}
      </div>

      <p className="px-5 pt-1 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
        {t(
          'page.models.agentRuntime.desc',
          '对话、批改和连接中心都使用 DeepSeek Harness。模型密钥仍在本页配置，启动时注入给 dsh。',
        )}
      </p>

      <div className="px-5 pb-5">
        <div className="border-t border-gray-200 dark:border-white/[0.06] pt-4">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
            {t('page.models.dshRoutes.title', 'dsh 模型路由映射')}
          </span>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mt-0.5">
            {t(
              'page.models.dshRoutes.desc',
              '本应用里的服务商 id，对应 dsh 配置中的路由名。没填的按同名直通；路由不存在时，dsh 会报 no adapter registered。',
            )}
          </p>

          {routeEntries.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              {t('page.models.dshRoutes.empty', '暂无映射 — 全部 provider 按同名直通。')}
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              {routeEntries.map(([providerId, route]) => (
                <div key={providerId} className="flex items-center gap-2">
                  <span
                    className="text-xs font-mono text-gray-700 dark:text-gray-300 w-44 truncate"
                    title={providerId}
                  >
                    {providerId}
                  </span>
                  <input
                    type="text"
                    value={providerId in drafts ? drafts[providerId] : route}
                    aria-label={tr('page.models.dshRoutes.routeAria', { provider: providerId })}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [providerId]: e.target.value }))
                    }
                    onBlur={() => commitDraft(providerId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                    className={cn(INPUT_SM, 'flex-1 min-w-0')}
                  />
                  <button
                    type="button"
                    onClick={() => removePair(providerId)}
                    aria-label={tr('page.models.dshRoutes.removeAria', { provider: providerId })}
                    className={cn(
                      btnStyle('ghost'),
                      'text-xs text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400',
                    )}
                  >
                    {t('page.models.dshRoutes.remove', '删除')}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 新增一对映射 */}
          <div className="mt-3 flex items-center gap-2">
            <input
              type="text"
              value={newProvider}
              onChange={(e) => setNewProvider(e.target.value)}
              placeholder={t('page.models.dshRoutes.providerPlaceholder', 'provider id')}
              className={cn(INPUT_SM, 'flex-1 min-w-0')}
            />
            <input
              type="text"
              value={newRoute}
              onChange={(e) => setNewRoute(e.target.value)}
              placeholder={t('page.models.dshRoutes.routePlaceholder', 'dsh 路由名')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addPair()
              }}
              className={cn(INPUT_SM, 'flex-1 min-w-0')}
            />
            <button
              type="button"
              onClick={addPair}
              disabled={!newProvider.trim() || !newRoute.trim()}
              className={btnStyle('secondary')}
            >
              {t('page.models.dshRoutes.add', '添加')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})
