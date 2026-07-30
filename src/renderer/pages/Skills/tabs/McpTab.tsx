// =============================================================
// McpTab — MCP 服务器管理 Tab(左列表 + 右详情)
// 左侧:服务器列表 + 添加/从模板添加按钮
// 右侧:选中项的详情卡片(McpServerCard)或空状态
// 弹窗:McpServerForm(新增/编辑)、PresetTemplates(模板)
// 数据:getAPI().mcp.* (Task 5 接好的 IPC)
// 策略:进入即加载 + 每 5s 粗轮询刷新连接状态;工具列表懒加载(选中且已连接时拉取)
// =============================================================

import type { McpServerConfig, McpServerStatus, McpTool } from '@shared/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { EmptyState } from '../../../components/EmptyState'
import { useInterval } from '../../../hooks/useInterval'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'
import { McpServerCard } from '../components/McpServerCard'
import { McpServerForm } from '../components/McpServerForm'
import { PresetTemplates } from '../components/PresetTemplates'

export function McpTab() {
  const { t } = useT()
  const [servers, setServers] = useState<McpServerStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [mcpEnabled, setMcpEnabled] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [toolsCache, setToolsCache] = useState<Record<string, McpTool[]>>({})
  const [toolsLoadingId, setToolsLoadingId] = useState<string | null>(null)
  // R1-7 / UI-4 修复: 记录每个 server 的 listTools 错误,失败时显式提示而非静默显示"无工具"
  const [toolsErrorMap, setToolsErrorMap] = useState<Record<string, string>>({})
  const [showForm, setShowForm] = useState(false)
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null)
  const [showPresets, setShowPresets] = useState(false)
  const [presetDraft, setPresetDraft] = useState<McpServerConfig | null>(null)
  const loadingRef = useRef(false)

  const checkMcpEnabled = useCallback(async () => {
    try {
      const settings = await getAPI().settings.get()
      setMcpEnabled(settings?.mcp?.enabled === true)
    } catch {
      setMcpEnabled(false)
    }
  }, [])

  const handleToggleMcp = async (enabled: boolean) => {
    try {
      const result = await getAPI().settings.set('mcp.enabled', enabled)
      if (result.success) {
        setMcpEnabled(enabled)
        toast.success(enabled ? t('toast.mcp.enabled') : t('toast.mcp.disabled'))
        if (enabled) {
          setLoading(true)
          // R3-4: 直接调用 loadServers(原 setTimeout 500ms 在快速切 tab 时可能命中已卸载组件)
          loadServers()
        } else {
          setServers([])
          setSelectedId(null)
          // R3-4: 禁用 MCP 时清空所有工具缓存/错误/代际,避免重新启用时显示陈旧数据
          setToolsCache({})
          setToolsErrorMap({})
          toolsGenRef.current = {}
        }
      } else {
        toast.error(t('toast.mcp.toggleFailed'))
      }
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const loadServers = useCallback(async () => {
    if (document.visibilityState === 'hidden') {
      setLoading(false)
      return
    }
    if (loadingRef.current) return
    loadingRef.current = true
    try {
      const result = await getAPI().mcp.list()
      if (result.success) {
        setServers((previous) => {
          const unchanged =
            previous.length === result.servers.length &&
            previous.every((server, index) => {
              const next = result.servers[index]
              return (
                server.id === next.id &&
                server.name === next.name &&
                server.connected === next.connected &&
                server.toolCount === next.toolCount &&
                server.lastError === next.lastError &&
                server.transport === next.transport &&
                server.source === next.source &&
                server.enabled === next.enabled
              )
            })
          return unchanged ? previous : result.servers
        })
      } else if (result.error) {
        toast.error(result.error)
      }
    } catch (err) {
      console.error('[MCP] load failed:', err)
      toast.error(t('toast.mcp.loadFailed'))
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    checkMcpEnabled()
    loadServers()
  }, [checkMcpEnabled, loadServers])

  // 每 5s 轮询刷新连接状态(粗轮询,工具列表懒加载)
  useInterval(loadServers, mcpEnabled ? 5000 : null)

  const selected = servers.find((s) => s.id === selectedId) ?? null
  // R3-4 修复: per-server 请求代际,防止并发/过期 loadTools 的旧响应覆盖新结果。
  // 每次发起 loadTools 递增该 server 的代际;响应回来时若代际已变(被更新的请求取代),丢弃。
  const toolsGenRef = useRef<Record<string, number>>({})

  // 清理指定 server 的工具缓存 + 错误 + 代际(disconnect/delete/disable 时调用)
  const clearToolsState = useCallback((serverId: string) => {
    setToolsCache((prev) => {
      if (!prev[serverId]) return prev
      const next = { ...prev }
      delete next[serverId]
      return next
    })
    setToolsErrorMap((prev) => {
      if (!prev[serverId]) return prev
      const next = { ...prev }
      delete next[serverId]
      return next
    })
    delete toolsGenRef.current[serverId]
  }, [])

  // 拉取某 server 的工具列表(选中且已连接时)。
  // R1-7 / UI-4 修复: 失败时记录错误并 toast 提示,不再静默吞错让用户误以为"无工具"。
  // R3-4 修复: 代际防护,旧响应不覆盖新结果。
  const loadTools = useCallback(
    async (serverId: string) => {
      const gen = (toolsGenRef.current[serverId] ?? 0) + 1
      toolsGenRef.current[serverId] = gen
      setToolsLoadingId(serverId)
      try {
        const result = await getAPI().mcp.listTools(serverId)
        // 代际过期: 已被更新的请求/清理取代,丢弃本次响应
        if (toolsGenRef.current[serverId] !== gen) return
        if (result.success) {
          setToolsCache((prev) => ({ ...prev, [serverId]: result.tools }))
          setToolsErrorMap((prev) => {
            if (!prev[serverId]) return prev
            const next = { ...prev }
            delete next[serverId]
            return next
          })
        } else {
          const msg = result.error || t('toast.mcp.loadToolsFailed')
          setToolsErrorMap((prev) => ({ ...prev, [serverId]: msg }))
          console.error('[MCP] listTools returned failure:', msg)
        }
      } catch (err) {
        if (toolsGenRef.current[serverId] !== gen) return
        const msg = (err as Error).message
        setToolsErrorMap((prev) => ({ ...prev, [serverId]: msg }))
        console.error('[MCP] listTools failed:', err)
      } finally {
        if (toolsGenRef.current[serverId] === gen) {
          setToolsLoadingId(null)
        }
      }
    },
    [t],
  )

  useEffect(() => {
    if (selected?.connected && selectedId && !toolsCache[selectedId]) {
      loadTools(selectedId)
    }
  }, [selected, selectedId, toolsCache, loadTools])

  const handleTest = async (id: string) => {
    try {
      const result = await getAPI().mcp.test(id)
      if (result.success) {
        toast.success(t('toast.mcp.testOk').replace('{count}', String(result.toolCount)))
        await loadServers()
        await loadTools(id)
      } else {
        toast.error(result.error || t('toast.mcp.testFail'))
      }
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const handleConnect = async (id: string) => {
    try {
      const result = await getAPI().mcp.connect(id)
      if (result.success) {
        toast.success(t('toast.mcp.connectSuccess'))
        await loadServers()
        await loadTools(id)
      } else {
        toast.error(result.error || t('toast.mcp.connectFailed'))
      }
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  // R1-7 / UI-5 修复: 检查 result.success,失败时不清理缓存/不刷新,避免假性成功。
  // R3-4: 用 clearToolsState 统一清理(含代际),防止 disconnect 后 effect 重新触发 loadTools 还原错误。
  const handleDisconnect = async (id: string) => {
    try {
      const result = await getAPI().mcp.disconnect(id)
      if (result.success) {
        clearToolsState(id)
        await loadServers()
      } else {
        toast.error(result.error || t('toast.mcp.disconnectFailed'))
      }
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    try {
      const result = await getAPI().mcp.update(id, { enabled })
      if (result.success) {
        toast.success(t('toast.mcp.updated'))
        // R3-4: 禁用时清理工具缓存(断开的 server 不应保留旧工具列表)
        if (!enabled) clearToolsState(id)
        await loadServers()
      } else {
        // R5-I18N-1 修复: 失败 fallback 不再用 "已更新" 文案,改用 toggleFailed
        toast.error(result.error || t('toast.mcp.toggleFailed'))
      }
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const result = await getAPI().mcp.remove(id)
      if (result.success) {
        toast.success(t('toast.mcp.removed'))
        if (selectedId === id) setSelectedId(null)
        // R3-4: 删除时清理该 server 的工具缓存/错误/代际
        clearToolsState(id)
        await loadServers()
      } else {
        toast.error(result.error || t('toast.mcp.removed'))
      }
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const handleEdit = async (id: string) => {
    // listServers 不返回完整 config(command/args/env 等)
    // 用已知字段(id/name/enabled/transport)预填,未知字段留空让用户补
    const s = servers.find((x) => x.id === id)
    if (!s) return
    setEditingServer({
      id: s.id,
      name: s.name,
      enabled: s.enabled,
      transport: s.transport,
    })
    setPresetDraft(null)
    setShowForm(true)
  }

  const handleFormSubmit = async (config: McpServerConfig) => {
    try {
      const isEdit = editingServer !== null
      const result = isEdit
        ? await getAPI().mcp.update(editingServer?.id, config)
        : await getAPI().mcp.add(config)
      if (result.success) {
        toast.success(isEdit ? t('toast.mcp.updated') : t('toast.mcp.added'))
        setShowForm(false)
        setEditingServer(null)
        setPresetDraft(null)
        await loadServers()
      } else {
        toast.error(result.error || t('toast.mcp.toggleFailed'))
      }
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  if (loading) {
    return <div className="p-4 text-gray-500">{t('common.loading')}</div>
  }

  return (
    <section className="h-full flex flex-col">
      {/* MCP 功能开关横幅 */}
      <div
        className={`px-4 py-2.5 flex items-center justify-between border-b ${
          mcpEnabled
            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
            : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">
            {mcpEnabled ? (
              <>
                <span className="text-green-600 dark:text-green-400 font-medium">
                  ● {t('page.mcp.banner.enabled')}
                </span>
                <span className="text-gray-600 dark:text-gray-400 ml-2">
                  Model Context Protocol — {t('page.mcp.empty.hint')}
                </span>
              </>
            ) : (
              <span className="text-amber-600 dark:text-amber-400 font-medium">
                ○ {t('page.mcp.banner.disabled')}
              </span>
            )}
          </span>
        </div>
        <button
          type="button"
          onClick={() => handleToggleMcp(!mcpEnabled)}
          className={`px-3 py-1 text-sm rounded font-medium transition-colors ${
            mcpEnabled
              ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-white/[0.08]'
              : 'bg-blue-500 text-white hover:bg-blue-600'
          }`}
        >
          {mcpEnabled ? t('page.mcp.disable') : t('page.mcp.enable')}
        </button>
      </div>

      {/* MCP 未启用时显示提示 */}
      {!mcpEnabled ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <EmptyState
            icon="🔌"
            title={t('page.mcp.banner.disabled')}
            description={t('page.mcp.empty.hint')}
          />
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          {/* 左侧服务器列表 */}
          <div className="w-72 flex-shrink-0 border-r border-gray-200 dark:border-white/[0.06] flex flex-col bg-gray-50/30 dark:bg-surface-tertiary/30">
            <div className="p-3 border-b border-gray-200 dark:border-white/[0.06] space-y-2">
              <button
                type="button"
                onClick={() => {
                  setEditingServer(null)
                  setPresetDraft(null)
                  setShowForm(true)
                }}
                className="w-full px-3 py-1.5 text-sm rounded bg-blue-500 text-white hover:bg-blue-600"
              >
                + {t('page.mcp.add')}
              </button>
              <button
                type="button"
                onClick={() => setShowPresets(true)}
                className="w-full px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-white/[0.08] hover:bg-gray-100 dark:hover:bg-white/[0.06]"
              >
                ⚡ {t('page.mcp.addFromTemplate')}
              </button>
            </div>
            <div className="flex-1 overflow-auto">
              {servers.length === 0 ? (
                // 左侧列表空时仅显示紧凑提示,完整空状态由右侧详情区展示(避免双份)
                <div className="px-3 py-4 text-center text-xs text-gray-400 dark:text-gray-500">
                  {t('page.mcp.empty.title')}
                </div>
              ) : (
                <ul>
                  {servers.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(s.id)}
                        className={`w-full text-left px-3 py-2 text-sm border-b border-gray-100 dark:border-white/[0.04] hover:bg-gray-100 dark:hover:bg-white/[0.04] ${
                          selectedId === s.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-block w-1.5 h-1.5 rounded-full ${
                              s.connected ? 'bg-green-500' : 'bg-gray-400'
                            }`}
                          />
                          <span className="truncate font-medium text-gray-900 dark:text-gray-100">
                            {s.name}
                          </span>
                        </div>
                        <div className="ml-3.5 text-xs text-gray-500 dark:text-gray-400">
                          {t(`page.mcp.transport.${s.transport}`)} ·{' '}
                          {s.connected
                            ? `${s.toolCount} ${t('page.mcp.tools')}`
                            : t('page.mcp.status.disconnected')}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* 右侧详情 */}
          <div className="flex-1 overflow-auto p-4">
            {selected ? (
              <McpServerCard
                server={selected}
                tools={toolsCache[selected.id] ?? []}
                toolsLoading={toolsLoadingId === selected.id}
                toolsError={toolsErrorMap[selected.id]}
                onReloadTools={() => loadTools(selected.id)}
                onTest={() => handleTest(selected.id)}
                onConnect={() => handleConnect(selected.id)}
                onDisconnect={() => handleDisconnect(selected.id)}
                onEdit={() => handleEdit(selected.id)}
                onDelete={() => handleDelete(selected.id)}
                onToggleEnabled={(enabled) => handleToggleEnabled(selected.id, enabled)}
              />
            ) : (
              <EmptyState
                icon="🔌"
                title={t('page.mcp.empty.title')}
                description={t('page.mcp.empty.hint')}
              />
            )}
          </div>
        </div>
      )}

      {/* 新增/编辑表单弹窗 */}
      {showForm && (
        <McpServerForm
          initial={editingServer ?? presetDraft}
          mode={editingServer ? 'edit' : 'add'}
          onSubmit={handleFormSubmit}
          onCancel={() => {
            setShowForm(false)
            setEditingServer(null)
            setPresetDraft(null)
          }}
        />
      )}

      {/* 预设模板弹窗 */}
      {showPresets && (
        <PresetTemplates
          onSelect={(config) => {
            setShowPresets(false)
            setEditingServer(null)
            setPresetDraft(config)
            setShowForm(true)
          }}
          onCancel={() => setShowPresets(false)}
        />
      )}
    </section>
  )
}
