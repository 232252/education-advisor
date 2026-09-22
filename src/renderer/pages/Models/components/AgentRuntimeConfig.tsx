// =============================================================
// AgentRuntimeConfig — Agent 运行时后端切换 (pi ↔ dsh) + dsh 路由映射
// 写 settings.models.agentRuntime / settings.models.dshRoutes。
// 读取/保存约定与同目录 DefaultModelConfig / GradingModelConfig 一致:
//   挂载时 getAPI().settings.get() 自取 → 改动即 getAPI().settings.set(dotPath, value)
//   → 成功/失败经头部 pill(useAutoDismiss) + toast.error 反馈。
// 后端消费方(每次调用时读取,无缓存):
//   src/main/services/pi-ai-service.ts / agent/execution.ts / grading/llm-call.ts
// 两个字段都是可选的: 旧 settings.json 无键时主进程按 'dsh' + 空映射处理（'pi' 为回退项）。
// =============================================================

import { memo, useEffect, useRef, useState } from 'react'
import { useAutoDismiss } from '../../../hooks/useAutoDismiss'
import { tr, useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { btnStyle, cn, INPUT_SM } from '../../../lib/ui-utils'
import { toast } from '../../../stores/toastStore'
import { SelectSettingRow } from '../../Settings/components/SelectSettingRow'

const RUNTIME_PATH = 'models.agentRuntime'
const ROUTES_PATH = 'models.dshRoutes'

export const AgentRuntimeConfig = memo(function AgentRuntimeConfig() {
  const { t } = useT()
  const [runtime, setRuntime] = useState<string>('dsh')
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
        // 可选字段兜底: 缺键按 'dsh'（默认后端）/ 空映射(与主进程读法一致)
        setRuntime(settings?.models?.agentRuntime === 'pi' ? 'pi' : 'dsh')
        setRoutes({ ...(settings?.models?.dshRoutes ?? {}) })
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

  // 运行时切换由 SelectSettingRow 直接 onSave(RUNTIME_PATH, 'pi'|'dsh');
  // 这里只镜像到本地 state 以驱动 dshRoutes 编辑区的显隐。
  // 切回 pi 时保留已存的 dshRoutes(只是不显示),便于再次切回。
  const handleRuntimeCommit = (v: string) => setRuntime(v === 'pi' ? 'pi' : 'dsh')

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
          {t('page.models.agentRuntime.title', 'Agent 运行时后端')}
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

      <SelectSettingRow
        path={RUNTIME_PATH}
        label={t('page.models.agentRuntime.label', '运行时后端')}
        description={t(
          'page.models.agentRuntime.desc',
          'pi = 内置 pi-ai 运行时; dsh = DeepSeek Harness 子进程。选 dsh 前请确认该 Provider 的 API Key 已存在本应用里 (启动子进程时会注入)。切换在下一次请求生效 (已启动的 dsh 子进程会在其生命周期内锁定 provider 与模型)。',
        )}
        value={runtime}
        options={[
          {
            value: 'dsh',
            label: t('page.models.agentRuntime.dsh', 'dsh (DeepSeek Harness, 默认)'),
          },
          { value: 'pi', label: t('page.models.agentRuntime.pi', 'pi (内置 pi-ai, 回退)') },
        ]}
        onSave={save}
        onCommit={handleRuntimeCommit}
        className="w-64"
      />

      {/* ---- dsh 路由映射(仅 dsh 后端时有意义) ---- */}
      {runtime === 'dsh' && (
        <div className="px-5 pb-5">
          <div className="border-t border-gray-200 dark:border-white/[0.06] pt-4">
            <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
              {t('page.models.dshRoutes.title', 'dsh 模型路由映射')}
            </span>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mt-0.5">
              {t(
                'page.models.dshRoutes.desc',
                'pi 的 provider id → dsh 自己配置里声明的路由名; 未配置的按同名直通, 路由不存在时 dsh 报 no adapter registered。',
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
      )}
    </div>
  )
})
